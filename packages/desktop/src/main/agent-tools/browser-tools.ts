import { BrowserWindow } from "electron"
import type { WebContents } from "electron"
import {
  browserHistory,
  closeBrowserTab,
  createBrowserTab,
  getBrowserContents,
  getBrowserState,
  navigateBrowserTab,
  requestBrowserOpen,
  selectBrowserTab,
} from "../browser-panel"
import { resolveBrowserInput } from "../browser-url"
import {
  clickScript,
  parseTarget,
  readScript,
  scrollScript,
  typeScript,
  type ActionResult,
  type PageSnapshot,
  type ScrollDirection,
} from "./page-script"
import { number, optionalString, string, type Tool, type ToolResult, ToolError } from "./tool"

const LOAD_TIMEOUT = 15_000
const WORLD_ID = 1000
const MAX_SCREENSHOT_WIDTH = 1280
const DEFAULT_READ_CHARS = 12_000

const tabProperty = { type: "string", description: "Tab id from browser_tabs. Defaults to the active tab." }
const targetProperties = {
  index: { type: "integer", description: "Element number from the latest browser_read output." },
  selector: { type: "string", description: "CSS selector, used when index is not given." },
  tab_id: tabProperty,
}

export const browserTools: Tool[] = [
  {
    name: "browser_open",
    description:
      "Load a web page in the app's built-in browser panel (the panel opens beside the session). Only http and https URLs are allowed; 'localhost:3000' style input is accepted. Waits up to 15 seconds for the page to finish loading, then returns the final URL and title. Use new_tab to keep the current page open.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Address to load, e.g. https://example.com or localhost:3000." },
        new_tab: { type: "boolean", description: "Open in a new tab instead of reusing the active tab." },
      },
      required: ["url"],
    },
    run: (args) => openUrl(string(args, "url"), args.new_tab === true),
  },
  {
    name: "browser_tabs",
    description: "List the tabs open in the built-in browser panel with their id, URL, title and which is active.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const state = getBrowserState(targetWindow())
      if (state.tabs.length === 0) return text("No browser tabs are open.")
      return text(
        state.tabs
          .map((tab) => `${tab.id}${tab.id === state.active ? " (active)" : ""}  ${tab.url || "(blank)"}  ${tab.title}`)
          .join("\n"),
      )
    },
  },
  {
    name: "browser_read",
    description:
      "Read the current page of a browser tab: its visible text plus a numbered list of interactive elements (links, buttons, inputs, selects). Use the element numbers with browser_click and browser_type. Numbers are refreshed on every read, so read again after the page changes.",
    inputSchema: {
      type: "object",
      properties: {
        tab_id: tabProperty,
        max_chars: { type: "integer", description: `Maximum characters of page text. Default ${DEFAULT_READ_CHARS}.` },
      },
    },
    run: async (args) => {
      const tab = requireTab(optionalString(args, "tab_id"))
      const max = number(args, "max_chars") ?? DEFAULT_READ_CHARS
      const page = await runInPage<PageSnapshot>(tab.contents, readScript(Math.min(Math.max(max, 100), 100_000)))
      return text(formatSnapshot(page))
    },
  },
  {
    name: "browser_click",
    description:
      "Click an element on the page, identified by its number from browser_read (preferred) or a CSS selector. Returns what happened and the resulting URL.",
    inputSchema: { type: "object", properties: targetProperties },
    run: async (args) => {
      const target = parseTarget(args)
      if (!target) throw new ToolError("Provide index (from browser_read) or selector.")
      const tab = requireTab(optionalString(args, "tab_id"))
      const result = await runInPage<ActionResult>(tab.contents, clickScript(target))
      return text(await describeAction(tab.contents, result))
    },
  },
  {
    name: "browser_type",
    description:
      "Type text into an input, textarea or select (choose an option by its value or label), identified by its number from browser_read or a CSS selector. Replaces the existing value. Set submit to press Enter / submit the form afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        ...targetProperties,
        text: { type: "string", description: "Text to enter." },
        submit: { type: "boolean", description: "Submit the form after typing." },
      },
      required: ["text"],
    },
    run: async (args) => {
      const target = parseTarget(args)
      if (!target) throw new ToolError("Provide index (from browser_read) or selector.")
      const value = string(args, "text")
      const tab = requireTab(optionalString(args, "tab_id"))
      const result = await runInPage<ActionResult>(tab.contents, typeScript(target, value, args.submit === true))
      return text(await describeAction(tab.contents, result))
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page of a browser tab one screen up or down, or jump to the top or bottom.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
        tab_id: tabProperty,
      },
      required: ["direction"],
    },
    run: async (args) => {
      const direction = string(args, "direction")
      if (!["up", "down", "top", "bottom"].includes(direction))
        throw new ToolError("direction must be one of up, down, top, bottom.")
      const tab = requireTab(optionalString(args, "tab_id"))
      const result = await runInPage<ActionResult>(tab.contents, scrollScript(direction as ScrollDirection))
      return text(result.message)
    },
  },
  {
    name: "browser_screenshot",
    description:
      "Take a screenshot of a browser tab. The image is returned to you and is also shown to the user in the conversation, so add a short caption describing what it shows.",
    inputSchema: {
      type: "object",
      properties: {
        tab_id: tabProperty,
        caption: { type: "string", description: "Short description of the screenshot, shown to the user." },
      },
    },
    run: async (args) => {
      const win = targetWindow()
      const tab = requireTab(optionalString(args, "tab_id"))
      // A hidden panel renders nothing, so make sure it is showing this tab first.
      selectBrowserTab(win, tab.id)
      requestBrowserOpen(win)
      await sleep(300)
      const image = await tab.contents.capturePage()
      if (image.isEmpty()) throw new ToolError("The page could not be captured; the browser panel may be hidden.")
      const size = image.getSize()
      const scaled = size.width > MAX_SCREENSHOT_WIDTH ? image.resize({ width: MAX_SCREENSHOT_WIDTH }) : image
      const caption = optionalString(args, "caption")
      return {
        content: [
          { type: "text", text: `${caption ? `${caption}\n` : ""}Screenshot of ${tab.contents.getURL()}` },
          { type: "image", data: scaled.toPNG().toString("base64"), mimeType: "image/png" },
        ],
      }
    },
  },
  {
    name: "browser_back",
    description: "Go back one page in a browser tab's history.",
    inputSchema: { type: "object", properties: { tab_id: tabProperty } },
    run: (args) => navigateHistory("back", optionalString(args, "tab_id")),
  },
  {
    name: "browser_forward",
    description: "Go forward one page in a browser tab's history.",
    inputSchema: { type: "object", properties: { tab_id: tabProperty } },
    run: (args) => navigateHistory("forward", optionalString(args, "tab_id")),
  },
  {
    name: "browser_close_tab",
    description: "Close a browser tab.",
    inputSchema: { type: "object", properties: { tab_id: tabProperty } },
    run: async (args) => {
      const tab = requireTab(optionalString(args, "tab_id"))
      closeBrowserTab(targetWindow(), tab.id)
      return text(`Closed tab ${tab.id}.`)
    },
  },
]

