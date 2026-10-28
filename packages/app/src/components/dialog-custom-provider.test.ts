import { describe, expect, test } from "bun:test"
import { buildModelOverride, emptyAddModelForm } from "./dialog-add-model-form"
import {
  editedBlacklist,
  formFromConfig,
  mergeFetchedModels,
  modelsRequestHeaders,
  modelsURL,
  parseModelsResponse,
  validateCustomProvider,
} from "./dialog-custom-provider-form"

const t = (key: string) => key

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ row: "m0", id: " model-a ", name: " Model A ", err: {} }],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          { row: "m0", id: "model-a", name: "Model A", err: {} },
          { row: "m1", id: "model-a", name: "Model A 2", err: {} },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })
})

describe("custom provider helpers", () => {
  test("parses OpenAI-style and bare model lists", () => {
    expect(parseModelsResponse({ data: [{ id: "a" }, { id: "a" }, { id: " b " }, {}, null] })).toEqual(["a", "b"])
    expect(parseModelsResponse({ models: [{ name: "x" }] })).toEqual(["x"])
    expect(parseModelsResponse(["m1", "m2"])).toEqual(["m1", "m2"])
    expect(parseModelsResponse({ error: "nope" })).toEqual([])
    expect(parseModelsResponse(undefined)).toEqual([])
  })

  test("builds the models url and request headers", () => {
    expect(modelsURL(" http://localhost:11434/v1/ ")).toBe("http://localhost:11434/v1/models")
    expect(
      modelsRequestHeaders({
        apiKey: "sk",
        headers: [
          { key: "X-A", value: "1" },
          { key: "", value: "" },
        ],
      }),
    ).toEqual({
      Authorization: "Bearer sk",
      "X-A": "1",
    })
    expect(modelsRequestHeaders({ apiKey: "{env:KEY}", headers: [] })).toEqual({})
  })

  test("merges fetched models without duplicating existing rows", () => {
    const rows = mergeFetchedModels(
      [
        { row: "a", id: "keep", name: "Kept", err: {} },
        { row: "b", id: "", name: "", err: {} },
      ],
      ["keep", "new"],
    )
    expect(rows.map((r) => [r.id, r.name])).toEqual([
      ["keep", "Kept"],
      ["new", "new"],
    ])
  })

  test("round-trips config into a form and tracks removed models", () => {
    const form = formFromConfig("p", {
      name: "P",
      env: ["KEY"],
      options: { baseURL: "http://x/v1", headers: { A: "b" } },
      models: { one: { name: "One" }, two: {} },
    })
    expect(form.apiKey).toBe("{env:KEY}")
    expect(form.models.map((m) => [m.id, m.name])).toEqual([
      ["one", "One"],
      ["two", "two"],
    ])
    expect(form.headers.map((h) => [h.key, h.value])).toEqual([["A", "b"]])
    expect(editedBlacklist(["old", "one"], ["one", "two"], ["one"])).toEqual(["old", "two"])
  })
})

describe("buildModelOverride", () => {
  test("builds a model override with limits and vision", () => {
    const out = buildModelOverride({
      form: { ...emptyAddModelForm(), id: " m ", context: "1000", output: "200", vision: true, reasoning: true },
      existing: [],
      t,
    })
    expect(out.result).toEqual({
      modelID: "m",
      config: {
        name: "m",
        attachment: true,
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"] },
        limit: { context: 1000, output: 200 },
      },
    })
  })

  test("validates id, duplicates and paired limits", () => {
    const form = emptyAddModelForm()
    expect(buildModelOverride({ form, existing: [], t }).err.id).toBe("provider.custom.error.required")
    expect(buildModelOverride({ form: { ...form, id: "a" }, existing: ["a"], t }).err.id).toBe(
      "provider.addModel.error.exists",
    )
    expect(buildModelOverride({ form: { ...form, id: "a", context: "10" }, existing: [], t }).err.output).toBe(
      "provider.custom.error.required",
    )
    expect(
      buildModelOverride({ form: { ...form, id: "a", context: "x", output: "1" }, existing: [], t }).err.context,
    ).toBe("provider.addModel.error.limit")
  })
})
