import { expect, test } from "bun:test"
import { LLM, LLMEvent, Message, Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import type { EventV2 } from "@opencode-ai/core/event"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { DateTime, Effect, Stream } from "effect"

const sessionID = SessionSchema.ID.make("ses_trigger")
const model = Model.make({
  id: "trigger",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 10_000, output: 100 } }),
})
const created = DateTime.makeUnsafe(0)

const harness = (compaction: ConstructorParameters<typeof ConfigCompaction.Info>[0]) => {
  const streams: number[] = []
  const compactor = SessionCompaction.make({
    events: { publish: () => Effect.succeed(undefined) } as unknown as EventV2.Interface,
    llm: {
      stream: () => {
        streams.push(streams.length)
        return Stream.fromIterable([LLMEvent.textDelta({ id: "summary", text: "## Objective\n- summary" })])
      },
    },
    config: [
      new Config.Document({
        type: "document",
        info: new Config.Info({ compaction: new ConfigCompaction.Info(compaction) }),
      }),
    ],
  })
  // Roughly four characters per estimated token.
  const run = (tokens: number, after?: readonly SessionMessage.Message[]) => {
    const text = "x".repeat(tokens * 4)
    return Effect.runPromise(
      compactor.compactIfNeeded({
        sessionID,
        entries: after
          ? after.map((message, index) => ({ seq: index + 1, message }))
          : [
              {
                seq: 1,
                message: SessionMessage.User.make({
                  id: SessionMessage.ID.make("msg_first"),
                  type: "user",
                  text,
                  time: { created },
                }),
              },
              {
                seq: 2,
                message: SessionMessage.User.make({
                  id: SessionMessage.ID.make("msg_second"),
                  type: "user",
                  text: "latest",
                  time: { created },
                }),
              },
            ],
        model,
        request: LLM.request({ model, messages: [Message.user(text)] }),
      }),
    )
  }
  return { compactor, streams, run }
}

test("compacts only at the hard limit when no threshold is configured", async () => {
  const { streams, run } = harness({ buffer: 1_000, keep: new ConfigCompaction.Keep({ tokens: 10 }) })
  expect(await run(5_000)).toBe(false)
  expect(await run(9_500)).toBe(true)
  expect(streams.length).toBe(1)
})

test("compacts when the estimate crosses the configured fraction of context", async () => {
  const { run } = harness({ threshold: 0.4, buffer: 1_000, keep: new ConfigCompaction.Keep({ tokens: 10 }) })
  expect(await run(3_000)).toBe(false)
  expect(await run(5_000)).toBe(true)
})

test("a threshold cannot loosen the hard limit", async () => {
  const { run } = harness({ threshold: 1, buffer: 1_000, keep: new ConfigCompaction.Keep({ tokens: 10 }) })
  expect(await run(8_000)).toBe(false)
  expect(await run(9_500)).toBe(true)
})

const user = (name: string) =>
  SessionMessage.User.make({ id: SessionMessage.ID.make(`msg_${name}`), type: "user", text: name, time: { created } })
const summary = SessionMessage.Compaction.make({
  id: SessionMessage.ID.make("msg_summary"),
  type: "compaction",
  reason: "auto",
  summary: "Earlier work",
  recent: "Recent work",
  time: { created },
})

test("threshold compaction waits for two new user messages after a compaction", async () => {
  const { run } = harness({ threshold: 0.4, buffer: 1_000, keep: new ConfigCompaction.Keep({ tokens: 10 }) })
  expect(await run(5_000, [summary, user("a")])).toBe(false)
  expect(await run(5_000, [user("old"), summary, user("a"), user("b")])).toBe(true)
})

test("ttft compaction waits for two new user messages after a compaction", async () => {
  const { compactor, run } = harness({
    ttft: new ConfigCompaction.TTFT({ enabled: true }),
    keep: new ConfigCompaction.Keep({ tokens: 100 }),
    buffer: 1_000,
  })
  ;[500, 400, 450, 5_000].forEach((ms) => compactor.recordTTFT(sessionID, ms))
  expect(await run(1_000, [summary, user("a")])).toBe(false)
  expect(await run(1_000, [summary, user("a"), user("b")])).toBe(true)
})

