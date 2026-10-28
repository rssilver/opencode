import { describe, expect, test } from "bun:test"
import path from "path"
import { ProjectMemory } from "@/memory/memory"

describe("ProjectMemory", () => {
  test("parse reads bullet lines and ignores everything else", () => {
    expect(ProjectMemory.parse("# Notes\n- one\n\n* two\r\nplain\n  - three  \n")).toEqual(["one", "two", "three"])
  })

  test("add appends newest last, dedupes exact duplicates and rejects empty text", () => {
    const first = ProjectMemory.add([], "use bun")
    expect(first).toEqual({ status: "added", entries: ["use bun"], entry: "use bun" })
    const second = ProjectMemory.add(first.entries, "run tests\nfrom package dir")
    expect(second.entries).toEqual(["use bun", "run tests from package dir"])
    expect(ProjectMemory.add(second.entries, "  use bun ").status).toBe("duplicate")
    expect(ProjectMemory.add(second.entries, "   ").status).toBe("empty")
  })

  test("add caps each entry at 500 characters", () => {
    const result = ProjectMemory.add([], "x".repeat(900))
    expect(result.entries[0]).toHaveLength(500)
  })

  test("remove by 1-based index or exact text", () => {
    const entries = ["a", "b", "c"]
    expect(ProjectMemory.remove(entries, { index: 2 })).toEqual({ status: "removed", entries: ["a", "c"], entry: "b" })
    expect(ProjectMemory.remove(entries, { text: "c" }).entries).toEqual(["a", "b"])
    expect(ProjectMemory.remove(entries, { index: 0 }).status).toBe("missing")
    expect(ProjectMemory.remove(entries, { index: 4 }).status).toBe("missing")
    expect(ProjectMemory.remove(entries, { text: "nope" }).status).toBe("missing")
    expect(ProjectMemory.remove(entries, {}).status).toBe("missing")
  })

  test("serialize and parse round trip", () => {
    const entries = ["a", "b"]
    expect(ProjectMemory.serialize(entries)).toBe("- a\n- b\n")
    expect(ProjectMemory.parse(ProjectMemory.serialize(entries))).toEqual(entries)
    expect(ProjectMemory.serialize([])).toBe("")
  })

  test("render keeps the newest entries within the cap", () => {
    expect(ProjectMemory.render([])).toBeUndefined()
    const out = ProjectMemory.render(["old entry", "middle entry", "newest entry"], 40)
    expect(out).toBe(`${ProjectMemory.HEADING}\n- middle entry\n- newest entry`)
    expect(ProjectMemory.render(["a".repeat(100)], 40)).toBeUndefined()
  })

  test("file lives at the worktree root, or the directory for non-git projects", () => {
    expect(ProjectMemory.file({ directory: "/p/sub", worktree: "/p" })).toBe(path.join("/p", ".opencode", "memory.md"))
    expect(ProjectMemory.file({ directory: "/p/sub", worktree: "/" })).toBe(
      path.join("/p/sub", ".opencode", "memory.md"),
    )
  })
})
