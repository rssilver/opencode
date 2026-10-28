import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { BrowserBookmark, BrowserBounds, BrowserState } from "@/browser"
import { BookmarksMenu, BookmarkStar } from "./browser-bookmarks"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"

export function BrowserPanel(props: { onClose?: () => void }) {
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const browser = platform.browser
  let viewport: HTMLDivElement | undefined

  const [store, setStore] = createStore({
    state: { tabs: [] } as BrowserState,
    address: "",
    editing: false,
    bookmarks: [] as BrowserBookmark[],
  })

  const active = createMemo(() => store.state.tabs.find((tab) => tab.id === store.state.active))
  const saved = createMemo(() => store.bookmarks.some((item) => item.url === active()?.url))
  const shownAddress = () => (store.editing ? store.address : (active()?.url ?? ""))

  onMount(() => {
    if (!browser) return
    const stop = browser.subscribe((state) => setStore("state", state))
    void browser.getState().then((state) => {
      setStore("state", state)
      if (state.tabs.length === 0) void browser.createTab()
    })
    void browser.setVisible(true)
    void browser.bookmarks.list().then((items) => setStore("bookmarks", items))

    // The native view sits above the page, so it must follow the placeholder exactly.
    let last: BrowserBounds | undefined
    let frame = 0
    const report = () => {
      if (!viewport) return
      const rect = viewport.getBoundingClientRect()
      const next = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      if (last && last.x === next.x && last.y === next.y && last.width === next.width && last.height === next.height)
        return
      last = next
      void browser.setBounds(next)
    }
    // Native views paint above every DOM layer, so hide the page while an app dialog, menu or
    // dropdown is open; otherwise it would cover them.
    let covered = false
    const overlay = () => {
      const next = !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
      if (next === covered) return
      covered = next
      void browser.setVisible(!next)
    }
    const tick = () => {
      report()
      overlay()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    makeEventListener(window, "resize", report)

    onCleanup(() => {
      cancelAnimationFrame(frame)
      stop()
      void browser.setVisible(false)
    })
  })

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const tab = active()
    if (!browser || !tab) return
    void browser.navigate(tab.id, store.address)
    setStore("editing", false)
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.querySelector("input")?.blur()
  }

  return (
    <Show when={browser}>
      {(api) => (
        <aside
          id="browser-panel"
          role="region"
          aria-label={language.t("browser.panel.title")}
          class="relative flex h-full min-w-0 flex-col overflow-hidden bg-v2-background-bg-base"
          classList={{ "rounded-[10px] shadow-[var(--v2-elevation-raised)]": settings.general.newLayoutDesigns() }}
        >
          <div
            role="tablist"
            aria-label={language.t("browser.tabs")}
            class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-weaker-base px-2"
          >
            <For each={store.state.tabs}>
              {(tab) => (
                <div
                  class="flex h-7 min-w-0 max-w-40 shrink-0 items-center gap-1 rounded-md pl-2 pr-1"
                  classList={{
                    "bg-surface-base text-text-strong": tab.id === store.state.active,
                    "text-text-weak hover:bg-surface-base-hover": tab.id !== store.state.active,
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab.id === store.state.active}
                    class="min-w-0 flex-1 truncate text-left text-13-regular"
                    onClick={() => void api().selectTab(tab.id)}
                  >
                    {tab.title || tab.url || language.t("browser.tab.untitled")}
                  </button>
                  <IconButton
                    icon="close-small"
                    variant="ghost"
                    size="small"
                    aria-label={language.t("browser.closeTab")}
                    onClick={() => {
                      void api().closeTab(tab.id)
                      if (store.state.tabs.length === 1) props.onClose?.()
                    }}
                  />
                </div>
              )}
            </For>
            <Tooltip value={language.t("browser.newTab")} placement="bottom">
              <IconButton
                icon="plus-small"
                variant="ghost"
                aria-label={language.t("browser.newTab")}
                onClick={() => void api().createTab()}
              />
            </Tooltip>
          </div>

          <form class="flex h-10 shrink-0 items-center gap-1 px-2" onSubmit={submit}>
            <Tooltip value={language.t("browser.back")} placement="bottom">
              <IconButton
                icon="arrow-left"
                variant="ghost"
                type="button"
                aria-label={language.t("browser.back")}
                disabled={!active()?.canGoBack}
                onClick={() => {
                  const tab = active()
                  if (tab) void api().back(tab.id)
                }}
              />
            </Tooltip>
            <Tooltip value={language.t("browser.forward")} placement="bottom">
              <IconButton
                icon="arrow-right"
                variant="ghost"
                type="button"
                aria-label={language.t("browser.forward")}
                disabled={!active()?.canGoForward}
                onClick={() => {
                  const tab = active()
                  if (tab) void api().forward(tab.id)
                }}
              />
            </Tooltip>
            <Tooltip value={language.t(active()?.loading ? "browser.stop" : "browser.reload")} placement="bottom">
              <IconButton
                icon={active()?.loading ? "close-small" : "reset"}
                variant="ghost"
                type="button"
                aria-label={language.t(active()?.loading ? "browser.stop" : "browser.reload")}
                disabled={!active()}
                onClick={() => {
                  const tab = active()
                  if (!tab) return
                  void (tab.loading ? api().stop(tab.id) : api().reload(tab.id))
                }}
              />
            </Tooltip>
            <input
              type="text"
              spellcheck={false}
              autocomplete="off"
              aria-label={language.t("browser.address.placeholder")}
              placeholder={language.t("browser.address.placeholder")}
              class="h-7 min-w-0 flex-1 rounded-md border border-border-weaker-base bg-surface-base px-2 text-13-regular text-text-strong outline-none focus:border-border-interactive-base"
              value={shownAddress()}
              onFocus={(event) => {
                setStore({ address: active()?.url ?? "", editing: true })
                event.currentTarget.select()
              }}
              onBlur={() => setStore("editing", false)}
              onInput={(event) => setStore("address", event.currentTarget.value)}
            />
            <BookmarkStar
              saved={saved()}
              disabled={!active()?.url}
              onToggle={() => {
                const tab = active()
                if (!tab?.url) return
                void (saved()
                  ? api().bookmarks.remove(tab.url)
                  : api().bookmarks.add([{ title: tab.title || tab.url, url: tab.url, folder: "" }])
                ).then((items) => setStore("bookmarks", items))
              }}
            />
            <BookmarksMenu
              api={api()}
              bookmarks={store.bookmarks}
              onChange={(items) => setStore("bookmarks", items)}
              onOpen={(url) => {
                const tab = active()
                if (tab) void api().navigate(tab.id, url)
              }}
            />
          </form>

          {/* Placeholder only: the native browser view is layered over this rectangle. */}
          <div ref={viewport} class="min-h-0 flex-1" />
        </aside>
      )}
    </Show>
  )
}
