const SEARCH_URL = "https://duckduckgo.com/?q="
const SCHEME = /^([a-z][a-z0-9+.-]*):/i
const HOST_PORT = /^[^\s/?#:]+:\d+(?:[/?#]|$)/
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i

/** Only web pages (and the blank page) may load inside browser panel views. */
export function isAllowedBrowserUrl(value: string) {
  if (value === "about:blank") return true
  const url = URL.parse(value)
  return url?.protocol === "http:" || url?.protocol === "https:"
}

/**
 * Turns address-bar input into a loadable URL. Returns undefined for empty
 * input and for explicit schemes that are not allowed (file:, javascript:, ...).
 */
export function resolveBrowserInput(input: string) {
  const value = input.trim()
  if (!value) return undefined
  if (SCHEME.test(value) && !HOST_PORT.test(value)) {
    if (!isAllowedBrowserUrl(value)) return undefined
    return URL.parse(value)?.href ?? value
  }
  if (/\s/.test(value)) return SEARCH_URL + encodeURIComponent(value)
  const host = value.split(/[/?#]/)[0]
  if (!host.includes(".") && !LOCAL_HOST.test(value) && !HOST_PORT.test(value))
    return SEARCH_URL + encodeURIComponent(value)
  const url = URL.parse((LOCAL_HOST.test(value) ? "http://" : "https://") + value)
  if (!url || !isAllowedBrowserUrl(url.href)) return SEARCH_URL + encodeURIComponent(value)
  return url.href
}

/** Picks the tab to focus after `closed` is removed from `ids`. */
export function activeAfterClose(ids: string[], closed: string, active: string | undefined) {
  const rest = ids.filter((id) => id !== closed)
  if (active !== closed) return active && rest.includes(active) ? active : rest.at(-1)
  const index = ids.indexOf(closed)
  return rest[Math.min(index, rest.length - 1)]
}
