import { describe, expect, test } from "bun:test"
import { desktopMcpEntry, mergeConfigContent } from "./sidecar-config"

const entry = desktopMcpEntry("http://127.0.0.1:1234/mcp", "tok")

describe("mergeConfigContent", () => {
  test("creates config when none exists", () => {
    expect(JSON.parse(mergeConfigContent(undefined, entry))).toEqual({
      mcp: { desktop: entry },
      permission: { desktop_preview_start: "ask" },
    })
  })

  test("keeps existing keys and other MCP servers", () => {
    const existing = JSON.stringify({ model: "x", mcp: { other: { type: "local", command: ["a"] } } })
    const merged = JSON.parse(mergeConfigContent(existing, entry))
    expect(merged.model).toBe("x")
    expect(merged.mcp.other).toEqual({ type: "local", command: ["a"] })
    expect(merged.mcp.desktop.headers.Authorization).toBe("Bearer tok")
  })

  test("replaces unparseable content", () => {
    expect(JSON.parse(mergeConfigContent("{nope", entry))).toEqual({
      mcp: { desktop: entry },
      permission: { desktop_preview_start: "ask" },
    })
  })

  test("asks before preview_start unless the user configured it", () => {
    expect(JSON.parse(mergeConfigContent(undefined, entry)).permission).toEqual({ desktop_preview_start: "ask" })
    const custom = JSON.stringify({ permission: { bash: "deny", desktop_preview_start: "allow" } })
    expect(JSON.parse(mergeConfigContent(custom, entry)).permission).toEqual({
      bash: "deny",
      desktop_preview_start: "allow",
    })
    const kept = JSON.stringify({ permission: { bash: "deny" } })
    expect(JSON.parse(mergeConfigContent(kept, entry)).permission).toEqual({
      bash: "deny",
      desktop_preview_start: "ask",
    })
  })
})
