import { isAbsolute, relative, resolve } from "node:path"
import { isAllowedBrowserUrl } from "../browser-url"

export type LaunchConfiguration = {
  name: string
  command: string
  args: string[]
  cwd: string
  port: number
  url?: string
  env: Record<string, string>
}

export type LaunchParse = { configurations: LaunchConfiguration[]; errors: string[] }

/** Characters that would let a value escape the quoting used when a Windows shell is required. */
const UNSAFE = /["%\r\n\0]/

/**
 * Validates the contents of `.opencode/launch.json`. Invalid entries are skipped and
 * reported in `errors`; `cwd` is resolved against `directory` and must stay inside it.
 */
export function parseLaunchConfig(text: string, directory: string): LaunchParse {
  const root = (() => {
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  })()
  if (root instanceof Error) return { configurations: [], errors: [`Invalid JSON: ${root.message}`] }
  const list = isRecord(root) ? root.configurations : undefined
  if (!Array.isArray(list)) return { configurations: [], errors: ['Expected an object with a "configurations" array'] }

  const errors: string[] = []
  const configurations = list.flatMap((item, index): LaunchConfiguration[] => {
    const parsed = parseEntry(item, directory)
    if (typeof parsed === "string") {
      errors.push(`configurations[${index}]: ${parsed}`)
      return []
    }
    if (list.slice(0, index).some((other) => isRecord(other) && other.name === parsed.name)) {
      errors.push(`configurations[${index}]: duplicate name "${parsed.name}"`)
      return []
    }
    return [parsed]
  })
  return { configurations, errors }
}

function parseEntry(item: unknown, directory: string): LaunchConfiguration | string {
  if (!isRecord(item)) return "must be an object"
  if (typeof item.name !== "string" || !item.name.trim()) return '"name" must be a non-empty string'
  if (typeof item.command !== "string" || !item.command.trim()) return '"command" must be a non-empty string'
  const port = item.port
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
    return '"port" must be an integer between 1 and 65535'
  if (item.args !== undefined && !(Array.isArray(item.args) && item.args.every((arg) => typeof arg === "string")))
    return '"args" must be an array of strings'
  if (item.cwd !== undefined && typeof item.cwd !== "string") return '"cwd" must be a string'
  if (
    item.url !== undefined &&
    (typeof item.url !== "string" || !isAllowedBrowserUrl(item.url) || item.url === "about:blank")
  )
    return '"url" must be an http(s) URL'
  if (item.env !== undefined && !(isRecord(item.env) && Object.values(item.env).every((v) => typeof v === "string")))
    return '"env" must be an object of strings'

  const args = (item.args as string[] | undefined) ?? []
  if ([item.command, ...args].some((part) => UNSAFE.test(part as string)))
    return 'command and args must not contain quotes, "%" or line breaks'
  const cwd = resolve(directory, (item.cwd as string | undefined) ?? ".")
  const rel = relative(directory, cwd)
  if (rel.startsWith("..") || isAbsolute(rel)) return '"cwd" must stay inside the project directory'

  return {
    name: item.name.trim(),
    command: item.command,
    args,
    cwd,
    port,
    url: item.url as string | undefined,
    env: (item.env as Record<string, string> | undefined) ?? {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Builds the single command line used when spawning through a Windows shell. */
export function windowsCommandLine(command: string, args: string[]) {
  return [command, ...args].map((part) => (/[\s&|<>^()]/.test(part) || part === "" ? `"${part}"` : part)).join(" ")
}
