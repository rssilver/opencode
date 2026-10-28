import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type {
  BrowserPasswordOffer,
  BrowserPasswordState,
  BrowserPasswordSummary,
  BrowserPlatform,
  BrowserSignInRequest,
} from "@/browser"
import { useLanguage } from "@/context/language"

/**
 * Bars shown above the page: "Save password for <host>?" after a login submit, and
 * "Allow the agent to sign in to <host>?" when the agent wants to use a saved login.
 */
export function PasswordBars(props: { api: BrowserPlatform }) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    offer: undefined as BrowserPasswordOffer | undefined,
    requests: [] as BrowserSignInRequest[],
  })

  onMount(() => {
    const stopOffer = props.api.passwords.onOffer((offer) => setStore("offer", offer))
    const stopRequest = props.api.passwords.onSignInRequest((request) =>
      setStore("requests", (items) => [...items, request]),
    )
    onCleanup(() => {
      stopOffer()
      stopRequest()
    })
  })

  const respond = (action: "save" | "never" | "dismiss") => {
    const offer = store.offer
    setStore("offer", undefined)
    if (offer) void props.api.passwords.respondOffer(offer.id, action)
  }
  const answer = (request: BrowserSignInRequest, value: "always" | "once" | "no") => {
    setStore("requests", (items) => items.filter((item) => item.id !== request.id))
    void props.api.passwords.respondSignIn(request.id, value)
  }

  return (
    <>
      <For each={store.requests}>
        {(request) => (
          <div
            role="alert"
            class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-weaker-base bg-surface-base px-3 py-2"
          >
            <span class="min-w-0 flex-1 text-13-regular text-text-strong">
              {language.t("browser.passwords.signIn.ask", { host: request.host })}
            </span>
            <Button type="button" size="small" variant="primary" onClick={() => answer(request, "always")}>
              {language.t("browser.passwords.signIn.always")}
            </Button>
            <Button type="button" size="small" variant="secondary" onClick={() => answer(request, "once")}>
              {language.t("browser.passwords.signIn.once")}
            </Button>
            <Button type="button" size="small" variant="ghost" onClick={() => answer(request, "no")}>
              {language.t("browser.passwords.signIn.no")}
            </Button>
          </div>
        )}
      </For>
      <Show when={store.offer}>
        {(offer) => (
          <div
            role="status"
            class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-weaker-base bg-surface-base px-3 py-2"
          >
            <span class="min-w-0 flex-1 truncate text-13-regular text-text-strong">
              {language.t(offer().kind === "update" ? "browser.passwords.offer.update" : "browser.passwords.offer.save", {
                host: offer().host,
              })}
              <Show when={offer().username}>
                <span class="text-text-weak"> · {offer().username}</span>
              </Show>
            </span>
            <Button type="button" size="small" variant="primary" onClick={() => respond("save")}>
              {language.t(offer().kind === "update" ? "browser.passwords.offer.updateButton" : "common.save")}
            </Button>
            <Show when={offer().kind === "save"}>
              <Button type="button" size="small" variant="secondary" onClick={() => respond("never")}>
                {language.t("browser.passwords.offer.never")}
              </Button>
            </Show>
            <IconButton
              icon="close-small"
              variant="ghost"
              size="small"
              type="button"
              aria-label={language.t("browser.passwords.offer.dismiss")}
              onClick={() => respond("dismiss")}
            />
          </div>
        )}
      </Show>
    </>
  )
}

