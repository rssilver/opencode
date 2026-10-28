import { describe, expect, test } from "bun:test"
import {
  chunkCues,
  formatTime,
  frameTimes,
  inspectScript,
  panelCues,
  parseChapters,
  parseTime,
  parseVtt,
  restoreScript,
  seekScript,
} from "./video-script"

describe("time helpers", () => {
  test("parse and format", () => {
    expect(parseTime("4:10")).toBe(250)
    expect(parseTime(12)).toBe(12)
    expect(parseTime("x")).toBeUndefined()
    expect(formatTime(3723)).toBe("1:02:03")
    expect(formatTime(9)).toBe("0:09")
  })
})

describe("parseChapters", () => {
  test("reads timestamped description lines starting at 0:00", () => {
    const description = "Intro text\n0:00 Intro\n1:23 - Setup\n(10:05) Deploy\n1:02:03 | Outro\nthanks"
    expect(parseChapters(description)).toEqual([
      { start: 0, title: "Intro" },
      { start: 83, title: "Setup" },
      { start: 605, title: "Deploy" },
      { start: 3723, title: "Outro" },
    ])
  })

  test("ignores stray timestamps that are not a chapter list", () => {
    expect(parseChapters("great moment at\n4:10 wow")).toEqual([])
  })
})

describe("transcripts", () => {
  test("panel rows become cues ending at the next row", () => {
    const rows = [
      { start: -1, end: -1, text: "0:00\u0000hello" },
      { start: -1, end: -1, text: "0:05\u0000world" },
      { start: -1, end: -1, text: "bad\u0000skip" },
    ]
    expect(panelCues(rows, 20)).toEqual([
      { start: 0, end: 5, text: "hello" },
      { start: 5, end: 20, text: "world" },
    ])
  })

  test("parseVtt decodes entities and strips tags", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<c>it&#39;s</c> &quot;fine&quot;\n"
    expect(parseVtt(vtt)).toEqual([{ start: 1, end: 2, text: `it's "fine"` }])
  })

  test("chunkCues groups by window", () => {
    const chunks = chunkCues(
      [
        { start: 0, end: 1, text: "a" },
        { start: 10, end: 11, text: "b" },
        { start: 40, end: 41, text: "c" },
      ],
      30,
    )
    expect(chunks.map((chunk) => chunk.text)).toEqual(["a b", "c"])
  })
})

describe("frameTimes", () => {
  test("includes chapter starts, fills evenly, stays sorted and capped", () => {
    const times = frameTimes(0, 100, 4, [0, 50])
    expect(times.length).toBe(4)
    expect(times).toContain(1)
    expect(times).toContain(51)
    expect(times).toEqual(times.toSorted((a, b) => a - b))
  })

  test("zoomed range ignores chapters outside it", () => {
    expect(frameTimes(10, 20, 2, [0, 50])).toEqual([12.5, 17.5])
  })
})

describe("page scripts", () => {
  test("embed data only as literals and parse", () => {
    expect(seekScript(12.5)).toContain("video.currentTime = 12.5")
    expect(seekScript(-3)).toContain("video.currentTime = 0")
    expect(restoreScript(4, true)).toContain("if (true)")
    expect(inspectScript(false)).toContain("&& false")
    for (const script of [seekScript(1), restoreScript(1, false), inspectScript(true)])
      expect(() => new Function(script)).not.toThrow()
  })
})
