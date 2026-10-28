import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { Parameters } from "../../src/tool/wrap-up"

const accepts = (input: unknown) => Result.isSuccess(Schema.decodeUnknownResult(Parameters)(input))

describe("tool.wrap_up parameters", () => {
  test("accepts a recap alone", () => expect(accepts({ recap: "Done." })).toBe(true))

  test("accepts a question with one or two actions", () => {
    const actions = [
      { label: "Commit", message: "Commit the changes" },
      { label: "Not yet", message: "Do not commit yet" },
    ]
    expect(accepts({ recap: "Done.", question: "Commit?", actions: actions.slice(0, 1) })).toBe(true)
    expect(accepts({ recap: "Done.", question: "Commit?", actions })).toBe(true)
    expect(accepts({ recap: "Done.", question: "Commit?" })).toBe(true)
  })

  test("rejects actions without a question", () => {
    expect(accepts({ recap: "Done.", actions: [{ label: "Commit", message: "go" }] })).toBe(false)
  })

  test("rejects more than two actions", () => {
    const action = { label: "Ok", message: "ok" }
    expect(accepts({ recap: "Done.", question: "Q?", actions: [action, action, action] })).toBe(false)
  })

  test("rejects long labels and empty fields", () => {
    expect(accepts({ recap: "Done.", question: "Q?", actions: [{ label: "one two three four", message: "x" }] })).toBe(
      false,
    )
    expect(accepts({ recap: "" })).toBe(false)
    expect(accepts({})).toBe(false)
  })
})