/** The window whose panel the tools drive: the focused app window, else the first one. */
export function targetWindow() {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  const win = windows.find((item) => item.isFocused()) ?? windows[0]
  if (!win) throw new ToolError("No OpenCode window is open.")
  return win
}

/** Opens `input` in the browser panel, waits for it to load and reports where it ended up. */
export async function openUrl(input: string, newTab: boolean): Promise<ToolResult> {
  const url = resolveBrowserInput(input)
  if (!url) throw new ToolError("Only http and https URLs can be opened.")
  const win = targetWindow()
  const existing = newTab ? undefined : getBrowserContents(win)
  const created = existing ? undefined : createBrowserTab(win, url)
  const tab = existing ?? (created ? getBrowserContents(win, created) : undefined)
  if (!tab) throw new ToolError("Could not open a tab (the panel allows at most 8 tabs; close one first).")
  const loaded = waitForLoad(tab.contents)
  if (existing) {
    selectBrowserTab(win, tab.id)
    navigateBrowserTab(win, tab.id, url)
  }
  requestBrowserOpen(win)
  const finished = await loaded
  return text(
    `${finished ? "Loaded" : "Still loading after 15s:"} ${tab.contents.getURL() || url}\nTitle: ${tab.contents.getTitle() || "(none)"}\nTab: ${tab.id}`,
  )
}

async function navigateHistory(action: "back" | "forward", tabId?: string) {
  const tab = requireTab(tabId)
  const wc = tab.contents
  const possible = action === "back" ? wc.navigationHistory.canGoBack() : wc.navigationHistory.canGoForward()
  if (!possible) return text(`Cannot go ${action}: no history in that direction.`)
  const loaded = waitForLoad(wc)
  browserHistory(targetWindow(), tab.id, action)
  await loaded
  return text(`Now at ${wc.getURL()}\nTitle: ${wc.getTitle() || "(none)"}`)
}

export function requireTab(id?: string) {
  const tab = getBrowserContents(targetWindow(), id)
  if (tab) return tab
  throw new ToolError(
    id
      ? `No browser tab with id ${id}. Use browser_tabs to list tabs.`
      : "No browser tab is open. Use browser_open first.",
  )
}

export async function runInPage<T>(wc: WebContents, code: string) {
  try {
    return (await wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }])) as T
  } catch (error) {
    throw new ToolError(`The page could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** After a click or typed submit the page may navigate; give it a moment, then report the URL. */
async function describeAction(wc: WebContents, result: ActionResult) {
  if (!result.ok) throw new ToolError(result.message)
  await sleep(500)
  if (wc.isLoading()) await waitForLoad(wc, 5000)
  return `${result.message}\nCurrent URL: ${wc.getURL()}\nTitle: ${wc.getTitle() || "(none)"}`
}

function waitForLoad(wc: WebContents, timeout = LOAD_TIMEOUT) {
  return new Promise<boolean>((resolve) => {
    const done = (value: boolean) => {
      clearTimeout(timer)
      wc.off("did-stop-loading", onStop)
      wc.off("destroyed", onGone)
      resolve(value)
    }
    const onStop = () => done(true)
    const onGone = () => done(false)
    const timer = setTimeout(() => done(false), timeout)
    wc.once("did-stop-loading", onStop)
    wc.once("destroyed", onGone)
  })
}

function formatSnapshot(page: PageSnapshot) {
  const elements = page.elements.map((item) => {
    const kind = item.type ? `${item.tag}:${item.type}` : item.tag
    const parts = [`[${item.index}] ${kind}`, item.label ? `"${item.label}"` : ""]
    if (item.value) parts.push(`value="${item.value}"`)
    if (item.href) parts.push(`-> ${item.href}`)
    return parts.filter(Boolean).join(" ")
  })
  return [
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    "",
    "--- Page text ---",
    page.text || "(empty)",
    page.truncated ? "[text truncated; raise max_chars to read more]" : "",
    "",
    "--- Interactive elements ---",
    elements.length ? elements.join("\n") : "(none)",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] }
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
