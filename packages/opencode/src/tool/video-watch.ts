import { Effect, Schema } from "effect"
import { access, mkdtemp, readdir, readFile, rm } from "fs/promises"
import { which } from "@opencode-ai/core/util/which"
import os from "os"
import path from "path"
import * as Tool from "./tool"
import DESCRIPTION from "./video-watch.txt"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Process } from "@/util/process"
import { assertExternalDirectoryEffect } from "./external-directory"
import { deliveryMode, describeImages, type Mode } from "./view-images"

const DEFAULT_FRAMES = 12
const MAX_FRAMES = 24
const FRAME_WIDTH = 768
const SCENE_THRESHOLD = 0.3
const CHUNK_SECONDS = 30
const MAX_TRANSCRIPT_CHARS = 40_000
const DEFAULT_QUESTION = "Describe what happens in these video frames, in order, including any visible text."
// Subtitle codecs ffmpeg can turn into WebVTT text; bitmap subtitles (PGS, DVD) cannot be read as text.
const TEXT_SUBTITLES = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"])
// Phrases where a narrator points at the screen, so the frame at that moment is worth seeing.
const POINTING = /\b(as you can see|look at|click(ing)? (on |here)?|you'?ll see|notice|right here|over here|this screen)\b/i

export const Parameters = Schema.Struct({
  source: Schema.String.annotate({
    description:
      "Video file path (absolute or relative to the project directory), or an http(s) URL of a direct media file. For YouTube and other web pages use the browser video tool instead",
  }),
  question: Schema.optional(Schema.String).annotate({
    description:
      "What you want to know about the video. Only used when the current model cannot view images and a vision model describes the frames instead",
  }),
  start: Schema.optional(Schema.Union([Schema.String, Schema.Number])).annotate({
    description: 'Start of the range to watch, as seconds or "m:ss" / "h:mm:ss" (defaults to the beginning)',
  }),
  end: Schema.optional(Schema.Union([Schema.String, Schema.Number])).annotate({
    description: 'End of the range to watch, as seconds or "m:ss" / "h:mm:ss" (defaults to the end)',
  }),
  maxFrames: Schema.optional(Schema.Number).annotate({
    description: `Maximum frames to return (defaults to ${DEFAULT_FRAMES}, max ${MAX_FRAMES})`,
  }),
})

type Metadata = {
  duration: number
  frames: number
  transcript: string
  mode: Mode
}

export type Cue = { start: number; end: number; text: string }
export type Chapter = { start: number; end: number; title: string }
export type Frame = { time: number; reason: "scene" | "narration" | "even" }

export const VideoWatchTool = Tool.define<
  typeof Parameters,
  Metadata,
  Config.Service | Provider.Service | LLM.Service | Agent.Service
>(
  "video_watch",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const agents = yield* Agent.Service

    const run = Effect.fn("VideoWatchTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const instance = yield* InstanceState.context
      const remote = /^https?:\/\//i.test(params.source)
      const target = remote
        ? params.source
        : path.isAbsolute(params.source)
          ? params.source
          : path.resolve(instance.directory, params.source)
      const title = remote ? params.source : path.relative(instance.worktree, target) || path.basename(target)

      if (!remote) yield* assertExternalDirectoryEffect(ctx, target, { kind: "file" })
      yield* ctx.ask({
        permission: remote ? "webfetch" : "read",
        patterns: [remote ? params.source : title],
        always: ["*"],
        metadata: {},
      })

      const watched = yield* Effect.tryPromise({
        try: () => watch(target, params, ctx.abort),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })

      const model = ctx.extra?.["model"] as Provider.Model | undefined
      const vision = (yield* config.get()).vision?.model
      const mode =
        watched.frames.length === 0
          ? "attach"
          : deliveryMode({ supportsImages: model ? model.capabilities.input.image : true, visionModel: vision })
      const result = (lines: string[], frames: number) => ({
        title,
        output: lines.join("\n"),
        metadata: { duration: watched.duration, frames, transcript: watched.transcriptSource, mode },
      })

      if (mode === "attach")
        return {
          ...result(watched.lines, watched.frames.length),
          attachments: watched.frames.map((frame) => ({ type: "file" as const, mime: frame.mime, url: frame.url })),
        }

      if (mode === "unsupported")
        return result(
          [
            ...watched.lines,
            "",
            "The current model cannot view images, so the frames were not attached.",
            'To enable frame understanding, set a vision-capable model in opencode.json, e.g. { "vision": { "model": "provider/model" } }, and run this tool again.',
          ],
          0,
        )

      const answer = yield* describeImages(
        { provider, llm, agents },
        ctx,
        vision!,
        params.question?.trim() || DEFAULT_QUESTION,
        watched.frames,
      ).pipe(
        Effect.map((text) => text.trim() || "(the vision model returned no text)"),
        Effect.catch((error) =>
          Effect.succeed(`Vision model ${vision} failed: ${error instanceof Error ? error.message : String(error)}`),
        ),
      )
      return result(
        [...watched.lines, "", `Frame description from vision model ${vision} (frames were not attached):`, answer],
        watched.frames.length,
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

/** Probes the video, reads or transcribes its speech, and extracts frames for the requested range. */
export async function watch(
  source: string,
  params: { start?: string | number; end?: string | number; maxFrames?: number },
  abort?: AbortSignal,
) {
  const info = await probe(source, abort)
  const start = clamp(parseTime(params.start) ?? 0, 0, info.duration)
  const end = clamp(parseTime(params.end) ?? info.duration, start, info.duration)
  if (end - start <= 0) throw new Error(`Empty range: ${formatTime(start)}-${formatTime(end)}`)
  const max = clamp(Math.round(params.maxFrames || DEFAULT_FRAMES), 1, MAX_FRAMES)

  const speech = await transcript(source, info, start, end, abort)
  const cues = speech.cues.filter((cue) => cue.end > start && cue.start < end)
  const scenes = info.width ? await sceneTimes(source, start, end, abort) : []
  const picked = info.width
    ? pickFrames({ start, end, max, scenes, narration: cues.filter((cue) => POINTING.test(cue.text)).map((cue) => cue.start) })
    : []

  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-video-"))
  const frames = await Promise.all(
    picked.map(async (frame, i) => {
      const file = path.join(dir, `frame-${i}.jpg`)
      await ffmpeg(
        [
          "-ss", frame.time.toFixed(3), "-i", source, "-frames:v", "1",
          "-vf", `scale='min(${FRAME_WIDTH},iw)':-2`, "-q:v", "4", "-y", file,
        ],
        abort,
      )
      const bytes = await readFile(file).catch(() => undefined)
      if (!bytes?.length) return undefined
      return {
        ...frame,
        label: `frame ${i + 1} at ${formatTime(frame.time)}`,
        mime: "image/jpeg",
        url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      }
    }),
  ).finally(() => rm(dir, { recursive: true, force: true }))
  const shown = frames.filter((frame) => frame !== undefined)

  const chunks = chunkCues(cues, CHUNK_SECONDS).map((chunk) => `[${formatTime(chunk.start)}-${formatTime(chunk.end)}] ${chunk.text}`)
  const transcriptText = chunks.join("\n")
  const lines = [
    `Video: ${source}`,
    `Duration: ${formatTime(info.duration)}${info.width ? `, ${info.width}x${info.height}` : ", no video stream"}`,
    `Range: ${formatTime(start)}-${formatTime(end)}`,
    "",
    info.chapters.length
      ? ["Chapters:", ...info.chapters.map((chapter) => `${formatTime(chapter.start)} ${chapter.title}`)].join("\n")
      : "Chapters: none",
    "",
    `Transcript (${speech.source}):`,
    transcriptText
      ? transcriptText.length > MAX_TRANSCRIPT_CHARS
        ? `${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)}\n[transcript truncated; call again with a narrower start/end]`
        : transcriptText
      : "(no speech text in this range)",
    ...(speech.note ? [speech.note] : []),
    "",
    shown.length
      ? [
          `Frames (${shown.length}, attached in this order):`,
          ...shown.map((frame, i) => `${i + 1}. ${formatTime(frame.time)} (${frame.reason})`),
        ].join("\n")
      : "Frames: none",
    "",
    "To look closer at a moment, call video_watch again with start/end around it for denser frames.",
  ]
  return { duration: info.duration, frames: shown, lines, transcriptSource: speech.source }
}

/** Parses seconds, "m:ss", "h:mm:ss" (with optional fractions). Undefined when missing or invalid. */
export function parseTime(input: string | number | undefined) {
  if (input === undefined || input === "") return undefined
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : undefined
  const parts = input.trim().split(":")
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return undefined
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

/** Formats seconds as m:ss, or h:mm:ss for an hour or more. */
export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = String(whole % 60).padStart(2, "0")
  if (h) return `${h}:${String(m).padStart(2, "0")}:${s}`
  return `${m}:${s}`
}

/** Parses WebVTT or SRT text into cues, dropping markup and consecutive repeats (rolling captions). */
export function parseSubtitles(text: string): Cue[] {
  const stamp = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/
  const seconds = (match: RegExpMatchArray) =>
    Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, "0")) / 1000
  const cues = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const lines = block.split("\n")
      const at = lines.findIndex((line) => line.includes("-->"))
      if (at < 0) return []
      const [from, to] = lines[at].split("-->")
      const a = from.match(stamp)
      const b = to.match(stamp)
      if (!a || !b) return []
      const body = lines
        .slice(at + 1)
        .join(" ")
        .replace(/<[^>]*>/g, "")
        .replace(/\{\\[^}]*\}/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
      return body ? [{ start: seconds(a), end: seconds(b), text: body }] : []
    })
  return cues.filter((cue, i) => cue.text !== cues[i - 1]?.text)
}

