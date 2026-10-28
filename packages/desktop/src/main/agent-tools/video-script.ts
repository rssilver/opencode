// Page scripts and pure helpers for browser_video_watch. Scripts run in the page's isolated
// world; they only read the DOM and seek the largest <video>, with caller data embedded as literals.

export type Cue = { start: number; end: number; text: string }
export type Chapter = { start: number; title: string }
export type VideoInfo =
  | { ok: false; message: string }
  | {
      ok: true
      duration: number
      currentTime: number
      paused: boolean
      title: string
      description: string
      captionUrl?: string
      tracks: Cue[]
      panel: Cue[]
    }
export type SeekResult = { ok: boolean; time: number; rect?: { x: number; y: number; width: number; height: number } }

// Picks the biggest visible <video>, which is the main player on YouTube and most video sites.
const FIND_VIDEO = `const videos = [...document.querySelectorAll('video')].filter((v) => v.getBoundingClientRect().width > 0);
  const video = videos.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];`

/** Reads the video's state, text tracks, a YouTube caption URL, description and transcript panel. */
export function inspectScript(openTranscript: boolean) {
  return `(async () => {
  ${FIND_VIDEO}
  if (!video) return { ok: false, message: 'No playing <video> element was found on this page.' };
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const tracks = [];
  for (const track of [...video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions')) {
    if (track.mode === 'disabled') track.mode = 'hidden';
  }
  await new Promise((r) => setTimeout(r, 300));
  const track = [...video.textTracks].find((t) => t.cues && t.cues.length);
  if (track) for (const cue of track.cues) tracks.push({ start: cue.startTime, end: cue.endTime, text: clean(cue.text) });
  // YouTube embeds caption track URLs in its initial player response script.
  const script = [...document.scripts].map((s) => s.textContent || '').find((t) => t.includes('"captionTracks"')) || '';
  const match = script.match(/"captionTracks":\\[\\{"baseUrl":"([^"]+)"/);
  const captionUrl = match ? JSON.parse('"' + match[1] + '"') : undefined;
  const panelCues = () => [...document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model')].map((el) => {
    const stamp = clean(el.querySelector('.segment-timestamp, [class*="timestamp"]')?.textContent);
    const body = clean(el.querySelector('.segment-text, [class*="segment-text"], span[role="text"]')?.textContent || el.textContent).replace(stamp, '').trim();
    return { stamp, text: body };
  });
  let panel = panelCues();
  if (!panel.length && ${openTranscript ? "true" : "false"}) {
    document.querySelector('#description-inline-expander #expand, tp-yt-paper-button#expand')?.click();
    const button = [...document.querySelectorAll('button, ytd-button-renderer')].find((el) => /show transcript/i.test(el.getAttribute('aria-label') || el.textContent || ''));
    if (button) {
      (button.querySelector('button') || button).click();
      for (let i = 0; i < 20 && !panel.length; i++) { await new Promise((r) => setTimeout(r, 250)); panel = panelCues(); }
    }
  }
  const description = clean(
    (document.querySelector('#description-inline-expander, ytd-text-inline-expander, #description') || {}).innerText
      || document.querySelector('meta[name="description"]')?.getAttribute('content'),
  ) ;
  const raw = (document.querySelector('#description-inline-expander, ytd-text-inline-expander, #description') || {}).innerText || description;
  return {
    ok: true,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    currentTime: video.currentTime,
    paused: video.paused,
    title: document.title,
    description: String(raw || '').slice(0, 20000),
    captionUrl,
    tracks,
    panel: panel.map((item) => ({ start: -1, end: -1, text: item.stamp + '\\u0000' + item.text })),
  };
})()`
}

