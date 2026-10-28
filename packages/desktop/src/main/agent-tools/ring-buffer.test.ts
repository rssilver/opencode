import { describe, expect, test } from "bun:test"
import { LineBuffer } from "./ring-buffer"

describe("LineBuffer", () => {
  test("splits chunks into lines and joins partial lines", () => {
    const buffer = new LineBuffer()
    buffer.push("one\ntw")
    buffer.push("o\r\nthree")
    expect(buffer.tail(10)).toEqual(["one", "two", "three"])
  })

  test("keeps only the newest lines", () => {
    const buffer = new LineBuffer(3)
    buffer.push("a\nb\nc\nd\ne\n")
    expect(buffer.tail(10)).toEqual(["c", "d", "e"])
    expect(buffer.tail(2)).toEqual(["d", "e"])
    expect(buffer.tail(0)).toEqual([])
  })
})
