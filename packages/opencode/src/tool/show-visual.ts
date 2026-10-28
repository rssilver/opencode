import { Effect, Schema } from "effect"
import * as path from "path"
import { mkdir, writeFile } from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./show-visual.txt"

const MAX_HTML = 400_000

export const Parameters = Schema.Struct({
  title: Schema.String.check(Schema.isNonEmpty()).annotate({
    description: "Short title shown on the card, e.g. 'Fox and lion population model'",
  }),
  html: Schema.String.check(Schema.isNonEmpty()).annotate({
    description:
      "Self-contained HTML document or fragment (inline CSS/JS). Scripts may only load from cdn.jsdelivr.net, cdnjs.cloudflare.com or unpkg.com",
  }),
}).check(
  Schema.makeFilter((params) =>
    params.html.length > MAX_HTML ? `html must be at most ${MAX_HTML} characters` : undefined,
  ),
)

type Metadata = {
  title: string
  path?: string
}

export const ShowVisualTool = Tool.define<typeof Parameters, Metadata, never>(
  "show_visual",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const instance = yield* InstanceState.context
        // Keep a copy per project so saved visuals survive the session; failure to write is not fatal.
        const file = path.join(
          Global.Path.data,
          "visuals",
          instance.project.id,
          `${slug(params.title)}-${ctx.callID ?? Date.now()}.html`,
        )
        const saved = yield* Effect.promise(() =>
          mkdir(path.dirname(file), { recursive: true })
            .then(() => writeFile(file, params.html))
            .then(
              () => file,
              () => undefined,
            ),
        )
        return {
          title: params.title,
          output: [
            "Interactive visual shown to the user in the chat.",
            saved ? `A copy was saved to ${saved}.` : "",
            "Do not repeat its contents as text; briefly say what it shows and how to use it.",
          ]
            .filter(Boolean)
            .join(" "),
          metadata: { title: params.title, path: saved },
        }
      }),
  }),
)

function slug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "visual"
  )
}
