import { describe, expect, test } from "bun:test"
import { activeAfterClose, isAllowedBrowserUrl, resolveBrowserInput } from "./browser-url"

describe("resolveBrowserInput", () => {
  test("adds https when no scheme is present", () => {
    expect(resolveBrowserInput("example.com")).toBe("https://example.com/")
    expect(resolveBrowserInput("  example.com/a?b=c ")).toBe("https://example.com/a?b=c")
  })

  test("keeps explicit http and https URLs", () => {
    expect(resolveBrowserInput("http://example.com")).toBe("http://example.com/")
    expect(resolveBrowserInput("https://example.com/x")).toBe("https://example.com/x")
  })

  test("uses http for local hosts and keeps ports", () => {
    expect(resolveBrowserInput("localhost:3000")).toBe("http://localhost:3000/")
    expect(resolveBrowserInput("127.0.0.1:8080/app")).toBe("http://127.0.0.1:8080/app")
    expect(resolveBrowserInput("example.com:8443")).toBe("https://example.com:8443/")
  })

  test("falls back to search for spaces or dotless words", () => {
    expect(resolveBrowserInput("how to bake bread")).toBe("https://duckduckgo.com/?q=how%20to%20bake%20bread")
    expect(resolveBrowserInput("opencode")).toBe("https://duckduckgo.com/?q=opencode")
  })

  test("rejects empty input and blocked schemes", () => {
    expect(resolveBrowserInput("   ")).toBeUndefined()
    expect(resolveBrowserInput("javascript:alert(1)")).toBeUndefined()
    expect(resolveBrowserInput("file:///C:/Windows/win.ini")).toBeUndefined()
    expect(resolveBrowserInput("oc://index.html")).toBeUndefined()
    expect(resolveBrowserInput("data:text/html,hi")).toBeUndefined()
  })

  test("allows about:blank", () => {
    expect(resolveBrowserInput("about:blank")).toBe("about:blank")
  })
})

describe("isAllowedBrowserUrl", () => {
  test("allows only web URLs and about:blank", () => {
    expect(isAllowedBrowserUrl("https://a.dev")).toBe(true)
    expect(isAllowedBrowserUrl("http://a.dev")).toBe(true)
    expect(isAllowedBrowserUrl("about:blank")).toBe(true)
    expect(isAllowedBrowserUrl("file:///etc/passwd")).toBe(false)
    expect(isAllowedBrowserUrl("javascript:1")).toBe(false)
    expect(isAllowedBrowserUrl("oc://app/index.html")).toBe(false)
    expect(isAllowedBrowserUrl("not a url")).toBe(false)
  })
})

describe("activeAfterClose", () => {
  test("keeps the active tab when another closes", () => {
    expect(activeAfterClose(["a", "b", "c"], "b", "c")).toBe("c")
  })

  test("moves to the neighbour when the active tab closes", () => {
    expect(activeAfterClose(["a", "b", "c"], "b", "b")).toBe("c")
    expect(activeAfterClose(["a", "b", "c"], "c", "c")).toBe("b")
  })

  test("returns undefined when the last tab closes", () => {
    expect(activeAfterClose(["a"], "a", "a")).toBeUndefined()
  })
})