/** Pauses the video, seeks to `time`, waits for the frame, and returns the player's rectangle. */
export function seekScript(time: number) {
  return `(async () => {
  ${FIND_VIDEO}
  if (!video) return { ok: false, time: 0 };
  video.pause();
  video.scrollIntoView({ block: 'center' });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    video.currentTime = ${JSON.stringify(Math.max(0, time))};
  });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const rect = video.getBoundingClientRect();
  const x = Math.max(0, rect.left), y = Math.max(0, rect.top);
  return {
    ok: true,
    time: video.currentTime,
    rect: { x: Math.round(x), y: Math.round(y), width: Math.round(Math.min(rect.right, innerWidth) - x), height: Math.round(Math.min(rect.bottom, innerHeight) - y) },
  };
})()`
}

/** Restores the playback position and play state after frames were captured. */
export function restoreScript(time: number, play: boolean) {
  return `(() => {
  ${FIND_VIDEO}
  if (!video) return false;
  video.currentTime = ${JSON.stringify(Math.max(0, time))};
  if (${play ? "true" : "false"}) video.play().catch(() => {});
  return true;
})()`
}

/** Parses seconds, "m:ss" or "h:mm:ss". Undefined when missing or invalid. */
export function parseTime(input: unknown) {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : undefined
  if (typeof input !== "string" || !input.trim()) return undefined
  const parts = input.trim().split(":")
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return undefined
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = String(whole % 60).padStart(2, "0")
  if (h) return `${h}:${String(m).padStart(2, "0")}:${s}`
  return `${m}:${s}`
}

/** Chapters are description lines that start with a timestamp, e.g. "1:23 Setup" or "01:02:03 - Outro". */
export function parseChapters(description: string): Chapter[] {
  const chapters = description.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|]?\s*(.+)$/)
    const start = match ? parseTime(match[1]) : undefined
    return match && start !== undefined ? [{ start, title: match[2].trim() }] : []
  })
  // YouTube only treats it as chapters when the list starts at 0:00; otherwise these are just mentions.
  return chapters.length >= 2 && chapters[0].start === 0 ? chapters : []
}

/** Turns transcript-panel rows ("stamp\0text") into cues whose end is the next row's start. */
export function panelCues(rows: Cue[], duration: number): Cue[] {
  const parsed = rows.flatMap((row) => {
    const [stamp, text] = row.text.split("\u0000")
    const start = parseTime(stamp)
    return start === undefined || !text ? [] : [{ start, text }]
  })
  return parsed.map((row, i) => ({ ...row, end: parsed[i + 1]?.start ?? duration }))
}

/** Parses WebVTT/SRT into cues, stripping markup and consecutive repeats. */
export function parseVtt(text: string): Cue[] {
  const stamp = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/
  const seconds = (m: RegExpMatchArray) =>
    Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000
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
      const body = lines
        .slice(at + 1)
        .join(" ")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim()
      return a && b && body ? [{ start: seconds(a), end: seconds(b), text: body }] : []
    })
  return cues.filter((cue, i) => cue.text !== cues[i - 1]?.text)
}

/** Groups cues into chunks of about `size` seconds. */
export function chunkCues(cues: Cue[], size: number) {
  return cues.reduce<Cue[]>((chunks, cue) => {
    const last = chunks.at(-1)
    if (!last || cue.start - last.start >= size) return [...chunks, { ...cue }]
    last.end = Math.max(last.end, cue.end)
    if (!last.text.endsWith(cue.text)) last.text = `${last.text} ${cue.text}`
    return chunks
  }, [])
}

/** Frame times: chapter starts in range first, then evenly spaced fill, at most `max`, sorted. */
export function frameTimes(start: number, end: number, max: number, chapters: number[]) {
  const gap = (end - start) / (max * 2)
  const step = (end - start) / max
  const even = Array.from({ length: max }, (_, i) => start + step * (i + 0.5))
  const marks = chapters.filter((time) => time >= start && time < end).map((time) => Math.min(time + 1, end))
  return [...marks, ...even]
    .reduce<number[]>((all, time) => (all.length >= max || all.some((item) => Math.abs(item - time) < gap) ? all : [...all, time]), [])
    .toSorted((a, b) => a - b)
}
