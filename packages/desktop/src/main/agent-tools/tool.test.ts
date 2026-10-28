import { describe, expect, test } from "bun:test"
import { number, optionalString, runTool, string, ToolError, type Tool } from "./tool"

describe("argument helpers", () => {
  test("validate types", () => {
    expect(string({ a: "x" }, "a")).toBe("x")
    expect(() => string({}, "a")).toThrow(ToolError)
    expect(optionalString({}, "a")).toBeUndefined()
    expect(optionalString({ a: "" }, "a")).toBeUndefined()
    expect(() => optionalString({ a: 1 }, "a")).toThrow(ToolError)
    expect(number({ n: 2 }, "n")).toBe(2)
    expect(() => number({ n: "2" }, "n")).toThrow(ToolError)
  })
})

describe("runTool", () => {
  const tool = (run: Tool["run"]): Tool => ({
    name: "t",
    description: "",
    inputSchema: { type: "object", properties: {} },
    run,
  })

  test("passes results through", async () => {
    const result = await runTool(
      tool(async () => ({ content: [{ type: "text", text: "ok" }] })),
      {},
    )
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] })
  })

  test("turns thrown errors into tool errors", async () => {
    const result = await runTool(
      tool(async () => {
        throw new ToolError("nope")
      }),
      {},
    )
    expect(result).toEqual({ content: [{ type: "text", text: "nope" }], isError: true })
  })
})
