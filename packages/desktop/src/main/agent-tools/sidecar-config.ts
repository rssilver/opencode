export type DesktopMcpEntry = {
  type: "remote"
  url: string
  enabled: true
  oauth: false
  timeout: number
  headers: Record<string, string>
}

/** Name the desktop tools appear under in the backend's MCP config. */
export const DESKTOP_MCP_NAME = "desktop"

export function desktopMcpEntry(url: string, token: string): DesktopMcpEntry {
  return {
    type: "remote",
    url,
    enabled: true,
    oauth: false,
    // Applies to tool calls too; preview_start may wait up to 90s for a dev server.
    timeout: 150_000,
    headers: { Authorization: `Bearer ${token}` },
  }
}

/**
 * Adds the desktop MCP server to an existing OPENCODE_CONFIG_CONTENT value, keeping every
 * other key. An unparseable existing value is replaced, since the backend could not use it.
 */
export function mergeConfigContent(existing: string | undefined, entry: DesktopMcpEntry) {
  const base = parseObject(existing)
  const mcp = isObject(base.mcp) ? base.mcp : {}
  return JSON.stringify({ ...base, mcp: { ...mcp, [DESKTOP_MCP_NAME]: entry }, ...previewPermission(base.permission) })
}

// preview_start runs commands from the project's .opencode/launch.json, so it asks first like the
// bash tool does (users can still choose "always allow"). An explicit setting already present wins;
// a non-object permission value is left untouched so its meaning doesn't change.
const PREVIEW_START_PERMISSION = `${DESKTOP_MCP_NAME}_preview_start`

function previewPermission(permission: unknown) {
  if (permission === undefined) return { permission: { [PREVIEW_START_PERMISSION]: "ask" } }
  if (!isObject(permission) || PREVIEW_START_PERMISSION in permission) return {}
  return { permission: { ...permission, [PREVIEW_START_PERMISSION]: "ask" } }
}

function parseObject(text: string | undefined): Record<string, unknown> {
  if (!text) return {}
  try {
    const value: unknown = JSON.parse(text)
    return isObject(value) ? value : {}
  } catch {
    return {}
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