/** Groups cues into chunks of about `size` seconds, dropping words repeated from rolling captions. */
export function chunkCues(cues: Cue[], size: number) {
  return cues.reduce<Cue[]>((chunks, cue) => {
    const last = chunks.at(-1)
    if (!last || cue.start - last.start >= size) return [...chunks, { ...cue }]
    last.end = Math.max(last.end, cue.end)
    if (!last.text.endsWith(cue.text)) last.text = `${last.text} ${trimOverlap(last.text, cue.text)}`.trim()
    return chunks
  }, [])
}

function trimOverlap(previous: string, next: string) {
  // YouTube-style captions repeat the tail of the previous line at the start of the next.
  const words = next.split(" ")
  const overlap = words.findLastIndex((_, i) => previous.endsWith(words.slice(0, i + 1).join(" ")))
  return words.slice(overlap + 1).join(" ")
}

/** `count` timestamps spread evenly over the range, at the middle of equal slices. */
export function evenTimes(start: number, end: number, count: number) {
  const step = (end - start) / count
  return Array.from({ length: count }, (_, i) => start + step * (i + 0.5))
}

/**
 * Chooses up to `max` frame times: scene changes first, then moments the narration points at,
 * then evenly spaced fill. Times closer than a minimum gap are merged so frames are not near-duplicates.
 */
