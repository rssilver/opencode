import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID, SessionID } from "@/session/schema"
import { MemoryTool } from "@/tool/memory"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { TestConfig } from "../fixture/config"
import { disposeAllInstances, provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Agent.node, FSUtil.node, Config.node, CrossSpawnSpawner.node, Truncate.node]), [
      [Config.node, TestConfig.layer()],
    ]),
    testInstanceStoreLayer,
  ),
)

const asks: { permission: string; patterns: readonly string[] }[] = []

const context = (deny = false): Tool.Context => ({
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: (input) =>
    Effect.suspend(() => {
      asks.push({ permission: input.permission, patterns: input.patterns })
      return deny ? Effect.die(new Error("denied")) : Effect.void
    }),
})

const exec = Effect.fn("MemoryTest.exec")(function* (
  dir: string,
  args: Tool.InferParameters<typeof MemoryTool>,
  deny = false,
) {
  const info = yield* MemoryTool
  const tool = yield* info.init()
  return yield* provideInstance(dir)(tool.execute(args, context(deny)))
})

describe("tool.memory", () => {
  it.live("adds, dedupes, lists and removes entries in .opencode/memory.md", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      const file = path.join(dir, ".opencode", "memory.md")

      expect((yield* exec(dir, { action: "list" })).output).toContain("No project memories")
      expect((yield* exec(dir, { action: "add", text: "use bun" })).output).toContain("Saved")
      yield* exec(dir, { action: "add", text: "tests live in test/" })
      expect((yield* exec(dir, { action: "add", text: "use bun" })).output).toContain("Already in project memory")
      expect(yield* fs.readFileString(file)).toBe("- use bun\n- tests live in test/\n")
      expect((yield* exec(dir, { action: "list" })).output).toBe("1. use bun\n2. tests live in test/")

      yield* exec(dir, { action: "remove", index: 1 })
      expect(yield* fs.readFileString(file)).toBe("- tests live in test/\n")
      yield* exec(dir, { action: "remove", text: "tests live in test/" })
      expect(yield* fs.readFileString(file)).toBe("")
      expect((yield* exec(dir, { action: "remove", index: 3 })).output).toContain("No matching memory")
    }),
  )

  it.live("asks for edit permission before writing and leaves the file alone when denied", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* FSUtil.Service
      asks.length = 0
      yield* exec(dir, { action: "add", text: "kept" }, true).pipe(Effect.exit)
      expect(asks.at(-1)?.permission).toBe("edit")
      expect(yield* fs.existsSafe(path.join(dir, ".opencode", "memory.md"))).toBe(false)
    }),
  )
})
