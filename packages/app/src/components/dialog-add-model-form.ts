type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type AddModelForm = {
  id: string
  name: string
  context: string
  output: string
  vision: boolean
  toolCall: boolean
  reasoning: boolean
}

export const emptyAddModelForm = (): AddModelForm => ({
  id: "",
  name: "",
  context: "",
  output: "",
  vision: false,
  toolCall: true,
  reasoning: false,
})

export function buildModelOverride(input: { form: AddModelForm; existing: string[]; t: Translator }) {
  const id = input.form.id.trim()
  const name = input.form.name.trim()
  const context = parseLimit(input.form.context, input.t)
  const output = parseLimit(input.form.output, input.t)

  const err = {
    id: !id
      ? input.t("provider.custom.error.required")
      : input.existing.includes(id)
        ? input.t("provider.addModel.error.exists")
        : undefined,
    // The config schema requires both limits together.
    context: context.error ?? (output.value && !context.value ? input.t("provider.custom.error.required") : undefined),
    output: output.error ?? (context.value && !output.value ? input.t("provider.custom.error.required") : undefined),
  }
  if (err.id || err.context || err.output) return { err }

  return {
    err,
    result: {
      modelID: id,
      config: {
        name: name || id,
        attachment: input.form.vision,
        tool_call: input.form.toolCall,
        reasoning: input.form.reasoning,
        ...(input.form.vision ? { modalities: { input: ["text", "image"] as ("text" | "image")[] } } : {}),
        ...(context.value && output.value ? { limit: { context: context.value, output: output.value } } : {}),
      },
    },
  }
}

function parseLimit(value: string, t: Translator) {
  const text = value.trim()
  if (!text) return {}
  const n = Number(text)
  if (!Number.isInteger(n) || n <= 0) return { error: t("provider.addModel.error.limit") }
  return { value: n }
}
