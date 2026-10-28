import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./wrap-up.txt"

const MAX_ACTIONS = 2
const MAX_LABEL_WORDS = 3

export const Action = Schema.Struct({
  label: Schema.String.check(Schema.isNonEmpty()).annotate({
    description: "Button text, 1-3 words",
  }),
  message: Schema.String.check(Schema.isNonEmpty()).annotate({
    description: "Text sent as the user's reply when the button is clicked",
  }),
})

export const Parameters = Schema.Struct({
  recap: Schema.String.check(Schema.isNonEmpty()).annotate({
    description: "2-3 short sentences: what changed and what is not done or not verified",
  }),
  question: Schema.optional(Schema.String.check(Schema.isNonEmpty())).annotate({
    description: "One short sentence for the single decision the user must make. Omit when nothing is pending",
  }),
  actions: Schema.optional(Schema.mutable(Schema.Array(Action))).annotate({
    description: "0-2 reply buttons. Only allowed together with a question. Put the recommended choice first",
  }),
}).check(
  Schema.makeFilter((params) => {
    if ((params.actions?.length ?? 0) > MAX_ACTIONS) return `actions allows at most ${MAX_ACTIONS} items`
    if (params.actions?.length && !params.question) return "actions are only allowed together with a question"
    if (params.actions?.some((action) => action.label.trim().split(/\s+/).length > MAX_LABEL_WORDS))
      return `action labels must be at most ${MAX_LABEL_WORDS} words`
    return undefined
  }),
)

type Metadata = {
  recap: string
  question?: string
  actions: ReadonlyArray<Schema.Schema.Type<typeof Action>>
}

export const WrapUpTool = Tool.define<typeof Parameters, Metadata, never>(
  "wrap_up",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
      Effect.succeed({
        title: params.question ?? "Wrap up",
        output: "Wrap-up card shown to the user. End your turn now without further text.",
        metadata: {
          recap: params.recap,
          question: params.question,
          actions: params.actions ?? [],
        },
      }),
  }),
)
