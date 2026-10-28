import { randomUUID } from "node:crypto"
import { BrowserWindow, session, WebContentsView } from "electron"
import type { BrowserBounds, BrowserState, BrowserTabState } from "@opencode-ai/app/browser"
import { activeAfterClose, isAllowedBrowserUrl, resolveBrowserInput } from "./browser-url"
import { write as writeLog } from "./logging"

// Browsed sites live in their own partition so the app window's session hooks
// (permissive CORS headers, renderer-only permission handler) never apply to them.
const PARTITION = "persist:opencode-browser"
const MAX_TABS = 8

type Tab = { id: string; view: WebContentsView; state: BrowserTabState }

type Panel = {
  tabs: Map<string, Tab>
  order: string[]
  active?: string
  bounds: BrowserBounds
  visible: boolean
}

const panels = new WeakMap<BrowserWindow, Panel>()
let configured = false

export function getBrowserState(win: BrowserWindow): BrowserState {
  const panel = panels.get(win)
  if (!panel) return { tabs: [] }
  return { tabs: panel.order.flatMap((id) => panel.tabs.get(id)?.state ?? []), active: panel.active }
}

/** Live contents of a tab (the active one when `id` is omitted), for the agent tools. */
export function getBrowserContents(win: BrowserWindow, id?: string) {
  const panel = panels.get(win)
  const tab = panel?.tabs.get(id ?? panel.active ?? "")
  if (!tab || tab.view.webContents.isDestroyed()) return undefined
  return { id: tab.id, contents: tab.view.webContents }
}

/** Asks the renderer to show the browser panel, e.g. after the agent opened a tab. */
export function requestBrowserOpen(win: BrowserWindow) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send("browser-open-request")
}

export function createBrowserTab(win: BrowserWindow, input?: string) {
  const panel = panelFor(win)
  if (panel.tabs.size >= MAX_TABS) return undefined
  const url = input ? resolveBrowserInput(input) : undefined
  if (input && !url) return undefined

  const id = randomUUID()
  const view = new WebContentsView({
    webPreferences: {
      session: partition(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  const tab: Tab = {
    id,
    view,
    state: { id, url: "", title: "", canGoBack: false, canGoForward: false, loading: false },
  }
  panel.tabs.set(id, tab)
  panel.order.push(id)
  win.contentView.addChildView(view)
  wireTab(win, tab)
  panel.active = id
  layout(panel)
  if (url) load(tab, url)
  publish(win)
  return id
}

export function closeBrowserTab(win: BrowserWindow, id: string) {
  const panel = panels.get(win)
  const tab = panel?.tabs.get(id)
  if (!panel || !tab) return
  panel.active = activeAfterClose(panel.order, id, panel.active)
  panel.order = panel.order.filter((item) => item !== id)
  panel.tabs.delete(id)
  destroy(win, tab)
  layout(panel)
  publish(win)
}

export function selectBrowserTab(win: BrowserWindow, id: string) {
  const panel = panels.get(win)
  if (!panel?.tabs.has(id)) return
  panel.active = id
  layout(panel)
  publish(win)
}

export function navigateBrowserTab(win: BrowserWindow, id: string, input: string) {
  const tab = panels.get(win)?.tabs.get(id)
  const url = resolveBrowserInput(input)
  if (!tab || !url) return
  load(tab, url)
}

export function browserHistory(win: BrowserWindow, id: string, action: "back" | "forward" | "reload" | "stop") {
  const wc = panels.get(win)?.tabs.get(id)?.view.webContents
  if (!wc || wc.isDestroyed()) return
  if (action === "back") return wc.navigationHistory.goBack()
  if (action === "forward") return wc.navigationHistory.goForward()
  if (action === "reload") return wc.reload()
  wc.stop()
}

export function setBrowserBounds(win: BrowserWindow, bounds: BrowserBounds) {
  const panel = panelFor(win)
  const scale = win.webContents.getZoomFactor()
  const next = [bounds.x, bounds.y, bounds.width, bounds.height].map((value) =>
    Number.isFinite(value) ? Math.max(0, Math.round(value * scale)) : 0,
  )
  panel.bounds = { x: next[0], y: next[1], width: next[2], height: next[3] }
  layout(panel)
}

export function setBrowserVisible(win: BrowserWindow, visible: boolean) {
  const panel = panelFor(win)
  panel.visible = visible
  layout(panel)
}

function panelFor(win: BrowserWindow) {
  const existing = panels.get(win)
  if (existing) return existing
  const panel: Panel = {
    tabs: new Map(),
    order: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    visible: true,
  }
  panels.set(win, panel)
  win.once("closed", () => {
    panel.tabs.forEach((tab) => destroy(win, tab))
    panel.tabs.clear()
    panels.delete(win)
  })
  return panel
}

function partition() {
  const ses = session.fromPartition(PARTITION)
  if (configured) return ses
  configured = true
  // Sites get no device or sensor access; fullscreen is the only grant.
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "fullscreen"))
  ses.setPermissionCheckHandler((_wc, permission) => permission === "fullscreen")
  ses.setDevicePermissionHandler(() => false)
  // Downloads would write to disk without the user's confirmation.
  ses.on("will-download", (event) => event.preventDefault())
  return ses
}

function wireTab(win: BrowserWindow, tab: Tab) {
  const wc = tab.view.webContents
  const sync = () => {
    if (wc.isDestroyed()) return
    tab.state = {
      id: tab.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    }
    publish(win)
  }

  // Popups become tabs in this panel, never new native windows.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedBrowserUrl(url) && url !== "about:blank") createBrowserTab(win, url)
    else writeLog("browser", "blocked popup", { url }, "warn")
    return { action: "deny" }
  })
  const guard = (event: { preventDefault(): void }, url: string) => {
    if (isAllowedBrowserUrl(url)) return
    event.preventDefault()
    writeLog("browser", "blocked navigation", { url }, "warn")
  }
  wc.on("will-frame-navigate", (event) => guard(event, event.url))
  wc.on("will-redirect", (event) => guard(event, event.url))
  wc.on("did-start-loading", sync)
  wc.on("did-stop-loading", sync)
  wc.on("did-navigate", sync)
  wc.on("did-navigate-in-page", sync)
  wc.on("page-title-updated", sync)
  wc.on("render-process-gone", sync)
  wc.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) sync()
  })
}

function load(tab: Tab, url: string) {
  tab.view.webContents.loadURL(url).catch((error: unknown) => {
    // Aborted loads (redirects, new navigations) reject; real failures show in the page.
    writeLog("browser", "load failed", { url, error: String(error) }, "warn")
  })
}

function destroy(win: BrowserWindow, tab: Tab) {
  if (!win.isDestroyed()) win.contentView.removeChildView(tab.view)
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
}

function layout(panel: Panel) {
  panel.tabs.forEach((tab) => {
    tab.view.setBounds(panel.bounds)
    tab.view.setVisible(panel.visible && tab.id === panel.active && panel.bounds.width > 0 && panel.bounds.height > 0)
  })
}

function publish(win: BrowserWindow) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send("browser-state", getBrowserState(win))
}
