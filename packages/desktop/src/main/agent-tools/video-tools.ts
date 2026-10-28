import { requestBrowserOpen, selectBrowserTab } from "../browser-panel"
import { requireTab, runInPage, sleep, targetWindow } from "./browser-tools"
import { number, optionalString, type Tool, type ToolContent, ToolError } from "./tool"
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
  type Cue,
  type SeekResult,
  type VideoInfo,
} from "./video-script"

const DEFAULT_FRAMES = 8
const MAX_FRAMES = 16
const FRAME_WIDTH = 768
const CHUNK_SECONDS = 30
const MAX_TRANSCRIPT_CHARS = 40_000

export const videoTools: Tool[] = [
  {
    name: "browser_video_watch",
    description:
      "Watch the video playing on the page open in the built-in browser panel (YouTube or any page with a <video>). Returns the chapters from the description, a timestamped transcript from the caption track or the page's transcript panel when available, and frames captured from the player at evenly spaced times (plus chapter starts), as images. Open the video page with browser_open first. To look closer at a moment, call again with start/end around it for denser frames. The video is paused while frames are captured and restored afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        tab_id: { type: "string", description: "Tab id from browser_tabs. Defaults to the active tab." },
        start: { type: "string", description: 'Start of the range, seconds or "m:ss". Defaults to 0.' },
        end: { type: "string", description: 'End of the range, seconds or "m:ss". Defaults to the end.' },
        max_frames: {
          type: "integer",
          description: `Frames to capture (default ${DEFAULT_FRAMES}, max ${MAX_FRAMES}). Use 0 for transcript only.`,
        },
      },
    },
    run: async (args) => {
      const win = targetWindow()
      const tab = requireTab(optionalString(args, "tab_id"))
      // A hidden panel renders nothing, so show this tab before capturing.
      selectBrowserTab(win, tab.id)
      requestBrowserOpen(win)
      await sleep(300)

      const info = await runInPage<VideoInfo>(tab.contents, inspectScript(true))
      if (!info.ok) throw new ToolError(info.message)
      const duration = info.duration
      const start = Math.min(parseTime(args.start) ?? 0, duration)
      const end = Math.max(Math.min(parseTime(args.end) ?? duration, duration), start)
      const max = Math.min(Math.max(Math.round(number(args, "max_frames") ?? DEFAULT_FRAMES), 0), MAX_FRAMES)
      const chapters = parseChapters(info.description)

      const speech = await transcript(tab.contents.session.fetch.bind(tab.contents.session), info)
      const cues = speech.cues.filter((cue) => cue.end > start && cue.start < end)
      const chunks = chunkCues(cues, CHUNK_SECONDS)
        .map((chunk) => `[${formatTime(chunk.start)}-${formatTime(chunk.end)}] ${chunk.text}`)
        .join("\n")

      const times = max && end > start ? frameTimes(start, end, max, chapters.map((chapter) => chapter.start)) : []
      const frames: { time: number; image: string }[] = []
      for (const time of times) {
        const seek = await runInPage<SeekResult>(tab.contents, seekScript(time))
        if (!seek.ok || !seek.rect || seek.rect.width < 10 || seek.rect.height < 10) continue
        const image = await tab.contents.capturePage(seek.rect)
        if (image.isEmpty()) continue
        const scaled = image.getSize().width > FRAME_WIDTH ? image.resize({ width: FRAME_WIDTH }) : image
        frames.push({ time: seek.time, image: scaled.toJPEG(80).toString("base64") })
      }
      if (times.length) await runInPage(tab.contents, restoreScript(info.currentTime, !info.paused))

      const lines = [
        `Video: ${tab.contents.getURL()}`,
        `Title: ${info.title}`,
        `Duration: ${formatTime(duration)}, range ${formatTime(start)}-${formatTime(end)}`,
        "",
        chapters.length
          ? ["Chapters:", ...chapters.map((chapter) => `${formatTime(chapter.start)} ${chapter.title}`)].join("\n")
          : "Chapters: none found in the description",
        "",
        `Transcript (${speech.source}):`,
        chunks
          ? chunks.length > MAX_TRANSCRIPT_CHARS
            ? `${chunks.slice(0, MAX_TRANSCRIPT_CHARS)}\n[transcript truncated; call again with a narrower start/end]`
            : chunks
          : "(no transcript available in this range; rely on the frames)",
        "",
        frames.length
          ? `Frames (${frames.length}, in order): ${frames.map((frame) => formatTime(frame.time)).join(", ")}`
          : times.length
            ? "Frames: none could be captured (the player may be hidden or covered)."
            : "Frames: none requested",
      ]
      const content: ToolContent[] = [
        { type: "text", text: lines.join("\n") },
        ...frames.flatMap((frame) => [
          { type: "text" as const, text: `Frame at ${formatTime(frame.time)}` },
          { type: "image" as const, data: frame.image, mimeType: "image/jpeg" },
        ]),
      ]
      return { content }
    },
  },
]

async function transcript(
  fetcher: (url: string) => Promise<Response>,
  info: Extract<VideoInfo, { ok: true }>,
): Promise<{ cues: Cue[]; source: string }> {
  if (info.tracks.length) return { cues: info.tracks, source: "page caption track" }
  const panel = panelCues(info.panel, info.duration)
  if (panel.length) return { cues: panel, source: "transcript panel" }
  if (!info.captionUrl) return { cues: [], source: "none" }
  const url = new URL(info.captionUrl)
  url.searchParams.set("fmt", "vtt")
  const body = await fetcher(url.toString())
    .then((res) => (res.ok ? res.text() : ""))
    .catch(() => "")
  const cues = parseVtt(body)
  return cues.length ? { cues, source: "caption track" } : { cues: [], source: "none" }
}
