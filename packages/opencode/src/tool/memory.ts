import { Effect, Schema } from "effect"
import path from "path"
import { createTwoFilesPatch } from "diff"
import * as Tool from "./tool"
import DESCRIPTION from "./memory.txt"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { ProjectMemory } from "@/memory/memory"
import { trimDiff } from "./edit"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["add", "list", "remove"]).annotate({
    description: "add saves a memory, list shows them, remove deletes one",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "The memory to add, or the exact text of the memory to remove",
  }),
  index: Schema.optional(Schema.Number).annotate({
    description: "1-based number of the memory to remove, as shown by list",
  }),
})

export const MemoryTool = Tool.define(
  "memory",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = ProjectMemory.file(instance)
          const title = path.relative(instance.worktree === "/" ? instance.directory : instance.worktree, filepath)
          const before = (yield* fs.readFileStringSafe(filepath)) ?? ""
          const entries = ProjectMemory.parse(before)

          if (params.action === "list") {
            return {
              title,
              metadata: { count: entries.length },
              output: entries.length
                ? entries.map((entry, i) => `${i + 1}. ${entry}`).join("\n")
                : "No project memories saved yet.",
            }
          }

          const result =
            params.action === "add"
              ? ProjectMemory.add(entries, params.text ?? "")
              : ProjectMemory.remove(entries, { index: params.index, text: params.text })
          const message = describe(params.action, result.status, result.entry)
          if (result.status !== "added" && result.status !== "removed") {
            return { title, metadata: { count: entries.length }, output: message }
          }

          const after = ProjectMemory.serialize(result.entries)
          yield* ctx.ask({
            permission: "edit",
            patterns: [title],
            always: ["*"],
            metadata: { filepath, diff: trimDiff(createTwoFilesPatch(filepath, filepath, before, after)) },
          })
          yield* fs.writeWithDirs(filepath, after)
          return { title, metadata: { count: result.entries.length }, output: message }
        }).pipe(Effect.orDie),
    }
  }),
)

function describe(action: string, status: string, entry?: string) {
  if (status === "added") return `Saved to project memory: ${entry}`
  if (status === "removed") return `Removed from project memory: ${entry}`
  if (status === "duplicate") return `Already in project memory, nothing changed: ${entry}`
  if (action === "add") return "Nothing to save: text is empty."
  return "No matching memory found. Use list to see the saved memories and their numbers."
}