export function pickFrames(input: { start: number; end: number; max: number; scenes: number[]; narration: number[] }) {
  const gap = (input.end - input.start) / (input.max * 2)
  const inRange = (time: number) => time >= input.start && time < input.end
  const candidates: Frame[] = [
    // Always show the opening shot, then each detected scene change.
    { time: input.start, reason: "scene" as const },
    ...input.scenes.filter(inRange).map((time) => ({ time, reason: "scene" as const })),
    ...input.narration.filter(inRange).map((time) => ({ time, reason: "narration" as const })),
  ]
  const kept = candidates.reduce<Frame[]>(
    (all, frame) => (all.some((item) => Math.abs(item.time - frame.time) < gap) ? all : [...all, frame]),
    [],
  )
  const chosen = kept.length > input.max ? sample(kept.toSorted((a, b) => a.time - b.time), input.max) : kept
  const filled = evenTimes(input.start, input.end, input.max).reduce<Frame[]>(
    (all, time) =>
      all.length >= input.max || all.some((item) => Math.abs(item.time - time) < gap)
        ? all
        : [...all, { time, reason: "even" }],
    chosen,
  )
  return filled.toSorted((a, b) => a.time - b.time)
}

function sample<T>(items: T[], count: number) {
  return Array.from({ length: count }, (_, i) => items[Math.floor((i * items.length) / count)])
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

async function probe(source: string, abort?: AbortSignal) {
  const result = await tool(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", source],
    abort,
  )
  if (result.code !== 0) throw new Error(`ffprobe could not read ${source}: ${result.stderr.toString().trim()}`)
  const data = JSON.parse(result.stdout.toString()) as {
    format?: { duration?: string }
    streams?: { index: number; codec_type?: string; codec_name?: string; width?: number; height?: number; tags?: { language?: string }; disposition?: { attached_pic?: number } }[]
    chapters?: { start_time: string; end_time: string; tags?: { title?: string } }[]
  }
  const streams = data.streams ?? []
  const video = streams.find((stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic)
  return {
    duration: Number(data.format?.duration ?? 0),
    width: video?.width,
    height: video?.height,
    audio: streams.some((stream) => stream.codec_type === "audio"),
    subtitles: streams
      .filter((stream) => stream.codec_type === "subtitle" && TEXT_SUBTITLES.has(stream.codec_name ?? ""))
      .map((stream) => ({ index: stream.index, language: stream.tags?.language })),
    chapters: (data.chapters ?? []).map((chapter, i) => ({
      start: Number(chapter.start_time),
      end: Number(chapter.end_time),
      title: chapter.tags?.title ?? `Chapter ${i + 1}`,
    })),
  }
}

async function transcript(
  source: string,
  info: Awaited<ReturnType<typeof probe>>,
  start: number,
  end: number,
  abort?: AbortSignal,
): Promise<{ cues: Cue[]; source: string; note?: string }> {
  const embedded = info.subtitles.find((item) => item.language?.startsWith("en")) ?? info.subtitles[0]
  if (embedded) {
    const result = await ffmpeg(["-i", source, "-map", `0:${embedded.index}`, "-f", "webvtt", "-"], abort)
    const cues = parseSubtitles(result.stdout.toString())
    if (cues.length) return { cues, source: `embedded subtitles${embedded.language ? ` (${embedded.language})` : ""}` }
  }
  const sidecar = /^https?:\/\//i.test(source) ? undefined : await findSidecar(source)
  if (sidecar) return { cues: parseSubtitles(await readFile(sidecar, "utf8")), source: path.basename(sidecar) }
  if (!info.audio) return { cues: [], source: "none", note: "The video has no audio track." }

  const whisper = await findWhisper()
  if (!whisper)
    return {
      cues: [],
      source: "none",
      note: "No subtitles were found and no local Whisper is installed, so only frames are available. Install whisper.cpp (whisper-cli on PATH, or OPENCODE_WHISPER_CLI and OPENCODE_WHISPER_MODEL) to get a transcript.",
    }
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-whisper-"))
  try {
    const wav = path.join(dir, "audio.wav")
    await ffmpeg(
      ["-ss", start.toFixed(3), "-t", (end - start).toFixed(3), "-i", source, "-vn", "-ar", "16000", "-ac", "1", "-y", wav],
      abort,
    )
    const base = path.join(dir, "speech")
    const result = await tool(whisper.cli, ["-m", whisper.model, "-f", wav, "-l", "auto", "-ovtt", "-of", base, "-np"], abort)
    const vtt = await readFile(`${base}.vtt`, "utf8").catch(() => "")
    if (result.code !== 0 || !vtt)
      return { cues: [], source: "none", note: `Whisper failed: ${result.stderr.toString().trim().slice(-500)}` }
    const cues = parseSubtitles(vtt).map((cue) => ({ ...cue, start: cue.start + start, end: cue.end + start }))
    return { cues, source: `local Whisper (${path.basename(whisper.model)})` }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function findSidecar(source: string) {
  const stem = path.basename(source, path.extname(source))
  const names = await readdir(path.dirname(source)).catch(() => [] as string[])
  const match = names.find((name) => name.startsWith(stem) && /\.(vtt|srt)$/i.test(name))
  return match ? path.join(path.dirname(source), match) : undefined
}

/** Locates whisper.cpp: env overrides first, then PATH, then the per-user install folder. */
export async function findWhisper() {
  const home = whisperHome()
  const model = process.env.OPENCODE_WHISPER_MODEL ?? (await firstModel(path.join(home, "models")))
  if (!model) return undefined
  const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"
  const candidates = [
    process.env.OPENCODE_WHISPER_CLI,
    which("whisper-cli") ?? undefined,
    path.join(home, "cuda", "Release", exe),
    path.join(home, "cpu", "Release", exe),
  ].filter((item) => item !== undefined)
  const found = await Promise.all(candidates.map((item) => access(item).then(() => true, () => false)))
  const cli = candidates.find((_, i) => found[i])
  return cli ? { cli, model } : undefined
}

function whisperHome() {
  if (process.env.OPENCODE_WHISPER_HOME) return process.env.OPENCODE_WHISPER_HOME
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "opencode", "whisper")
  return path.join(os.homedir(), ".local", "share", "opencode", "whisper")
}

async function firstModel(dir: string) {
  const names = await readdir(dir).catch(() => [] as string[])
  const model = names.toSorted().find((name) => /^ggml-.*\.bin$/.test(name))
  return model ? path.join(dir, model) : undefined
}

async function sceneTimes(source: string, start: number, end: number, abort?: AbortSignal) {
  // Scene scoring on a small copy is much faster and finds the same cuts.
  const result = await ffmpeg(
    [
      "-ss", start.toFixed(3), "-t", (end - start).toFixed(3), "-an", "-sn", "-i", source,
      "-vf", `scale=320:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`, "-f", "null", "-",
    ],
    abort,
  )
  return [...result.stderr.toString().matchAll(/pts_time:\s*([\d.]+)/g)].map((match) => start + Number(match[1]))
}

function ffmpeg(args: string[], abort?: AbortSignal) {
  return tool("ffmpeg", ["-hide_banner", "-loglevel", "info", "-nostdin", ...args], abort)
}

async function tool(command: string, args: string[], abort?: AbortSignal) {
  return Process.run([command, ...args], { nothrow: true, abort }).catch((error) => {
    throw new Error(
      `${command} could not be started (${error instanceof Error ? error.message : String(error)}). Install ffmpeg and make sure ffmpeg and ffprobe are on PATH.`,
    )
  })
}
