import { describe, expect, test } from "bun:test"
import { mkdtemp, utimes } from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Result, Schema } from "effect"
import {
  Parameters,
  PURGE_AFTER_MS,
  describeLibrary,
  list,
  load,
  purge,
  save,
  withData,
} from "../../src/tool/show-visual"

const accepts = (input: unknown) => Result.isSuccess(Schema.decodeUnknownResult(Parameters)(input))
const tempDir = () => mkdtemp(path.join(os.tmpdir(), "opencode-visuals-"))

describe("tool.show_visual parameters", () => {
  test("accepts a title and html", () => {
    expect(accepts({ title: "Graph", html: "<canvas></canvas><script>1</script>" })).toBe(true)
  })

  test("accepts a template with data instead of html", () => {
    expect(accepts({ title: "Graph", template: "function-plotter", data: { fn: "x^2" } })).toBe(true)
  })

  test("rejects empty or missing fields", () => {
    expect(accepts({ title: "", html: "<p>x</p>" })).toBe(false)
    expect(accepts({ title: "Graph", html: "" })).toBe(false)
    expect(accepts({ title: "Graph" })).toBe(false)
    expect(accepts({})).toBe(false)
  })

  test("rejects html and template together", () => {
    expect(accepts({ title: "Graph", html: "<p>x</p>", template: "plotter" })).toBe(false)
  })

  test("rejects oversized html", () => {
    expect(accepts({ title: "Big", html: "x".repeat(400_001) })).toBe(false)
  })
})

describe("tool.show_visual library", () => {
  test("saves and loads a visual with its header", async () => {
    const dir = await tempDir()
    await save(dir, { id: "plotter", title: "Plotter", description: "data: { fn } -- y=f(x)", keep: true, html: "<p>hi</p>" })
    const found = await load(dir, "plotter")
    expect(found?.html).toBe("<p>hi</p>")
    expect(found?.entry).toMatchObject({ id: "plotter", title: "Plotter", description: "data: { fn } -- y=f(x)", keep: true })
    expect(await load(dir, "missing")).toBeUndefined()
  })

  test("purges unused visuals after six months, except kept ones", async () => {
    const dir = await tempDir()
    await save(dir, { id: "old", title: "Old", keep: false, html: "a" })
    await save(dir, { id: "old-kept", title: "Kept", keep: true, html: "b" })
    await save(dir, { id: "recent", title: "Recent", keep: false, html: "c" })
    const old = new Date(Date.now() - PURGE_AFTER_MS - 1000)
    await utimes(path.join(dir, "old.html"), old, old)
    await utimes(path.join(dir, "old-kept.html"), old, old)

    expect(await purge(dir, Date.now())).toEqual(["old"])
    expect((await list(dir)).map((entry) => entry.id).sort()).toEqual(["old-kept", "recent"])
  })

  test("loading a visual counts as using it", async () => {
    const dir = await tempDir()
    await save(dir, { id: "reused", title: "Reused", keep: false, html: "a" })
    const old = new Date(Date.now() - PURGE_AFTER_MS - 1000)
    await utimes(path.join(dir, "reused.html"), old, old)
    await load(dir, "reused")
    expect(await purge(dir, Date.now())).toEqual([])
  })

  test("lists kept visuals first in the description", () => {
    const text = describeLibrary([
      { id: "recent", title: "Recent", keep: false, used: 2 },
      { id: "plotter", title: "Plotter", description: "plots data.fn", keep: true, used: 1 },
    ])
    expect(text.indexOf("plotter (keep)")).toBeLessThan(text.indexOf("recent"))
    expect(text).toContain("plots data.fn")
    expect(describeLibrary([])).toBe("")
  })

  test("injects data as window.VISUAL_DATA without breaking out of the script", () => {
    expect(withData("<p>x</p>", undefined)).toBe("<p>x</p>")
    const html = withData("<p>x</p>", { label: "</script><b>" })
    expect(html).toStartWith('<script>window.VISUAL_DATA = {"label":"\\u003c/script>\\u003cb>"};</script>')
    expect(html.match(/<\/script>/g)?.length).toBe(1)
  })
})
