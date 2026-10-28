import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { buildModelOverride, emptyAddModelForm } from "./dialog-add-model-form"

export function DialogAddModel(props: { providerID: string; providerName: string; existing: string[] }) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSync = useServerSync()
  const [form, setForm] = createStore({ ...emptyAddModelForm(), err: {} as Record<string, string | undefined> })

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof buildModelOverride>["result"]>) => {
      await serverSync().updateConfig({
        provider: { [props.providerID]: { models: { [result.modelID]: result.config } } },
      })
      return result
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.addModel.toast.title", { model: result.config.name }),
        description: language.t("provider.addModel.toast.description", { provider: props.providerName }),
      })
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return
    const output = buildModelOverride({ form, existing: props.existing, t: language.t })
    setForm("err", output.err)
    if (output.result) saveMutation.mutate(output.result)
  }

  return (
    <Dialog title={language.t("provider.addModel.title", { provider: props.providerName })} transition>
      <form onSubmit={save} class="flex flex-col gap-5 px-2.5 pb-6 overflow-y-auto max-h-[60vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={props.providerID} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-14-regular text-text-base">{language.t("provider.addModel.description")}</div>
        </div>
        <div class="px-2.5 flex flex-col gap-4">
          <TextField
            autofocus
            label={language.t("provider.addModel.field.id.label")}
            placeholder={language.t("provider.custom.models.id.placeholder")}
            value={form.id}
            onChange={(v) => setForm({ id: v, err: { ...form.err, id: undefined } })}
            validationState={form.err.id ? "invalid" : undefined}
            error={form.err.id}
          />
          <TextField
            label={language.t("provider.custom.models.name.label")}
            placeholder={language.t("provider.custom.models.name.placeholder")}
            value={form.name}
            onChange={(v) => setForm("name", v)}
          />
          <div class="flex gap-2 items-start">
            <TextField
              class="flex-1"
              label={language.t("provider.addModel.field.context.label")}
              placeholder="128000"
              inputMode="numeric"
              value={form.context}
              onChange={(v) => setForm({ context: v, err: { ...form.err, context: undefined } })}
              validationState={form.err.context ? "invalid" : undefined}
              error={form.err.context}
            />
            <TextField
              class="flex-1"
              label={language.t("provider.addModel.field.output.label")}
              placeholder="8192"
              inputMode="numeric"
              value={form.output}
              onChange={(v) => setForm({ output: v, err: { ...form.err, output: undefined } })}
              validationState={form.err.output ? "invalid" : undefined}
              error={form.err.output}
            />
          </div>
          <Switch checked={form.vision} onChange={(v) => setForm("vision", v)}>
            {language.t("provider.addModel.field.vision")}
          </Switch>
          <Switch checked={form.toolCall} onChange={(v) => setForm("toolCall", v)}>
            {language.t("provider.addModel.field.toolCall")}
          </Switch>
          <Switch checked={form.reasoning} onChange={(v) => setForm("reasoning", v)}>
            {language.t("provider.addModel.field.reasoning")}
          </Switch>
        </div>
        <div class="px-2.5 flex gap-2">
          <Button type="submit" size="large" variant="primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
          <Button type="button" size="large" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
