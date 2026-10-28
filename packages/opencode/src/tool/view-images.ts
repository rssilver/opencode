import { Effect, Option, Schema, Stream } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LLMEvent } from "@opencode-ai/llm"
import type { ModelMessage } from "ai"
import path from "path"
import * as Tool from "./tool"
import DESCRIPTION from "./view-images.txt"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { sniffAttachmentMime } from "@/util/media"
import { assertExternalDirectoryEffect } from "./external-directory"

const DEFAULT_LIMIT = 6
const MAX_LIMIT = 12
const SNIFF_BYTES = 16
const DEFAULT_QUESTION = "Describe each image in detail, including any visible text."
const SUPPORTED_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "The folder (or single image file) to view, absolute or relative to the project directory",
  }),
  pattern: Schema.optional(Schema.String).annotate({
    description: "Optional glob to narrow the images, e.g. 'screenshot-*.png'. Defaults to all supported image types",
  }),
  recursive: Schema.optional(Schema.Boolean).annotate({
    description: "Include images in subfolders (defaults to false)",
  }),
  offset: Schema.optional(NonNegativeInt).annotate({
    description: "Index of the first image to show, for paging (defaults to 0)",
  }),
  limit: Schema.optional(NonNegativeInt).annotate({
    description: `Maximum images to show per call (defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
  }),
  question: Schema.optional(Schema.String).annotate({
    description:
      "What you want to know about the images. Only used when the current model cannot view images and a vision model answers instead",
  }),
})

export type Mode = "attach" | "describe" | "unsupported"

type Metadata = {
  preview: string
  truncated: boolean
  total: number
  shown: number
  mode: Mode
}

type Size = { width: number; height: number } | undefined

/** Decides how images are delivered for the active model. */
export function deliveryMode(input: { supportsImages: boolean; visionModel?: string }): Mode {
  if (input.supportsImages) return "attach"
  if (input.visionModel) return "describe"
  return "unsupported"
}

export const ViewImagesTool = Tool.define<
  typeof Parameters,
  Metadata,
  FSUtil.Service | Config.Service | Provider.Service | LLM.Service | Agent.Service
>(
  "view_images",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const agents = yield* Agent.Service

    const sniff = Effect.fn("ViewImagesTool.sniff")(function* (filepath: string) {
      const header = yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fs.open(filepath, { flag: "r" })
          return Option.getOrElse(yield* file.readAlloc(SNIFF_BYTES), () => new Uint8Array())
        }),
      ).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
      const mime = sniffAttachmentMime(header, "")
      return SUPPORTED_MIMES.has(mime) ? mime : undefined
    })

    const find = Effect.fn("ViewImagesTool.find")(function* (
      target: string,
      isDirectory: boolean,
      params: Schema.Schema.Type<typeof Parameters>,
    ) {
      if (!isDirectory) return [target]
      const recursive = params.recursive ?? false
      const pattern = params.pattern
        ? recursive && !params.pattern.includes("/")
          ? `**/${params.pattern}`
          : params.pattern
        : recursive
          ? "**/*"
          : "*"
      const found = yield* fs.glob(pattern, { cwd: target, absolute: true, include: "file" })
      return params.pattern ? found : found.filter((item) => IMAGE_EXTENSION.test(item))
    })

    const run = Effect.fn("ViewImagesTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const instance = yield* InstanceState.context
      const target = FSUtil.normalizePath(
        path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path),
      )
      const title = path.relative(instance.worktree, target) || "."

      const stat = yield* fs.stat(target).pipe(
        Effect.catchIf(
          (err) => "reason" in err && err.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
      )
      yield* assertExternalDirectoryEffect(ctx, target, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
        kind: stat?.type === "Directory" ? "directory" : "file",
      })
      yield* ctx.ask({
        permission: "read",
        patterns: [title],
        always: ["*"],
        metadata: {},
      })
      if (!stat) return yield* Effect.fail(new Error(`Path not found: ${target}`))

      const isDirectory = stat.type === "Directory"
      const root = isDirectory ? target : path.dirname(target)
      const relative = (item: string) => path.relative(root, item).replaceAll("\\", "/") || path.basename(item)

      const candidates = yield* find(target, isDirectory, params)
      const sniffed = yield* Effect.forEach(
        candidates,
        (item) => sniff(item).pipe(Effect.map((mime) => (mime ? [{ file: item, mime }] : []))),
        { concurrency: 16 },
      )
      const images = sniffed.flat().toSorted((a, b) => relative(a.file).localeCompare(relative(b.file)))

      const offset = params.offset ?? 0
      const limit = Math.min(Math.max(params.limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
      const page = images.slice(offset, offset + limit)
      const end = offset + page.length

      const loaded = yield* Effect.forEach(
        page,
        Effect.fnUntraced(function* (item) {
          const bytes = yield* fs.readFile(item.file)
          const size = dimensions(bytes, item.mime)
          return {
            label: relative(item.file),
            mime: item.mime,
            url: `data:${item.mime};base64,${Buffer.from(bytes).toString("base64")}`,
            info: [item.mime, size ? `${size.width}x${size.height}` : undefined, formatBytes(bytes.length)]
              .filter(Boolean)
              .join(", "),
          }
        }),
        { concurrency: 4 },
      )

      const header = isDirectory
        ? `Found ${images.length} image(s) in ${target}${params.pattern ? ` matching "${params.pattern}"` : ""}${params.recursive ? " (recursive)" : ""}.`
        : `Image file: ${target}`
      const range = page.length
        ? `Showing ${offset + 1}-${end} of ${images.length}:`
        : "No images to show on this page."
      const listing = loaded.map((item, i) => `${offset + i + 1}. ${item.label} (${item.info})`)
      const next =
        end < images.length
          ? `Next page: call view_images again with offset=${end} (${images.length - end} more).`
          : page.length
            ? "No more images."
            : ""
      const lines = [header, range, ...listing, next]

      const model = ctx.extra?.["model"] as Provider.Model | undefined
      const vision = (yield* config.get()).vision?.model
      const mode =
        page.length === 0
          ? "attach"
          : deliveryMode({ supportsImages: model ? model.capabilities.input.image : true, visionModel: vision })

      const result = (output: string[], shown: number) => ({
        title,
        output: output.join("\n"),
        metadata: { preview: listing.slice(0, 20).join("\n"), truncated: false, total: images.length, shown, mode },
      })

      if (mode === "attach")
        return {
          ...result(lines.filter(Boolean), loaded.length),
          attachments: loaded.map((item) => ({ type: "file" as const, mime: item.mime, url: item.url })),
        }

      if (mode === "unsupported")
        return result(
          [
            ...lines.filter(Boolean),
            "",
            "The current model cannot view images, so the images were not attached.",
            'To enable image understanding, set a vision-capable model in opencode.json, e.g. { "vision": { "model": "provider/model" } }, and run this tool again.',
          ],
          0,
        )

      const answer = yield* describeImages({ provider, llm, agents }, ctx, vision!, params.question?.trim() || DEFAULT_QUESTION, loaded).pipe(
        Effect.map((text) => text.trim() || "(the vision model returned no text)"),
        Effect.catch((error) =>
          Effect.succeed(`Vision model ${vision} failed: ${error instanceof Error ? error.message : String(error)}`),
        ),
      )
      return result(
        [
          ...lines.filter(Boolean),
          "",
          `Description from vision model ${vision} (images were not attached to this conversation):`,
          answer,
        ],
        loaded.length,
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

export const describeImages = Effect.fn("ViewImagesTool.describe")(function* (
  services: { provider: Provider.Interface; llm: LLM.Interface; agents: Agent.Interface },
  ctx: Tool.Context,
  modelRef: string,
  question: string,
  images: { label: string; mime: string; url: string }[],
) {
  const parsed = Provider.parseModel(modelRef)
  const model = yield* services.provider.getModel(parsed.providerID, parsed.modelID)
  const agent = yield* services.agents.get(ctx.agent)
  const user = ctx.messages.flatMap((item) => (item.info.role === "user" ? [item.info] : [])).at(-1)
  if (!agent || !user) return yield* Effect.fail(new Error("no active session message to attach the request to"))
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${question}\n\nAnswer separately for each of the ${images.length} image(s), prefixed with its label.`,
        },
        ...images.flatMap((image) => [
          { type: "text" as const, text: `Image: ${image.label}` },
          { type: "image" as const, image: image.url, mediaType: image.mime },
        ]),
      ],
    },
  ]
  return yield* services.llm
    .stream({
      agent,
      user,
      system: [],
      small: true,
      tools: {},
      model,
      sessionID: ctx.sessionID,
      retries: 2,
      messages,
    })
    .pipe(
      Stream.filter(LLMEvent.is.textDelta),
      Stream.map((event) => event.text),
      Stream.mkString,
    )
})

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** Reads image dimensions from the file header; undefined when the header is unusual. */
export function dimensions(bytes: Uint8Array, mime: string): Size {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mime === "image/png") return bytes.length >= 24 ? size(view.getUint32(16), view.getUint32(20)) : undefined
  if (mime === "image/gif")
    return bytes.length >= 10 ? size(view.getUint16(6, true), view.getUint16(8, true)) : undefined
  if (mime === "image/webp") return webp(bytes, view)
  if (mime === "image/jpeg") return jpeg(bytes, view)
  return undefined
}

function size(width: number, height: number): Size {
  return width > 0 && height > 0 ? { width, height } : undefined
}

function webp(bytes: Uint8Array, view: DataView): Size {
  if (bytes.length < 30) return undefined
  const kind = String.fromCharCode(...bytes.subarray(12, 16))
  if (kind === "VP8 ") return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
  if (kind === "VP8L") {
    const bits = view.getUint32(21, true)
    return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (kind === "VP8X") {
    const at = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    return size(at(24) + 1, at(27) + 1)
  }
  return undefined
}

function jpeg(bytes: Uint8Array, view: DataView): Size {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1]
    // Start-of-frame markers carry the dimensions (excluding DHT, JPG and DAC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return size(view.getUint16(offset + 7), view.getUint16(offset + 5))
    offset +=
      marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) ? 2 : 2 + view.getUint16(offset + 2)
  }
  return undefined
}
