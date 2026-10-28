import { For, Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { BrowserBookmark, BrowserImportProfile, BrowserPlatform } from "@/browser"
import { useLanguage } from "@/context/language"
import { DialogPasswords } from "./browser-passwords"

export function BookmarkStar(props: { saved: boolean; disabled: boolean; onToggle: () => void }) {
  const language = useLanguage()
  const label = () => language.t(props.saved ? "browser.bookmark.remove" : "browser.bookmark.add")
  return (
    <Tooltip value={label()} placement="bottom">
      <button
        type="button"
        aria-label={label()}
        aria-pressed={props.saved}
        disabled={props.disabled}
        class="flex size-6 shrink-0 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover disabled:opacity-50"
        classList={{ "text-icon-interactive-base": props.saved }}
        onClick={props.onToggle}
      >
        <svg viewBox="0 0 20 20" class="size-5" fill={props.saved ? "currentColor" : "none"} aria-hidden="true">
          <path
            d="M10 2.9l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.2l5-.7L10 2.9z"
            stroke="currentColor"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </Tooltip>
  )
}

export function BookmarksMenu(props: {
  api: BrowserPlatform
  bookmarks: BrowserBookmark[]
  onChange: (items: BrowserBookmark[]) => void
  onOpen: (url: string) => void
}) {
  const language = useLanguage()
  const dialog = useDialog()

  // Top-level bookmarks first, then one group per folder in first-seen order.
  const groups = createMemo(() => {
    const map = new Map<string, BrowserBookmark[]>()
    props.bookmarks.forEach((item) => map.set(item.folder, [...(map.get(item.folder) ?? []), item]))
    return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0))
  })

  return (
    <DropdownMenu>
      <Tooltip value={language.t("browser.bookmarks")} placement="bottom">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="bullet-list"
          variant="ghost"
          type="button"
          aria-label={language.t("browser.bookmarks")}
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="max-h-[60vh] w-72 overflow-y-auto">
          <Show
            when={props.bookmarks.length > 0}
            fallback={
              <div class="px-2 py-1.5 text-13-regular text-text-weak">{language.t("browser.bookmarks.empty")}</div>
            }
          >
            <For each={groups()}>
              {([folder, items]) => (
                <DropdownMenu.Group>
                  <Show when={folder}>
                    <DropdownMenu.GroupLabel>{folder}</DropdownMenu.GroupLabel>
                  </Show>
                  <For each={items}>
                    {(item) => (
                      <DropdownMenu.Item onSelect={() => props.onOpen(item.url)}>
                        <DropdownMenu.ItemLabel class="truncate">{item.title}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Group>
              )}
            </For>
            <DropdownMenu.Separator />
          </Show>
          <DropdownMenu.Item
            onSelect={() =>
              dialog.show(() => <DialogImportBookmarks api={props.api} onImported={props.onChange} />)
            }
          >
            <DropdownMenu.ItemLabel>{language.t("browser.bookmarks.import")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogPasswords api={props.api} />)}>
            <DropdownMenu.ItemLabel>{language.t("browser.passwords.menu")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

function DialogImportBookmarks(props: { api: BrowserPlatform; onImported: (items: BrowserBookmark[]) => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [store, setStore] = createStore({
    profiles: [] as BrowserImportProfile[],
    loaded: false,
    busy: "",
  })

  onMount(() => {
    void props.api.bookmarks.listImportProfiles().then((profiles) => setStore({ profiles, loaded: true }))
  })

  const run = async (id: string) => {
    setStore("busy", id)
    props.onImported(await props.api.bookmarks.importProfile(id))
    dialog.close()
  }

  return (
    <Dialog title={language.t("browser.import.title")} class="w-full max-w-[420px] mx-auto">
      <div class="flex flex-col gap-4 p-6 pt-0">
        <p class="text-13-regular text-text-weak">{language.t("browser.import.description")}</p>
        <Show
          when={store.profiles.length > 0}
          fallback={
            <Show when={store.loaded}>
              <p class="text-13-regular text-text-weak">{language.t("browser.import.empty")}</p>
            </Show>
          }
        >
          <div class="flex flex-col gap-1">
            <For each={store.profiles}>
              {(profile) => (
                <Button
                  type="button"
                  variant="secondary"
                  size="large"
                  disabled={store.busy !== ""}
                  onClick={() => void run(profile.id)}
                >
                  {language.t(profile.browser === "chrome" ? "browser.import.chrome" : "browser.import.edge", {
                    name: profile.name,
                  })}
                </Button>
              )}
            </For>
          </div>
        </Show>
        <div class="flex justify-end">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
