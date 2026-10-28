export * as LmStudioProgress from "./lmstudio-progress"

import { access } from "fs/promises"
import os from "os"
import path from "path"
import { which } from "@opencode-ai/core/util/which"
import { Process } from "@/util/process"
import { Schema } from "effect"
import type { Provider } from "./provider"

/**
 * Live progress for local LM Studio models. The OpenAI-compatible endpoint emits no progress events, so:
 * - model load progress comes from the native `/api/v1/chat` SSE stream (`model_load.progress`), and
 * - prompt processing progress comes from a shared `lms log stream` child process.
 * Everything here is best-effort: any failure just ends the progress stream and the normal request proceeds.
 */

const IDLE_KILL_MS = 30_000
const NEWLINE = /\r?\n/
const THROTTLE_MS = 250
const THROTTLE_STEP = 0.01
const PROBE_FAILURE_TTL_MS = 30_000

// ---------------------------------------------------------------------------
// Pure helpers

export function isLocalHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  )
}

/** Origin of a local OpenAI-compatible model's base URL, or undefined for remote / unparsable URLs. */
export function localOrigin(model: Pick<Provider.Model, "providerID" | "api">) {
  if (model.providerID !== "lmstudio" && !model.api.npm.includes("openai-compatible")) return undefined
  const url = URL.parse(model.api.url)
  if (!url || !isLocalHost(url.hostname)) return undefined
  return url.origin
}

// Anchored on the JSON `content` field so request bodies that merely quote the phrase are never matched.
const PROMPT_LINE = /"content":"\[[^\]]*\]\[[A-Za-z]+\]\[([^\]]+)\] Prompt processing progress: ([0-9.]+)%"/
const TIMESTAMP = /"timestamp":(\d+)/

export function parsePromptLine(line: string) {
  if (!line.includes("Prompt processing progress")) return undefined
  const match = PROMPT_LINE.exec(line)
  if (!match) return undefined
  const percent = Number(match[2])
  if (!Number.isFinite(percent)) return undefined
  return {
    model: match[1],
    value: Math.min(1, Math.max(0, percent / 100)),
    timestamp: Number(TIMESTAMP.exec(line)?.[1] ?? 0),
  }
}

const LoadEvent = Schema.Struct({
  type: Schema.Literal("model_load.progress"),
  progress: Schema.Finite,
})
const decodeLoadEvent = Schema.decodeUnknownOption(Schema.fromJsonString(LoadEvent))

/** Splits a buffer of SSE text into complete events and the unfinished remainder. */
export function parseSse(buffer: string) {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ""
  const events = blocks.map((block) => {
    const lines = block.split(/\r?\n/)
    return {
      event: lines.find((line) => line.startsWith("event:"))?.slice(6).trim(),
      data: lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n"),
    }
  })
  return { events, rest }
}

/** Load fraction (0..1) carried by an SSE event, or undefined for any other event. */
export function loadValue(event: { event?: string; data: string }) {
  if (event.event !== "model_load.progress") return undefined
  const decoded = decodeLoadEvent(event.data)
  if (decoded._tag === "None") return undefined
  return Math.min(1, Math.max(0, decoded.value.progress))
}

/** Publish when the value moved by at least 1% or 250ms passed since the last publish. */
export function shouldPublish(last: { value: number; at: number } | undefined, value: number, now: number) {
  if (!last) return true
  if (value === last.value) return false
  return Math.abs(value - last.value) >= THROTTLE_STEP || now - last.at >= THROTTLE_MS
}

export function lmsCandidate(platform: NodeJS.Platform, home: string) {
  return path.join(home, ".lmstudio", "bin", platform === "win32" ? "lms.exe" : "lms")
}

// ---------------------------------------------------------------------------
// Detection

const probes = new Map<string, { ok: boolean; at: number }>()

async function models(origin: string) {
  const response = await fetch(`${origin}/api/v1/models`, { signal: AbortSignal.timeout(1500) }).catch(() => undefined)
  if (!response?.ok) return undefined
  const body = await response.json().catch(() => undefined)
  if (!body || !Array.isArray(body.models)) return undefined
  return body.models as { key?: string; loaded_instances?: unknown[] }[]
}

/** Origin of the LM Studio server serving this model, or undefined when it is not (a reachable) LM Studio. */
export async function detect(model: Pick<Provider.Model, "providerID" | "api">) {
  const origin = localOrigin(model)
  if (!origin) return undefined
  const cached = probes.get(origin)
  if (cached?.ok) return origin
  if (cached && Date.now() - cached.at < PROBE_FAILURE_TTL_MS) return undefined
  const ok = (await models(origin)) !== undefined
  probes.set(origin, { ok, at: Date.now() })
  return ok ? origin : undefined
}

// ---------------------------------------------------------------------------
// Watchers

/**
 * Pull-based progress source. `next()` resolves with the next fraction, or undefined once the source ended.
 * `close()` must be called when the consumer stops (including on interruption); it releases resources and
 * resolves any pending `next()`, so an interrupted consumer never leaves anything hanging.
 */
