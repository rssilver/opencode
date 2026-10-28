import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { Process } from "@/util/process"
import { chunkCues, evenTimes, formatTime, parseSubtitles, parseTime, pickFrames, watch } from "@/tool/video-watch"

describe("timestamps", () => {
  test("parseTime accepts seconds and clock strings", () => {
    expect(parseTime(90)).toBe(90)
    expect(parseTime("250")).toBe(250)
    expect(parseTime("4:10")).toBe(250)
    expect(parseTime("1:02:03.5")).toBe(3723.5)
    expect(parseTime("abc")).toBeUndefined()
    expect(parseTime("1:2:3:4")).toBeUndefined()
    expect(parseTime(-1)).toBeUndefined()
    expect(parseTime(undefined)).toBeUndefined()
  })

  test("formatTime uses m:ss and h:mm:ss", () => {
    expect(formatTime(0)).toBe("0:00")
    expect(formatTime(65.9)).toBe("1:05")
    expect(formatTime(3723)).toBe("1:02:03")
  })
})

describe("subtitles", () => {
  test("parses WebVTT with markup and drops repeated cues", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:03.500 align:start",
      "<c>Hello</c> &amp; welcome",
      "",
      "00:00:03.500 --> 00:00:05.000",
      "Hello &amp; welcome",
      "",
      "1:02:03.250 --> 1:02:04.000",
      "Later line",
    ].join("\n")
    expect(parseSubtitles(vtt)).toEqual([
      { start: 1, end: 3.5, text: "Hello & welcome" },
      { start: 3723.25, end: 3724, text: "Later line" },
    ])
  })

  test("parses SRT with comma decimals and index lines", () => {
    const srt = "1\r\n00:00:00,500 --> 00:00:02,000\r\nFirst\r\nline\r\n\r\n2\r\n00:00:02,000 --> 00:00:04,000\r\nSecond\r\n"
    expect(parseSubtitles(srt)).toEqual([
      { start: 0.5, end: 2, text: "First line" },
      { start: 2, end: 4, text: "Second" },
    ])
  })

  test("chunks cues and trims rolling-caption overlap", () => {
    const chunks = chunkCues(
      [
        { start: 0, end: 2, text: "so today we" },
        { start: 2, end: 4, text: "today we build a tool" },
        { start: 31, end: 33, text: "next part" },
      ],
      30,
    )
    expect(chunks).toEqual([
      { start: 0, end: 4, text: "so today we build a tool" },
      { start: 31, end: 33, text: "next part" },
    ])
  })
})

describe("frame selection", () => {
  test("evenTimes centers frames in equal slices", () => {
    expect(evenTimes(0, 10, 5)).toEqual([1, 3, 5, 7, 9])
  })

  test("prefers scenes and narration, fills evenly, merges near-duplicates", () => {
    const frames = pickFrames({ start: 0, end: 100, max: 5, scenes: [0.2, 40, 41], narration: [70] })
    expect(frames.length).toBe(5)
    expect(frames.map((frame) => frame.reason)).toContain("narration")
    expect(frames.filter((frame) => frame.time >= 40 && frame.time <= 41).length).toBe(1)
    expect(frames.map((frame) => frame.time)).toEqual(frames.map((frame) => frame.time).toSorted((a, b) => a - b))
  })

  test("downsamples when there are more scene changes than frames", () => {
    const scenes = Array.from({ length: 50 }, (_, i) => i * 2 + 1)
    const frames = pickFrames({ start: 0, end: 100, max: 4, scenes, narration: [] })
    expect(frames.length).toBe(4)
    expect(frames.every((frame) => frame.reason === "scene")).toBe(true)
  })

  test("stays inside a zoomed range", () => {
    const frames = pickFrames({ start: 250, end: 280, max: 6, scenes: [10, 260], narration: [] })
    expect(frames.every((frame) => frame.time >= 250 && frame.time < 280)).toBe(true)
    expect(frames.length).toBe(6)
  })
})

const hasFfmpeg = await Process.run(["ffmpeg", "-version"], { nothrow: true }).then(
  (result) => result.code === 0,
  () => false,
)

describe.skipIf(!hasFfmpeg)("watch (ffmpeg)", () => {
  test("extracts frames, embedded subtitles and a zoomed range from a generated video", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "video-watch-test-"))
    try {
      const srt = path.join(dir, "subs.srt")
      await writeFile(
        srt,
        "1\n00:00:01,000 --> 00:00:03,000\nas you can see the pattern\n\n2\n00:00:05,000 --> 00:00:07,000\nsecond line\n",
      )
      const video = path.join(dir, "clip.mkv")
      const made = await Process.run(
        [
          "ffmpeg",
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=duration=8:size=320x240:rate=10",
          "-i",
          srt,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:s",
          "srt",
          "-y",
          video,
        ],
        { nothrow: true },
      )
      expect(made.code).toBe(0)

      const full = await watch(video, { maxFrames: 4 })
      expect(full.duration).toBeCloseTo(8, 0)
      expect(full.frames.length).toBe(4)
      expect(full.frames[0].url.startsWith("data:image/jpeg;base64,")).toBe(true)
      expect(full.transcriptSource).toContain("embedded subtitles")
      const output = full.lines.join("\n")
      expect(output).toContain("as you can see the pattern")
      expect(output).toContain("[0:01-0:07]")

      const zoom = await watch(video, { start: "0:04", end: 6, maxFrames: 3 })
      expect(zoom.frames.every((frame) => frame.time >= 4 && frame.time < 6)).toBe(true)
      expect(zoom.lines.join("\n")).toContain("Range: 0:04-0:06")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
