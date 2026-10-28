import { Effect, Option, Schema } from "effect"
import * as path from "path"
import { mkdir, open, readFile, readdir, stat, unlink, utimes, writeFile } from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import * as Tool from "./tool"
import DESCRIPTION from "./show-visual.txt"

const MAX_HTML = 400_000
// Visuals not shown for this long are deleted, unless saved with `keep`.
export const PURGE_AFTER_MS = 183 * 24 * 60 * 60 * 1000
// How many saved visuals the tool description lists for the model.
const LISTED = 40
const HEADER = /^<!-- opencode-visual (\{.*?\}) -->\n/

export const Parameters = Schema.Struct({
  title: Schema.String.check(Schema.isNonEmpty()).annotate({
    description: "Short title shown on the card, e.g. 'Fox and lion population model'",
  }),
  html: Schema.optional(Schema.String).annotate({
    description:
      "Self-contained HTML document or fragment (inline CSS/JS). Scripts may only load from cdn.jsdelivr.net, cdnjs.cloudflare.com or unpkg.com. Omit when reusing a saved visual with `template`.",
  }),
  template: Schema.optional(Schema.String).annotate({
    description: "ID of a saved visual to show again instead of sending `html`. Pair it with `data` to change what it shows.",
  }),
  data: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "JSON object the visual reads as window.VISUAL_DATA (for example the series to plot).",
  }),
  name: Schema.optional(Schema.String).annotate({
    description:
      "Stable ID to save this visual under for reuse, e.g. 'function-plotter'. Saving again with the same name replaces it.",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "One line for the saved-visuals list: what it does and the shape of `data` it reads.",
  }),
  keep: Schema.optional(Schema.Boolean).annotate({
    description: "Never delete this visual. Use for general-purpose tools worth reusing, like a plotter or a calculator.",
  }),
}).check(
  Schema.makeFilter((params) => {
    if (params.html !== undefined && params.html.length > MAX_HTML) return `html must be at most ${MAX_HTML} characters`
    if (!params.html === !params.template) return "pass exactly one of html or template"
    return undefined
  }),
)

type Metadata = {
  title: string
  id?: string
  path?: string
  html?: string
}

export type Entry = { id: string; title: string; description?: string; keep: boolean; used: number }

export const ShowVisualTool = Tool.define<typeof Parameters, Metadata, never>(
  "show_visual",
  Effect.gen(function* () {
    const dir = libraryDir()
    // Startup housekeeping; a failure here must not stop the tool from loading.
    const entries = yield* Effect.promise(() =>
      purge(dir, Date.now())
        .then(() => list(dir))
        .catch(() => []),
    )
    return {
      description: [DESCRIPTION, describeLibrary(entries)].filter(Boolean).join("\n\n"),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const shown = yield* Effect.promise(() => resolve(dir, params))
          if (!shown)
            return {
              title: params.title,
              output: `No saved visual with ID "${params.template}". Send the full html instead (and a name to save it).`,
              metadata: { title: params.title },
            }
          return {
            title: params.title,
            output: [
              "Interactive visual shown to the user in the chat.",
              shown.saved
                ? `Saved as \`${shown.id}\`; show it again later with template: "${shown.id}" (and new data) instead of rewriting it.`
                : "",
              "Do not repeat its contents as text; briefly say what it shows and how to use it.",
            ]
              .filter(Boolean)
              .join(" "),
            metadata: { title: params.title, id: shown.id, path: shown.saved, html: withData(shown.html, params.data) },
          }
        }),
    }
  }),
)

async function resolve(dir: string, params: Schema.Schema.Type<typeof Parameters>) {
  if (params.template) {
    const found = await load(dir, params.template)
    if (!found) return undefined
    return { id: slug(params.template), html: found.html, saved: found.path }
  }
  const html = params.html ?? ""
  const id = params.name ? slug(params.name) : `${slug(params.title).slice(0, 40)}-${Date.now().toString(36)}`
  const previous = params.name ? await load(dir, id) : undefined
  const saved = await save(dir, {
    id,
    title: params.title,
    description: params.description ?? previous?.entry.description,
    keep: params.keep ?? previous?.entry.keep ?? false,
    html,
  }).catch(() => undefined)
  return { id, html, saved }
}

