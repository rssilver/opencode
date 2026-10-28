import { describe, expect, test } from "bun:test"
import type { Part as PartType } from "@opencode-ai/sdk/v2"
import type { ThinkingCollapseMode } from "./message-part"
import { partDefaultOpen } from "./part-default-open"

describe("partDefaultOpen", () => {
  test("keeps edited files expanded when enabled", () => {
    expect(partDefaultOpen(tool("edit", { filediff: { additions: 1, deletions: 1 } }), "no", true)).toBe(true)
  })

  test("collapses deletion-only edits when enabled", () => {
    expect(partDefaultOpen(tool("edit", { filediff: { additions: 0, deletions: 1_200 } }), "no", true)).toBe(false)
  })

  test("collapses patches containing only deleted files when enabled", () => {
    expect(
      partDefaultOpen(
        tool("apply_patch", {
          files: [
            { filePath: "one.ts", type: "delete" },
            { filePath: "two.ts", type: "delete" },
          ],
        }),
        "no",
        true,
      ),
    ).toBe(false)
  })

  test("keeps mixed patches expanded when enabled", () => {
    expect(
      partDefaultOpen(
        tool("apply_patch", {
          files: [
            { filePath: "one.ts", type: "delete" },
            { filePath: "two.ts", type: "update" },
          ],
        }),
        "no",
        true,
      ),
    ).toBe(true)
  })

  test("shell expands when mode is no and collapses when mode is yes", () => {
    expect(partDefaultOpen(tool("shell", {}), "no")).toBe(true)
    expect(partDefaultOpen(tool("shell", {}), "yes")).toBe(false)
  })

  test("shell stays open while running and collapses once complete", () => {
    expect(partDefaultOpen(tool("shell", {}, "running"), "once-complete")).toBe(true)
    expect(partDefaultOpen(tool("shell", {}, "completed"), "once-complete")).toBe(false)
    expect(partDefaultOpen(tool("shell", {}, "error"), "once-complete")).toBe(false)
  })
})

function tool(name: string, metadata: Record<string, unknown>, status = "completed"): PartType {
  return {
    id: `part_${name}`,
    sessionID: "session",
    messageID: "message",
    type: "tool",
    callID: `call_${name}`,
    tool: name,
    state: {
      status,
      input: {},
      output: "",
      title: name,
      metadata,
      time: { start: 0, end: 1 },
    },
  } as PartType
}