/** Saved logins, "never save" sites and agent sign-in permissions. */
export function DialogPasswords(props: { api: BrowserPlatform }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [store, setStore] = createStore({
    state: { available: true, entries: [], never: [], grants: [] } as BrowserPasswordState,
    revealed: {} as Record<string, string>,
    editing: undefined as { origin: string; username: string; password: string; previous?: string } | undefined,
    imported: undefined as number | undefined,
  })
  const key = (entry: BrowserPasswordSummary) => `${entry.origin}\n${entry.username}`
  let file: HTMLInputElement | undefined

  onMount(() => void props.api.passwords.state().then((state) => setStore("state", state)))

  const toggleReveal = async (entry: BrowserPasswordSummary) => {
    if (store.revealed[key(entry)] !== undefined) return setStore("revealed", key(entry), undefined!)
    const value = await props.api.passwords.reveal(entry.origin, entry.username)
    if (value !== undefined) setStore("revealed", key(entry), value)
  }
  const edit = async (entry?: BrowserPasswordSummary) => {
    if (!entry) return setStore("editing", { origin: "https://", username: "", password: "" })
    const password = (await props.api.passwords.reveal(entry.origin, entry.username)) ?? ""
    setStore("editing", { origin: entry.origin, username: entry.username, password, previous: entry.username })
  }
  const save = async () => {
    const form = store.editing
    if (!form) return
    setStore({ state: await props.api.passwords.save(form), editing: undefined, revealed: {} })
  }
  const importCsv = async (input: HTMLInputElement) => {
    const picked = input.files?.[0]
    input.value = ""
    if (!picked) return
    const result = await props.api.passwords.importCsv(await picked.text())
    setStore({ state: result.state, imported: result.count })
  }

  return (
    <Dialog title={language.t("browser.passwords.title")} class="w-full max-w-[560px] mx-auto">
      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-6 pt-0">
        <Show when={!store.state.available}>
          <p class="text-13-regular text-text-weak">{language.t("browser.passwords.unavailable")}</p>
        </Show>
        <p class="text-13-regular text-text-weak">{language.t("browser.passwords.description")}</p>

        <Show
          when={store.editing}
          fallback={
            <div class="flex flex-col gap-1">
              <Show
                when={store.state.entries.length > 0}
                fallback={<p class="text-13-regular text-text-weak">{language.t("browser.passwords.empty")}</p>}
              >
                <For each={store.state.entries}>
                  {(entry) => (
                    <div class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-base-hover">
                      <div class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-13-medium text-text-strong">{new URL(entry.origin).host}</span>
                        <span class="truncate text-12-regular text-text-weak">
                          {entry.username || language.t("browser.passwords.noUsername")}
                          {" · "}
                          <span class="font-mono">{store.revealed[key(entry)] ?? "••••••••"}</span>
                        </span>
                      </div>
                      <Button type="button" size="small" variant="ghost" onClick={() => void toggleReveal(entry)}>
                        {language.t(
                          store.revealed[key(entry)] !== undefined ? "browser.passwords.hide" : "browser.passwords.reveal",
                        )}
                      </Button>
                      <Button type="button" size="small" variant="ghost" onClick={() => void edit(entry)}>
                        {language.t("common.edit")}
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        onClick={() =>
                          void props.api.passwords
                            .remove(entry.origin, entry.username)
                            .then((state) => setStore("state", state))
                        }
                      >
                        {language.t("common.delete")}
                      </Button>
                    </div>
                  )}
                </For>
              </Show>
              <div class="flex flex-wrap gap-2 pt-2">
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={!store.state.available}
                  onClick={() => void edit()}
                >
                  {language.t("browser.passwords.add")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={!store.state.available}
                  onClick={() => file?.click()}
                >
                  {language.t("browser.passwords.import")}
                </Button>
                <input
                  ref={file}
                  type="file"
                  accept=".csv,text/csv"
                  class="hidden"
                  onChange={(event) => void importCsv(event.currentTarget)}
                />
              </div>
              <Show when={store.imported !== undefined}>
                <p class="text-12-regular text-text-weak">
                  {language.t("browser.passwords.imported", { count: String(store.imported) })}
                </p>
              </Show>
            </div>
          }
        >
          {(form) => (
            <form
              class="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <TextField
                label={language.t("browser.passwords.field.site")}
                value={form().origin}
                onChange={(value) => setStore("editing", "origin", value)}
              />
              <TextField
                label={language.t("browser.passwords.field.username")}
                value={form().username}
                onChange={(value) => setStore("editing", "username", value)}
              />
              <TextField
                label={language.t("browser.passwords.field.password")}
                type="password"
                value={form().password}
                onChange={(value) => setStore("editing", "password", value)}
              />
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setStore("editing", undefined)}>
                  {language.t("common.cancel")}
                </Button>
                <Button type="submit" variant="primary" disabled={!form().password}>
                  {language.t("common.save")}
                </Button>
              </div>
            </form>
          )}
        </Show>

        <Show when={store.state.grants.length > 0}>
          <div class="flex flex-col gap-1">
            <h3 class="text-13-medium text-text-strong">{language.t("browser.passwords.grants")}</h3>
            <For each={store.state.grants}>
              {(origin) => (
                <div class="flex items-center gap-2 px-2 py-1">
                  <span class="min-w-0 flex-1 truncate text-13-regular">{new URL(origin).host}</span>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={() =>
                      void props.api.passwords.revokeGrant(origin).then((state) => setStore("state", state))
                    }
                  >
                    {language.t("browser.passwords.revoke")}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={store.state.never.length > 0}>
          <div class="flex flex-col gap-1">
            <h3 class="text-13-medium text-text-strong">{language.t("browser.passwords.never")}</h3>
            <For each={store.state.never}>
              {(origin) => (
                <div class="flex items-center gap-2 px-2 py-1">
                  <span class="min-w-0 flex-1 truncate text-13-regular">{new URL(origin).host}</span>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={() =>
                      void props.api.passwords.allowSaving(origin).then((state) => setStore("state", state))
                    }
                  >
                    {language.t("common.delete")}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="flex justify-end">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
