import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { Parameters } from "../../src/tool/show-visual"

const accepts = (input: unknown) => Result.isSuccess(Schema.decodeUnknownResult(Parameters)(input))

describe("tool.show_visual parameters", () => {
  test("accepts a title and html", () => {
    expect(accepts({ title: "Graph", html: "<canvas></canvas><script>1</script>" })).toBe(true)
  })

  test("rejects empty or missing fields", () => {
    expect(accepts({ title: "", html: "<p>x</p>" })).toBe(false)
    expect(accepts({ title: "Graph", html: "" })).toBe(false)
    expect(accepts({ title: "Graph" })).toBe(false)
    expect(accepts({})).toBe(false)
  })

  test("rejects oversized html", () => {
    expect(accepts({ title: "Big", html: "x".repeat(400_001) })).toBe(false)
  })
})