export type Watcher = {
  next: () => Promise<number | undefined>
  close: () => void
}

function channel(onClose: () => void) {
  const queue: number[] = []
  let ended = false
  let wake: (() => void) | undefined
  const end = () => {
    ended = true
    wake?.()
  }
  return {
    push: (value: number) => {
      queue.push(value)
      wake?.()
    },
    end,
    watcher: {
      next: async () => {
        while (queue.length === 0 && !ended) await new Promise<void>((resolve) => (wake = resolve))
        return queue.shift()
      },
      close: () => {
        end()
        onClose()
      },
    } satisfies Watcher,
  }
}

// ---------------------------------------------------------------------------
// Model load progress

/**
 * Streams load fractions while LM Studio loads a listed-but-unloaded model, ending after `model_load.end`.
 * Ends immediately when the model is already loaded or anything fails.
 */
export function load(origin: string, modelID: string): Watcher {
  const controller = new AbortController()
  const out = channel(() => controller.abort())
  void run(origin, modelID, controller, out.push).finally(out.end)
  return out.watcher
}

async function run(origin: string, modelID: string, controller: AbortController, push: (value: number) => void) {
  const listed = (await models(origin))?.find((item) => item.key === modelID)
  if (!listed || (listed.loaded_instances?.length ?? 0) > 0) return
  const response = await fetch(`${origin}/api/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: modelID, input: "hi", stream: true, max_output_tokens: 1 }),
    signal: controller.signal,
  }).catch(() => undefined)
  if (!response?.ok || !response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const chunk = await reader.read().catch(() => undefined)
    if (!chunk || chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const parsed = parseSse(buffer)
    buffer = parsed.rest
    const ended = parsed.events.some((event) => event.event === "model_load.end")
    parsed.events.forEach((event) => {
      const value = loadValue(event)
      if (value !== undefined) push(value)
    })
    if (ended) break
  }
  // Stop as soon as loading is done; the 1-token generation is not needed.
  controller.abort()
}

// ---------------------------------------------------------------------------
// Prompt processing progress (shared `lms log stream`)

type Subscriber = { model: string; since: number; push: (value: number) => void }

const subscribers = new Set<Subscriber>()
// Node APIs only: the desktop app runs this server inside Electron (Node), where `Bun.*` does not exist.
let child: Process.Child | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined
let exitHooked = false
let lms: Promise<string | undefined> | undefined

function locateLms() {
  lms ??= (async () => {
    const found = which("lms")
    if (found) return found
    const candidate = lmsCandidate(process.platform, os.homedir())
    return access(candidate).then(
      () => candidate,
      () => undefined,
    )
  })()
  return lms
}

async function ensureChild() {
  if (child) return true
  const binary = await locateLms()
  if (!binary) return false
  if (child) return true
  const spawned = Process.spawn([binary, "log", "stream", "--source", "server", "--json"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  child = spawned
  if (!exitHooked) {
    exitHooked = true
    process.on("exit", () => child?.kill())
  }
  void pump(spawned)
  return true
}

async function pump(spawned: NonNullable<typeof child>) {
  const decoder = new TextDecoder()
  let buffer = ""
  const stdout = spawned.stdout
  if (!stdout) return
  // A spawn error (e.g. lms removed) ends the stream; the exit promise is already guarded in Process.spawn.
  for await (const chunk of stdout.on("error", () => undefined)) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true })
    const lines = buffer.split(NEWLINE)
    buffer = lines.pop() ?? ""
    lines.forEach(dispatch)
    // A huge unterminated line (full request bodies) is never a progress line; drop it rather than grow unbounded.
    if (buffer.length > 1_000_000) buffer = ""
  }
  if (child === spawned) child = undefined
}

function dispatch(line: string) {
  const parsed = parsePromptLine(line)
  if (!parsed) return
  subscribers.forEach((subscriber) => {
    // Ignore replayed history from before the subscription.
    if (subscriber.model === parsed.model && parsed.timestamp >= subscriber.since) subscriber.push(parsed.value)
  })
}

function scheduleKill() {
  if (subscribers.size > 0) return
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (subscribers.size > 0) return
    child?.kill()
    child = undefined
  }, IDLE_KILL_MS)
  idleTimer.unref?.()
}

/**
 * Streams prompt-processing fractions for requests to `modelID`, ending after 100%.
 * Ends immediately when `lms` is unavailable. `close()` releases the shared log stream.
 */
export function prompt(modelID: string): Watcher {
  const subscriber: Subscriber = { model: modelID, since: Date.now() - 2000, push: () => {} }
  const out = channel(() => {
    subscribers.delete(subscriber)
    scheduleKill()
  })
  subscriber.push = (value) => {
    out.push(value)
    if (value >= 1) out.end()
  }
  subscribers.add(subscriber)
  clearTimeout(idleTimer)
  void ensureChild().then((ok) => {
    if (!ok) out.end()
  })
  return out.watcher
}
