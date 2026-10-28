const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const models = input.form.models.map((m) => {
    const id = m.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const nameError = !m.name.trim() ? input.t("provider.custom.error.required") : undefined
    return { id: idError, name: nameError }
  })
  const modelsValid = models.every((m) => !m.id && !m.name)
  const modelConfig = Object.fromEntries(input.form.models.map((m) => [m.id.trim(), { name: m.name.trim() }]))

  const seenHeaders = new Set<string>()
  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelRow = (): ModelRow => ({ row: nextRow(), id: "", name: "", err: {} })
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })

type ProviderConfigLike = {
  name?: string
  env?: readonly string[]
  options?: { baseURL?: string; headers?: Record<string, string> } & Record<string, unknown>
  models?: Record<string, { name?: string } | undefined>
}

/** Build an editable form from an existing config entry. The API key lives in auth storage, so it stays blank. */
export function formFromConfig(providerID: string, config: ProviderConfigLike): FormState {
  const models = Object.entries(config.models ?? {}).map(([id, m]) => ({ ...modelRow(), id, name: m?.name ?? id }))
  const headers = Object.entries(config.options?.headers ?? {}).map(([key, value]) => ({
    ...headerRow(),
    key,
    value,
  }))
  const env = config.env?.[0]
  return {
    providerID,
    name: config.name ?? providerID,
    baseURL: config.options?.baseURL ?? "",
    apiKey: env ? `{env:${env}}` : "",
    models: models.length ? models : [modelRow()],
    headers: headers.length ? headers : [headerRow()],
    err: {},
  }
}

/**
 * Config merges cannot delete keys, so models dropped while editing are hidden through the provider blacklist.
 * Models that were re-added are taken back off it.
 */
export function editedBlacklist(existing: readonly string[] | undefined, previous: string[], current: string[]) {
  const keep = (existing ?? []).filter((id) => !current.includes(id))
  const removed = previous.filter((id) => !current.includes(id) && !keep.includes(id))
  return [...keep, ...removed]
}

export function modelsURL(baseURL: string) {
  return `${baseURL.trim().replace(/\/+$/, "")}/models`
}

/** Accepts the OpenAI list shape `{ data: [{ id }] }`, plus `{ models: [...] }` and bare arrays. */
export function parseModelsResponse(json: unknown): string[] {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object"
      ? ((json as { data?: unknown }).data ?? (json as { models?: unknown }).models)
      : undefined
  if (!Array.isArray(list)) return []
  const ids = list.flatMap((item): string[] => {
    if (typeof item === "string") return [item]
    if (!item || typeof item !== "object") return []
    const value = (item as { id?: unknown }).id ?? (item as { name?: unknown }).name
    return typeof value === "string" && value.trim() ? [value.trim()] : []
  })
  return [...new Set(ids)]
}

export function modelsRequestHeaders(input: {
  apiKey: string
  headers: { key: string; value: string }[]
}): Record<string, string> {
  const key = input.apiKey.trim()
  const custom = input.headers.map((h) => [h.key.trim(), h.value.trim()] as const).filter(([k, v]) => !!k && !!v)
  return {
    ...(key && !/^\{env:[^}]+\}$/.test(key) ? { Authorization: `Bearer ${key}` } : {}),
    ...Object.fromEntries(custom),
  }
}

/** Drops blank rows, keeps rows whose id is already present, and appends the rest. */
export function mergeFetchedModels(rows: ModelRow[], ids: string[]): ModelRow[] {
  const kept = rows.filter((r) => r.id.trim() || r.name.trim())
  const known = new Set(kept.map((r) => r.id.trim()))
  return [...kept, ...ids.filter((id) => !known.has(id)).map((id) => ({ ...modelRow(), id, name: id }))]
}
