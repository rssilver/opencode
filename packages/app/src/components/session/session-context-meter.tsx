import { Show, createMemo, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { summarizeLabelKeys, summarizeMode, type SummarizeCompaction } from "@/components/summarize-sessions"
import { useSessionLayout } from "@/pages/session/session-layout"
import { latestTokens, sparklinePoints, summaryTrigger, ttftSamples, ttftTrend } from "./context-meter"

const SPARK_WIDTH = 96
const SPARK_HEIGHT = 20

function Row(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-text-weak">{props.name}</span>
      <span class="ml-auto min-w-0 text-right text-text-base">{props.value}</span>
    </div>
  )
}

/** Context meter data shared by the header meter and the session info panel. */
export function useContextMeter() {
  const sync = useSync()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const language = useLanguage()
  const providers = useProviders(() => sdk().directory)
  const { params } = useSessionLayout()

  const messages = createMemo(() => (params.id ? (sync().data.message[params.id] ?? []) : []))
  const compaction = createMemo(() => serverSync().data.config.compaction as SummarizeCompaction | undefined)

  const limit = createMemo(() => {
    const message = messages().findLast((item) => item.role === "assistant")
    const info = message?.role === "assistant" ? message : undefined
    if (!info) return undefined
    const model = providers.all().get(info.providerID)?.models[info.modelID]
    return model?.limit.context ? model.limit : undefined
  })
  const used = createMemo(() => latestTokens(messages()))
  const trigger = createMemo(() => (limit() ? summaryTrigger(limit()!, compaction()) : undefined))
  const trend = createMemo(() =>
    ttftTrend(
      ttftSamples(messages(), (id) => sync().data.part[id]),
      compaction(),
    ),
  )
  const percent = createMemo(() => {
    const context = limit()?.context
    const tokens = used()
    return context && tokens !== undefined ? Math.min(100, Math.round((tokens / context) * 100)) : undefined
  })
  const warn = createMemo(() => !!trend()?.slowing || (trigger() !== undefined && (used() ?? 0) >= trigger()!))
  return { params, compaction, limit, used, trigger, trend, percent, warn }
}

export function ContextMeterDetails(props: { meter: ReturnType<typeof useContextMeter>; class?: string }) {
  const language = useLanguage()
  const { compaction, limit, used, trigger, trend, percent } = props.meter
  const number = (value: number) => value.toLocaleString(language.intl())
  const seconds = (ms: number) => language.t("context.meter.seconds", { value: (ms / 1000).toFixed(1) })
  const share = (tokens: number) => Math.round((tokens / limit()!.context) * 100)

  return (
    <div class={props.class ?? "flex w-[300px] max-w-[calc(100vw-24px)] flex-col gap-2"}>
      <Row
        name={language.t("context.meter.used")}
        value={`${number(used() ?? 0)} / ${number(limit()!.context)} (${percent() ?? 0}%)`}
      />
      <Row
        name={language.t("context.meter.summarizeAt")}
        value={
          trigger() === undefined
            ? language.t("context.meter.summariesOff")
            : `${number(Math.round(trigger()!))} (${share(trigger()!)}%)`
        }
      />
      <Row
        name={language.t("context.meter.mode")}
        value={language.t(summarizeLabelKeys[summarizeMode(compaction())])}
      />
      <Show when={trend()}>
        {(value) => (
          <>
            <Row
              name={language.t("context.meter.ttft")}
              value={language.t("context.meter.ttftValue", {
                latest: seconds(value().latest),
                baseline: seconds(value().baseline),
              })}
            />
            <Show when={value().ratio}>
              {(ratio) => (
                <Row
                  name={language.t("context.meter.ttftRatio")}
                  value={language.t("context.meter.ratio", { value: ratio().toFixed(1) })}
                />
              )}
            </Show>
            <Show when={value().recent.length > 1}>
              <svg
                width={SPARK_WIDTH}
                height={SPARK_HEIGHT}
                viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                class="self-end overflow-visible"
                aria-hidden="true"
              >
                <polyline
                  points={sparklinePoints(value().recent, SPARK_WIDTH, SPARK_HEIGHT)}
                  fill="none"
                  stroke="var(--icon-base)"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
              </svg>
            </Show>
            <Show when={value().slowing}>
              <div style={{ color: "var(--icon-warning-active)" }}>{language.t("context.meter.slowing")}</div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

export function ContextMeter() {
  const language = useLanguage()
  const meter = useContextMeter()
  const { params, limit, percent, warn } = meter
  const details = () => <ContextMeterDetails meter={meter} />

  return (
    <Show when={params.id && limit() && percent() !== undefined}>
      <Tooltip placement="bottom" value={details()}>
        <div
          class="flex h-6 shrink-0 items-center gap-1.5 px-1 text-12-regular text-text-weak"
          role="img"
          aria-label={language.t("context.meter.label", { percent: percent() ?? 0 })}
        >
          <ProgressCircle
            size={16}
            strokeWidth={2}
            percentage={percent() ?? 0}
            style={warn() ? { "--progress-circle-progress": "var(--icon-warning-active)" } : undefined}
          />
          <span class="tabular-nums">{percent()}%</span>
        </div>
      </Tooltip>
    </Show>
  )
}
