import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { parseLaunchConfig, windowsCommandLine } from "./launch-config"

const dir = resolve("project")

describe("parseLaunchConfig", () => {
  test("parses a valid configuration with defaults", () => {
    const result = parseLaunchConfig(
      JSON.stringify({ configurations: [{ name: "web", command: "bun", args: ["dev"], port: 3000 }] }),
      dir,
    )
    expect(result.errors).toEqual([])
    expect(result.configurations).toEqual([
      { name: "web", command: "bun", args: ["dev"], cwd: dir, port: 3000, url: undefined, env: {} },
    ])
  })

  test("resolves a relative cwd and keeps env and url", () => {
    const result = parseLaunchConfig(
      JSON.stringify({
        configurations: [
          { name: "a", command: "npm", cwd: "apps/web", port: 80, url: "http://localhost:80/x", env: { A: "1" } },
        ],
      }),
      dir,
    )
    expect(result.configurations[0].cwd).toBe(resolve(dir, "apps/web"))
    expect(result.configurations[0].url).toBe("http://localhost:80/x")
    expect(result.configurations[0].env).toEqual({ A: "1" })
  })

  test("rejects invalid entries but keeps valid ones", () => {
    const result = parseLaunchConfig(
      JSON.stringify({
        configurations: [
          { name: "ok", command: "x", port: 1 },
          { name: "badport", command: "x", port: 0 },
          { command: "x", port: 1 },
          { name: "esc", command: "x", port: 1, cwd: "../other" },
          { name: "abs", command: "x", port: 1, cwd: resolve("elsewhere") },
          { name: "scheme", command: "x", port: 1, url: "file:///etc/passwd" },
          { name: "quote", command: 'x"y', port: 1 },
          { name: "ok", command: "dup", port: 2 },
        ],
      }),
      dir,
    )
    expect(result.configurations.map((c) => c.name)).toEqual(["ok"])
    expect(result.errors).toHaveLength(7)
  })

  test("reports malformed json and wrong shapes", () => {
    expect(parseLaunchConfig("{", dir).errors[0]).toContain("Invalid JSON")
    expect(parseLaunchConfig("[]", dir).errors).toHaveLength(1)
    expect(parseLaunchConfig("{}", dir).configurations).toEqual([])
  })
})

describe("windowsCommandLine", () => {
  test("quotes parts that need it", () => {
    expect(windowsCommandLine("bun", ["run", "dev"])).toBe("bun run dev")
    expect(windowsCommandLine("C:\\Program Files\\x.cmd", ["a&b", ""])).toBe('"C:\\Program Files\\x.cmd" "a&b" ""')
  })
})