/** Puts `data` in front of the visual as window.VISUAL_DATA; `<` is escaped so the JSON cannot close the script tag. */
export function withData(html: string, data: Record<string, unknown> | undefined) {
  if (!data) return html
  return `<script>window.VISUAL_DATA = ${JSON.stringify(data).replace(/</g, "\\u003c")};</script>\n${html}`
}

export async function save(dir: string, input: Omit<Entry, "used"> & { html: string }) {
  const file = path.join(dir, `${input.id}.html`)
  const meta = { title: input.title, description: input.description, keep: input.keep }
  await mkdir(dir, { recursive: true })
  await writeFile(file, `<!-- opencode-visual ${JSON.stringify(meta).replace(/--/g, "\\u002d\\u002d")} -->\n${input.html}`)
  return file
}

/** Reads a saved visual and marks it as used now, which keeps it from being purged. */
export async function load(dir: string, id: string) {
  const file = path.join(dir, `${slug(id)}.html`)
  const text = await readFile(file, "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const now = new Date()
  await utimes(file, now, now).catch(() => {})
  const header = text.match(HEADER)
  return { path: file, html: header ? text.slice(header[0].length) : text, entry: parseHeader(id, header?.[1], now.getTime()) }
}

/** Saved visuals, most recently used first. Only each file's header is read. */
export async function list(dir: string) {
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".html"))
  const entries = await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name)
      const info = await stat(file)
      const handle = await open(file, "r")
      const buffer = Buffer.alloc(2048)
      const read = await handle.read(buffer, 0, buffer.length, 0).finally(() => handle.close())
      const header = buffer.subarray(0, read.bytesRead).toString("utf8").match(HEADER)
      return parseHeader(name.slice(0, -".html".length), header?.[1], info.mtimeMs)
    }),
  )
  return entries.sort((a, b) => b.used - a.used)
}

/** Deletes visuals not used for PURGE_AFTER_MS, except ones saved with `keep`. Returns the deleted IDs. */
export async function purge(dir: string, now: number) {
  const stale = (await list(dir)).filter((entry) => !entry.keep && now - entry.used > PURGE_AFTER_MS)
  await Promise.all(stale.map((entry) => unlink(path.join(dir, `${entry.id}.html`)).catch(() => {})))
  return stale.map((entry) => entry.id)
}

export function describeLibrary(entries: Entry[]) {
  // Kept tools first so a plotter is always listed, then the most recently used.
  const shown = [...entries.filter((entry) => entry.keep), ...entries.filter((entry) => !entry.keep)].slice(0, LISTED)
  if (shown.length === 0) return ""
  return [
    "Saved visuals you can show again with `template` (pass new `data` instead of rewriting the html):",
    ...shown.map(
      (entry) => `- ${entry.id}${entry.keep ? " (keep)" : ""}: ${entry.title}${entry.description ? ` — ${entry.description}` : ""}`,
    ),
  ].join("\n")
}

function parseHeader(id: string, json: string | undefined, used: number): Entry {
  const value = json ? Option.getOrUndefined(Schema.decodeUnknownOption(HeaderSchema)(json)) : undefined
  return { id, title: value?.title ?? id, description: value?.description, keep: value?.keep ?? false, used }
}

const HeaderSchema = Schema.fromJsonString(
  Schema.Struct({
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    keep: Schema.optional(Schema.Boolean),
  }),
)

function libraryDir() {
  if (process.env.OPENCODE_VISUALS_DIR) return process.env.OPENCODE_VISUALS_DIR
  return path.join(Global.Path.data, "visuals", "library")
}

function slug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "visual"
  )
}
