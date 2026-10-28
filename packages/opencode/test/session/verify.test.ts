import { describe, expect, test } from "bun:test"
import { SessionVerify } from "@/session/verify"

const user = { kind: "user" } as const
const edit = { kind: "tool", tool: "edit", completed: true } as const
const read = { kind: "tool", tool: "read", completed: true } as const
const pass = { kind: "verify", passed: true } as const
const fail = { kind: "verify", passed: false } as const

describe("SessionVerify.settings", () => {
  test("requires a command and applies defaults", () => {
    expect(SessionVerify.settings(undefined)).toBeUndefined()
    expect(SessionVerify.settings({ command: "  " })).toBeUndefined()
    expect(SessionVerify.settings({ command: "bun test", enabled: false })).toBeUndefined()
    expect(SessionVerify.settings({ command: " bun test " })).toEqual({
      command: "bun test",
      timeoutMs: 120_000,
      maxAttempts: 2,
    })
    expect(SessionVerify.settings({ command: "x", timeout_ms: 5, max_attempts: 4, enabled: true })).toEqual({
      command: "x",
      timeoutMs: 5,
      maxAttempts: 4,
    })
  })
})

describe("SessionVerify.decide", () => {
  const decide = (events: SessionVerify.Event[], extra = {}) =>
    SessionVerify.decide({ events, maxAttempts: 2, ...extra })

  test("runs after a successful file-changing tool", () => {
    expect(decide([user, read, edit])).toEqual({ run: true, attempt: 1 })
    for (const tool of ["write", "apply_patch", "patch", "multiedit"])
      expect(decide([user, { kind: "tool", tool, completed: true }]).run).toBe(true)
  })

  test("does not run without changes, with failed edits, or for other tools", () => {
    expect(decide([user, read]).run).toBe(false)
    expect(decide([user, { kind: "tool", tool: "edit", completed: false }]).run).toBe(false)
    expect(decide([]).run).toBe(false)
  })

  test("changes before the last user message or last verification do not count", () => {
    expect(decide([edit, user, read]).run).toBe(false)
    expect(decide([user, edit, pass]).run).toBe(false)
    expect(decide([user, edit, pass, edit]).run).toBe(true)
  })

  test("counts attempts per user message and stops at the limit", () => {
    expect(decide([user, edit, fail, edit])).toEqual({ run: true, attempt: 2 })
    expect(decide([user, edit, fail, edit, fail, edit]).run).toBe(false)
    expect(decide([user, edit, fail, edit, fail, user, edit])).toEqual({ run: true, attempt: 1 })
  })

  test("never runs for subagents or aborted runs", () => {
    expect(decide([user, edit], { subagent: true }).run).toBe(false)
    expect(decide([user, edit], { aborted: true }).run).toBe(false)
  })
})

describe("SessionVerify text", () => {
  test("tail keeps the end of long output", () => {
    expect(SessionVerify.tail("short")).toBe("short")
    const out = SessionVerify.tail("a".repeat(9000) + "END")
    expect(out).toContain("last 8000 characters")
    expect(out.endsWith("END")).toBe(true)
    expect(out.length).toBeLessThan(8100)
  })

  test("notes describe the outcome", () => {
    expect(SessionVerify.passedNote("bun test")).toBe("Verify passed: bun test")
    expect(SessionVerify.failedNote({ command: "c", attempt: 1, maxAttempts: 2, exitCode: 1 })).toContain("attempt 1/2")
    expect(SessionVerify.failedNote({ command: "c", attempt: 2, maxAttempts: 2, exitCode: null })).toContain(
      "still fails",
    )
  })

  test("fix prompt carries command, exit code and output", () => {
    const prompt = SessionVerify.fixPrompt({ command: "bun test", exitCode: 2, output: "boom" })
    expect(prompt).toContain("`bun test`")
    expect(prompt).toContain("exited with code 2")
    expect(prompt).toContain("boom")
  })
})
