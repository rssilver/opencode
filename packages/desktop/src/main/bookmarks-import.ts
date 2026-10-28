import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { BrowserBookmark, BrowserImportProfile } from "@opencode-ai/app/browser"
import { isAllowedBrowserUrl } from "./browser-url"

type Node = { type?: unknown; name?: unknown; url?: unknown; children?: unknown }

const PROFILE_DIR = /^(?:Default|Profile \d+)$/
const BROWSERS = ["chrome", "edge"] as const

/**
 * Flattens the `roots` of a Chromium `Bookmarks` file. The bookmarks bar contributes
 * its folders directly; the other roots are prefixed with their own name.
 * Only http(s) bookmarks are kept.
 */
export function parseChromiumBookmarks(data: unknown): BrowserBookmark[] {
  const roots = (data as { roots?: Record<string, unknown> } | undefined)?.roots
  if (!roots || typeof roots !== "object") return []
  return Object.entries(roots).flatMap(([key, root]) => {
    if (!root || typeof root !== "object") return []
    const node = root as Node
    const base = key === "bookmark_bar" ? [] : [text(node.name)].filter(Boolean)
    return walk(node, base)
  })
}

function walk(node: Node, path: string[]): BrowserBookmark[] {
  if (!Array.isArray(node.children)) return []
  return node.children.flatMap((child: Node) => {
    if (!child || typeof child !== "object") return []
    if (child.type === "folder") return walk(child, [...path, text(child.name)].filter(Boolean))
    if (child.type !== "url" || typeof child.url !== "string" || !isAllowedBrowserUrl(child.url)) return []
    return [{ title: text(child.name) || child.url, url: child.url, folder: path.join(" / ") }]
  })
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function userDataDir(browser: (typeof BROWSERS)[number]) {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    return browser === "chrome"
      ? join(base, "Google", "Chrome", "User Data")
      : join(base, "Microsoft", "Edge", "User Data")
  }
  if (process.platform === "darwin") {
    const base = join(homedir(), "Library", "Application Support")
    return browser === "chrome" ? join(base, "Google", "Chrome") : join(base, "Microsoft Edge")
  }
  return join(homedir(), ".config", browser === "chrome" ? "google-chrome" : "microsoft-edge")
}

// Missing, locked or malformed files are treated as absent.
async function tryReadJson(file: string) {
  return readFile(file, "utf8")
    .then((raw) => JSON.parse(raw) as unknown)
    .catch(() => undefined)
}

/** Lists Chrome and Edge profiles that have a readable `Bookmarks` file. */
export async function listImportProfiles(): Promise<BrowserImportProfile[]> {
  const found = await Promise.all(
    BROWSERS.map(async (browser) => {
      const dir = userDataDir(browser)
      const state = (await tryReadJson(join(dir, "Local State"))) as
        | { profile?: { info_cache?: Record<string, { name?: unknown }> } }
        | undefined
      const cache = state?.profile?.info_cache ?? {}
      const dirs = Object.keys(cache).filter((name) => PROFILE_DIR.test(name))
      const candidates = dirs.length > 0 ? dirs : ["Default"]
      const checked = await Promise.all(
        candidates.map(async (name) => ({
          name,
          data: await tryReadJson(join(dir, name, "Bookmarks")),
        })),
      )
      return checked.flatMap((item) => {
        if (item.data === undefined) return []
        const display = text(cache[item.name]?.name) || item.name
        return [{ id: `${browser}:${item.name}`, browser, name: display }]
      })
    }),
  )
  return found.flat()
}

export async function readImportProfile(id: string): Promise<BrowserBookmark[]> {
  const [browser, name] = id.split(":")
  const match = BROWSERS.find((item) => item === browser)
  // The profile directory comes from the renderer, so only known shapes are joined into a path.
  if (!match || !PROFILE_DIR.test(name ?? "")) return []
  return parseChromiumBookmarks(await tryReadJson(join(userDataDir(match), name, "Bookmarks")))
}
