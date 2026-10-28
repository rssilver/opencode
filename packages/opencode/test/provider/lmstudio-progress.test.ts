import { describe, expect, test } from "bun:test"
import { LmStudioProgress } from "../../src/provider/lmstudio-progress"

const line = (content: string, timestamp = 1793173060260) =>
  JSON.stringify({ timestamp, data: { type: "server.log", content, level: "info" } })

describe("LmStudioProgress.parsePromptLine", () => {
  test("parses model, fraction and timestamp", () => {
    const parsed = LmStudioProgress.parsePromptLine(
      line("[2026-10-28 03:37:40][INFO][cyber-tiel-coder-35b-a3b-mtp] Prompt processing progress: 20.0%"),
    )
    expect(parsed).toEqual({ model: "cyber-tiel-coder-35b-a3b-mtp", value: 0.2, timestamp: 1793173060260 })
  })

  test("handles 0% and 100%", () => {
    const at = (p: string) =>
      LmStudioProgress.parsePromptLine(line(`[2026-10-28 03:37:40][INFO][m] Prompt processing progress: ${p}%`))?.value
    expect(at("0.0")).toBe(0)
    expect(at("100.0")).toBe(1)
  })

  test("ignores unrelated and quoted lines", () => {
    expect(LmStudioProgress.parsePromptLine("Streaming logs from LM Studio")).toBeUndefined()
    expect(LmStudioProgress.parsePromptLine(line("[t][INFO][m] Received request: POST /v1/chat/completions"))).toBeUndefined()
    expect(
      LmStudioProgress.parsePromptLine(
        line('[t][INFO][m] Received request: {"text":"[t][INFO][x] Prompt processing progress: 50.0%"}'),
      ),
    ).toBeUndefined()
  })
})

describe("LmStudioProgress SSE", () => {
  test("splits events and keeps the unfinished remainder", () => {
    const parsed = LmStudioProgress.parseSse(
      'event: chat.start\ndata: {"type":"chat.start"}\n\nevent: model_load.progress\ndata: {"type":"model_load.progress","progress":0.65}\n\nevent: model_load.pro',
    )
    expect(parsed.events.map((event) => event.event)).toEqual(["chat.start", "model_load.progress"])
    expect(parsed.rest).toBe("event: model_load.pro")
    expect(LmStudioProgress.loadValue(parsed.events[1])).toBe(0.65)
    expect(LmStudioProgress.loadValue(parsed.events[0])).toBeUndefined()
  })

  test("rejects malformed load data", () => {
    expect(LmStudioProgress.loadValue({ event: "model_load.progress", data: "nope" })).toBeUndefined()
  })
})

describe("LmStudioProgress.shouldPublish", () => {
  test("throttles by step and time", () => {
    expect(LmStudioProgress.shouldPublish(undefined, 0.1, 0)).toBe(true)
    expect(LmStudioProgress.shouldPublish({ value: 0.1, at: 0 }, 0.1, 1000)).toBe(false)
    expect(LmStudioProgress.shouldPublish({ value: 0.1, at: 0 }, 0.105, 100)).toBe(false)
    expect(LmStudioProgress.shouldPublish({ value: 0.1, at: 0 }, 0.105, 300)).toBe(true)
    expect(LmStudioProgress.shouldPublish({ value: 0.1, at: 0 }, 0.12, 10)).toBe(true)
  })
})

describe("LmStudioProgress hosts", () => {
  test("only local origins qualify", () => {
    const model = (url: string, providerID = "custom") => ({
      providerID: providerID as never,
      api: { id: "m", url, npm: "@ai-sdk/openai-compatible" },
    })
    expect(LmStudioProgress.localOrigin(model("http://127.0.0.1:1234/v1", "lmstudio"))).toBe("http://127.0.0.1:1234")
    expect(LmStudioProgress.localOrigin(model("http://localhost:1234/v1"))).toBe("http://localhost:1234")
    expect(LmStudioProgress.localOrigin(model("http://[::1]:1234/v1"))).toBe("http://[::1]:1234")
    expect(LmStudioProgress.localOrigin(model("https://api.example.com/v1", "lmstudio"))).toBeUndefined()
    expect(LmStudioProgress.localOrigin(model("not a url"))).toBeUndefined()
  })

  test("lms path candidate per platform", () => {
    expect(LmStudioProgress.lmsCandidate("win32", "C:\Users\a").endsWith("lms.exe")).toBe(true)
    expect(LmStudioProgress.lmsCandidate("linux", "/home/a").endsWith("lms")).toBe(true)
  })
})