test("the hard limit ignores the new-message guard", async () => {
  const { run } = harness({ threshold: 0.4, buffer: 1_000, keep: new ConfigCompaction.Keep({ tokens: 10 }) })
  expect(await run(9_500, [summary, user("a")])).toBe(true)
})

test("auto false disables threshold compaction", async () => {
  const { run } = harness({ auto: false, threshold: 0.1, buffer: 1_000 })
  expect(await run(5_000)).toBe(false)
})

test("compacts after time-to-first-token degrades and then clears the baseline", async () => {
  const { compactor, run } = harness({
    ttft: new ConfigCompaction.TTFT({ enabled: true }),
    keep: new ConfigCompaction.Keep({ tokens: 100 }),
    buffer: 1_000,
  })
  expect(await run(1_000)).toBe(false)
  ;[500, 400, 450, 5_000].forEach((ms) => compactor.recordTTFT(sessionID, ms))
  expect(await run(1_000)).toBe(true)
  expect(await run(1_000)).toBe(false)
})

test("does not compact on slow time-to-first-token when disabled or when the session is tiny", async () => {
  const disabled = harness({ keep: new ConfigCompaction.Keep({ tokens: 100 }), buffer: 1_000 })
  ;[500, 5_000].forEach((ms) => disabled.compactor.recordTTFT(sessionID, ms))
  expect(await disabled.run(1_000)).toBe(false)

  const tiny = harness({
    ttft: new ConfigCompaction.TTFT({ enabled: true }),
    keep: new ConfigCompaction.Keep({ tokens: 3_000 }),
    buffer: 1_000,
  })
  ;[500, 5_000].forEach((ms) => tiny.compactor.recordTTFT(sessionID, ms))
  expect(await tiny.run(1_000)).toBe(false)
})

test("ttft factor and min_ms are configurable", async () => {
  const { compactor, run } = harness({
    ttft: new ConfigCompaction.TTFT({ enabled: true, factor: 2, min_ms: 100 }),
    keep: new ConfigCompaction.Keep({ tokens: 100 }),
    buffer: 1_000,
  })
  ;[100, 350].forEach((ms) => compactor.recordTTFT(sessionID, ms))
  expect(await run(1_000)).toBe(true)
})

test("ttftDegraded uses the minimum of the first three samples as the baseline", () => {
  const input = { factor: 3, minMs: 1_500 }
  expect(SessionCompaction.ttftDegraded({ ...input, samples: [], latest: 10_000 })).toBe(false)
  // Baseline 400 (min of first three), latest 5000 > 1200 and 4600 > 1500.
  expect(SessionCompaction.ttftDegraded({ ...input, samples: [500, 400, 450, 5_000], latest: 5_000 })).toBe(true)
  // A fourth sample never lowers the baseline.
  expect(SessionCompaction.ttftDegraded({ ...input, samples: [500, 400, 450, 10], latest: 3_000 })).toBe(true)
})

test("ttftDegraded requires strictly exceeding both the factor and min_ms", () => {
  const input = { factor: 3, minMs: 1_500 }
  // factor edge: 3000 is exactly 3x of 1000, not greater.
  expect(SessionCompaction.ttftDegraded({ ...input, samples: [1_000, 1_000], latest: 3_000 })).toBe(false)
  expect(SessionCompaction.ttftDegraded({ ...input, samples: [1_000, 1_000], latest: 3_001 })).toBe(true)
  // min_ms edge: factor met but the absolute increase is only 1500.
  expect(SessionCompaction.ttftDegraded({ ...input, samples: [500, 500], latest: 2_000 })).toBe(false)
  expect(SessionCompaction.ttftDegraded({ ...input, samples: [500, 500], latest: 2_001 })).toBe(true)
  // min_ms edge: absolute increase large enough but the factor is not met.
  expect(SessionCompaction.ttftDegraded({ ...input, samples: [10_000, 10_000], latest: 12_000 })).toBe(false)
})
