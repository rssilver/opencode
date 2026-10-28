import { describe, expect, test } from "bun:test"
import { retitleDue, retitlePrompt, sameTitle } from "../../src/session/prompt"
import { Session } from "../../src/session/session"

describe("auto retitle", () => {
  test("triggers at 3 then every 8", () => {
    const due = Array.from({ length: 30 }, (_, i) => i + 1).filter(retitleDue)
    expect(due).toEqual([3, 11, 19, 27])
  })

  test("title comparison ignores case and whitespace padding", () => {
    expect(sameTitle(" Fix Login ", "fix login")).toBe(true)
    expect(sameTitle("Fix login", "Fix signup")).toBe(false)
  })

  test("user-renamed titles are not auto titles", () => {
    expect(Session.isAutoTitle({ title: "Fix login", metadata: { autoTitle: "Fix login" } })).toBe(true)
    expect(Session.isAutoTitle({ title: "My name", metadata: { autoTitle: "Fix login" } })).toBe(false)
    expect(Session.isAutoTitle({ title: "My name" })).toBe(false)
  })

  test("prompt includes current title and instruction", () => {
    const text = retitlePrompt("Fix login", [])
    expect(text).toContain("Current title: Fix login")
    expect(text).toContain("Reply with only the title")
  })
})
