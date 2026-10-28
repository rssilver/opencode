import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LLMEvent } from "@opencode-ai/llm"
import { Effect, Layer, Stream } from "effect"
import path from "path"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageID, SessionID } from "@/session/schema"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { deliveryMode, dimensions, ViewImagesTool } from "@/tool/view-images"
import { ProviderTest } from "../fake/provider"
import { TestConfig } from "../fixture/config"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
)
// Minimal JPEG header with a start-of-frame marker: 64x32.
const jpg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03,
  0x11, 0x01, 0xff, 0xd9,
])

const visionProvider = ProviderTest.fake()
const sighted = ProviderTest.model({
  id: ProviderTest.model().id,
  capabilities: {
    ...ProviderTest.model().capabilities,
    input: { ...ProviderTest.model().capabilities.input, image: true },
  },
})
const blind = ProviderTest.model()

// Test knobs read by the fake Config and LLM layers below.
const state = { vision: undefined as string | undefined, requests: [] as LLM.StreamInput[] }

const llmLayer = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: (input) => {
      state.requests.push(input)
      return Stream.make(
        LLMEvent.textStart({ id: "txt-0" }),
        LLMEvent.textDelta({ id: "txt-0", text: "a tiny red pixel and a wide photo" }),
        LLMEvent.textEnd({ id: "txt-0" }),
      )
    },
  }),
)

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(
      LayerNode.group([
        Agent.node,
        FSUtil.node,
        Config.node,
        Provider.node,
        LLM.node,
        CrossSpawnSpawner.node,
        Truncate.node,
      ]),
      [
        [
          Config.node,
          TestConfig.layer({ get: () => Effect.succeed(state.vision ? { vision: { model: state.vision } } : {}) }),
        ],
        [Provider.node, visionProvider.layer],
        [LLM.node, llmLayer],
      ],
    ),
    testInstanceStoreLayer,
  ),
)

const user = {
  info: {
    id: MessageID.make("msg_user"),
    role: "user" as const,
    sessionID: SessionID.make("ses_test"),
    agent: "build",
    model: { providerID: blind.providerID, modelID: blind.id },
    time: { created: 0 },
  },
  parts: [],
}

const context = (model: Provider.Model): Tool.Context => ({
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  extra: { model },
  messages: [user],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const exec = Effect.fn("ViewImagesTest.exec")(function* (
  dir: string,
  args: Tool.InferParameters<typeof ViewImagesTool>,
  model: Provider.Model = sighted,
) {
  const info = yield* ViewImagesTool
  const tool = yield* info.init()
  return yield* provideInstance(dir)(tool.execute(args, context(model)))
})

const fixture = Effect.fn("ViewImagesTest.fixture")(function* () {
  const dir = yield* tmpdirScoped()
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(path.join(dir, "b.png"), png)
  yield* fs.writeWithDirs(path.join(dir, "a.jpg"), jpg)
  yield* fs.writeWithDirs(path.join(dir, "notes.txt"), "not an image")
  yield* fs.writeWithDirs(path.join(dir, "fake.png"), "this is not really a png")
  yield* fs.writeWithDirs(path.join(dir, "sub", "c.png"), png)
  return dir
})

describe("tool.view_images", () => {
  it.live("lists real images sorted by path and attaches them", () =>
    Effect.gen(function* () {
      const dir = yield* fixture()
      const result = yield* exec(dir, { path: "." })
      expect(result.output).toContain("Found 2 image(s)")
      expect(result.output).toContain("1. a.jpg (image/jpeg, 64x32")
      expect(result.output).toContain("2. b.png (image/png, 1x1")
      expect(result.output).not.toContain("fake.png")
      expect(result.output).not.toContain("notes.txt")
      expect(result.output).not.toContain("sub/c.png")
      expect(result.attachments?.map((item) => item.mime)).toEqual(["image/jpeg", "image/png"])
      expect(result.attachments?.[0].url.startsWith("data:image/jpeg;base64,")).toBe(true)
      expect(result.attachments?.[0]).not.toHaveProperty("id")
    }),
  )

  it.live("pages with offset and limit and supports recursion and patterns", () =>
    Effect.gen(function* () {
      const dir = yield* fixture()
      const first = yield* exec(dir, { path: dir, recursive: true, limit: 1 })
      expect(first.output).toContain("Found 3 image(s)")
      expect(first.output).toContain("Showing 1-1 of 3")
      expect(first.output).toContain("offset=1 (2 more)")
      expect(first.attachments?.length).toBe(1)

      const last = yield* exec(dir, { path: dir, recursive: true, limit: 2, offset: 2 })
      expect(last.output).toContain("3. sub/c.png")
      expect(last.output).toContain("No more images.")
      expect(last.attachments?.length).toBe(1)

      const filtered = yield* exec(dir, { path: dir, pattern: "*.png", recursive: true })
      expect(filtered.attachments?.length).toBe(2)
      expect(filtered.output).not.toContain("a.jpg")
    }),
  )

  it.live("accepts a single image file and clamps the limit", () =>
    Effect.gen(function* () {
      const dir = yield* fixture()
      const single = yield* exec(dir, { path: "b.png" })
      expect(single.attachments?.length).toBe(1)
      const clamped = yield* exec(dir, { path: dir, limit: 500 })
      expect(clamped.metadata.shown).toBe(2)
    }),
  )

  it.live("explains how to configure vision.model when the model cannot see images", () =>
    Effect.gen(function* () {
      state.vision = undefined
      const dir = yield* fixture()
      const result = yield* exec(dir, { path: dir }, blind)
      expect(result.attachments).toBeUndefined()
      expect(result.metadata.mode).toBe("unsupported")
      expect(result.output).toContain("cannot view images")
      expect(result.output).toContain('"vision"')
    }),
  )

  it.live("describes images through the configured vision model for text-only models", () =>
    Effect.gen(function* () {
      state.vision = `${blind.providerID}/${blind.id}`
      state.requests.length = 0
      const dir = yield* fixture()
      const result = yield* exec(dir, { path: dir, question: "What is shown?" }, blind)
      state.vision = undefined
      expect(result.attachments).toBeUndefined()
      expect(result.metadata.mode).toBe("describe")
      expect(result.output).toContain("a tiny red pixel and a wide photo")
      expect(state.requests.length).toBe(1)
      const content = state.requests[0].messages[0].content
      expect(Array.isArray(content) && content.filter((part) => part.type === "image").length).toBe(2)
      expect(JSON.stringify(content)).toContain("What is shown?")
      expect(JSON.stringify(content)).toContain("Image: a.jpg")
    }),
  )
})

describe("view_images helpers", () => {
  it.live("picks a delivery mode from model support and config", () =>
    Effect.sync(() => {
      expect(deliveryMode({ supportsImages: true, visionModel: "a/b" })).toBe("attach")
      expect(deliveryMode({ supportsImages: false, visionModel: "a/b" })).toBe("describe")
      expect(deliveryMode({ supportsImages: false })).toBe("unsupported")
    }),
  )

  it.live("reads png and jpeg dimensions", () =>
    Effect.sync(() => {
      expect(dimensions(png, "image/png")).toEqual({ width: 1, height: 1 })
      expect(dimensions(jpg, "image/jpeg")).toEqual({ width: 64, height: 32 })
    }),
  )
})
