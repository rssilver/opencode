import { Show, createMemo, createRoot, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { getFilename } from "@opencode-ai/core/util/path"
import { ContextMeterDetails, useContextMeter } from "@/components/session/session-context-meter"
import { useLanguage } from "@/context/language"
import { usePlatform, type Platform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { ServerConnection, useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Persist, persisted } from "@/utils/persist"

type CardID = "environment" | "context" | "changes"

let shared: ReturnType<typeof createSessionInfoState> | undefined

/**
 * Open/closed state of the info panel and its cards, remembered per user. Shared between the
 * header toggle and the panel; created in a detached root so it outlives the first caller.
 */
export function useSessionInfoState() {
  const platform = usePlatform()
  shared ??= createRoot(() => createSessionInfoState(platform))
  return shared
}

function createSessionInfoState(platform: Platform) {
  const [store, setStore] = persisted(
    Persist.global("session.info.v1"),
    createStore({ opened: false, collapsed: {} as Partial<Record<CardID, boolean>> }),
    platform,
  )
  return {
    opened: () => store.opened,
    toggle: () => setStore("opened", !store.opened),
    close: () => setStore("opened", false),
    collapsed: (id: CardID) => !!store.collapsed[id],
    toggleCard: (id: CardID) => setStore("collapsed", id, !store.collapsed[id]),
  }
}

export type SessionInfoState = ReturnType<typeof createSessionInfoState>

export function SessionInfoPanel(props: { state: SessionInfoState; onOpenReview: () => void }) {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const server = useServer()
  const meter = useContextMeter()
  const { params } = useSessionLayout()

  const root = createMemo(() => sync().project?.worktree ?? sdk().directory)
  const location = createMemo(() => {
    const conn = server.current
    if (!conn) return language.t("session.info.env.local")
    if (conn.type === "sidecar" && conn.variant === "wsl")
      return language.t("session.info.env.wsl", { distro: conn.distro })
    if (ServerConnection.local(conn)) return language.t("session.info.env.local")
    if (conn.type === "ssh") return language.t("session.info.env.remote", { url: conn.host })
    return language.t("session.info.env.remote", { url: conn.http.url })
  })
  const changes = createMemo(() => {
    const info = params.id ? sync().session.get(params.id) : undefined
    if (info?.summary) return info.summary
    const diffs = params.id ? (sync().data.session_diff[params.id] ?? []) : []
    return {
      additions: diffs.reduce((sum, diff) => sum + (diff.additions ?? 0), 0),
      deletions: diffs.reduce((sum, diff) => sum + (diff.deletions ?? 0), 0),
      files: diffs.length,
    }
  })

  return (
    <aside
      id="session-info-panel"
      class="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border-weak-base bg-background-base"
      aria-label={language.t("session.info.title")}
    >
      <div class="flex h-10 shrink-0 items-center justify-between px-3">
        <span class="text-13-medium text-text-strong">{language.t("session.info.title")}</span>
        <IconButton
          icon="close-small"
          variant="ghost"
          onClick={props.state.close}
          aria-label={language.t("session.info.close")}
        />
      </div>
      <div class="flex flex-col gap-2 px-2 pb-3">
        <Card id="environment" state={props.state} title={language.t("session.info.environment")}>
          <Row name={language.t("session.info.env.runs")} value={location()} />
          <Row name={language.t("session.info.env.project")} value={getFilename(root()) || root()} />
          <Row name={language.t("session.info.env.path")} value={<span title={root()}>{root()}</span>} />
          <Row
            name={language.t("session.info.env.branch")}
            value={sync().data.vcs?.branch ?? language.t("session.info.none")}
          />
        </Card>
        <Card id="context" state={props.state} title={language.t("session.info.context")}>
          <Show
            when={meter.limit() && meter.percent() !== undefined}
            fallback={<div class="text-text-weak">{language.t("session.info.context.empty")}</div>}
          >
            <ContextMeterDetails meter={meter} class="flex flex-col gap-2" />
          </Show>
        </Card>
        <Card id="changes" state={props.state} title={language.t("session.info.changes")}>
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left hover:bg-surface-raised-base-hover"
            onClick={props.onOpenReview}
            title={language.t("session.info.changes.open")}
          >
            <span class="tabular-nums" style={{ color: "var(--text-diff-add-base)" }}>
              +{changes().additions}
            </span>
            <span class="tabular-nums" style={{ color: "var(--text-diff-delete-base)" }}>
              -{changes().deletions}
            </span>
            <span class="text-text-weak">{language.t("session.info.changes.files", { count: changes().files })}</span>
            <Icon name="chevron-right" size="small" class="ml-auto text-icon-weak" />
          </button>
        </Card>
      </div>
    </aside>
  )
}

function Card(props: { id: CardID; state: SessionInfoState; title: string; children: JSX.Element }) {
  const open = () => !props.state.collapsed(props.id)
  return (
    <section class="rounded-lg border border-border-weak-base bg-background-stronger">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 px-3 py-2 text-left text-12-medium text-text-strong"
        aria-expanded={open()}
        onClick={() => props.state.toggleCard(props.id)}
      >
        <Icon
          name="chevron-right"
          size="small"
          class="text-icon-weak transition-transform"
          classList={{ "rotate-90": open() }}
        />
        {props.title}
      </button>
      <Show when={open()}>
        <div class="flex flex-col gap-2 px-3 pb-3 text-12-regular">{props.children}</div>
      </Show>
    </section>
  )
}

function Row(props: { name: string; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-text-weak">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-text-base">{props.value}</span>
    </div>
  )
}
