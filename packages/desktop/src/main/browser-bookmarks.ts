import type { BrowserBookmark } from "@opencode-ai/app/browser"
import { isAllowedBrowserUrl } from "./browser-url"
import { getStore } from "./store"

const STORE = "opencode.browser-bookmarks"
const KEY = "bookmarks"

export function listBookmarks(): BrowserBookmark[] {
  const value = getStore(STORE).get(KEY)
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is BrowserBookmark =>
      !!item && typeof item.url === "string" && typeof item.title === "string" && typeof item.folder === "string",
  )
}

/** Merges `items` into the saved bookmarks, skipping URLs that are already saved. */
export function addBookmarks(items: BrowserBookmark[]) {
  const current = listBookmarks()
  const seen = new Set(current.map((item) => item.url))
  const fresh = items.filter((item) => {
    if (!item || typeof item.url !== "string" || !isAllowedBrowserUrl(item.url) || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
  const next = [
    ...current,
    ...fresh.map((item) => ({
      title: String(item.title ?? "") || item.url,
      url: item.url,
      folder: String(item.folder ?? ""),
    })),
  ]
  getStore(STORE).set(KEY, next)
  return next
}

export function removeBookmark(url: string) {
  const next = listBookmarks().filter((item) => item.url !== url)
  getStore(STORE).set(KEY, next)
  return next
}
