import { describe, expect, test } from "bun:test"
import { clickScript, parseTarget, readScript, scrollScript, typeScript } from "./page-script"

describe("parseTarget", () => {
  test("prefers index, falls back to selector", () => {
    expect(parseTarget({ index: 3, selector: "a" })).toEqual({ index: 3 })
    expect(parseTarget({ selector: " #go " })).toEqual({ selector: "#go" })
    expect(parseTarget({ index: -1 })).toBeUndefined()
    expect(parseTarget({ index: 1.5 })).toBeUndefined()
    expect(parseTarget({ selector: "  " })).toBeUndefined()
  })
})

describe("scripts", () => {
  test("every generated script is syntactically valid", () => {
    const scripts = [
      readScript(1000),
      clickScript({ index: 2 }),
      clickScript({ selector: 'a[href="x"]' }),
      typeScript({ index: 0 }, "hi", true),
      scrollScript("down"),
    ]
    for (const script of scripts) expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  test("user data is embedded as a literal and cannot break out", () => {
    const hostile = `"); throw new Error("pwned"); ("`
    const script = typeScript({ selector: hostile }, hostile, false)
    expect(() => new Function(`return ${script}`)).not.toThrow()
    expect(script).toContain(JSON.stringify(hostile))
  })

  test("click and type run against a stubbed DOM", () => {
    const clicked: string[] = []
    const el = {
      disabled: false,
      tagName: "BUTTON",
      innerText: "Go",
      getAttribute: () => null,
      scrollIntoView() {},
      focus() {},
      click: () => clicked.push("x"),
    }
    const document = { querySelector: (query: string) => (query === '[data-oc-idx="4"]' ? el : null) }
    const run = (script: string) => new Function("document", `return ${script}`)(document)
    expect(run(clickScript({ index: 4 }))).toEqual({ ok: true, message: 'Clicked <button> "Go".' })
    expect(clicked).toHaveLength(1)
    expect(run(clickScript({ index: 5 })).ok).toBe(false)
  })
})
