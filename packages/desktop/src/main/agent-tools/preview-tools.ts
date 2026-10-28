import { spawn, spawnSync } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { parseLaunchConfig, windowsCommandLine, type LaunchConfiguration } from "./launch-config"
import { openUrl } from "./browser-tools"
import { LineBuffer } from "./ring-buffer"
import { number, string, ToolError, type Tool, type ToolResult } from "./tool"
import { waitForPort } from "./wait-port"

const START_TIMEOUT = 90_000
const DEFAULT_LOG_LINES = 80

type Preview = {
  config: LaunchConfiguration
  child: ChildProcess
  logs: LineBuffer
  exited: boolean
  exitCode?: number | null
  starting?: Promise<void>
}

const previews = new Map<string, Preview>()

const directoryProperty = {
  type: "string",
  description: "Absolute path of the project directory that contains .opencode/launch.json.",
}
const nameProperty = { type: "string", description: "Configuration name from launch.json (see preview_list)." }

export const previewTools: Tool[] = [
  {
    name: "preview_list",
    description:
      'List the dev-server configurations defined in the project\'s .opencode/launch.json. The file looks like {"configurations":[{"name":"web","command":"bun","args":["dev"],"cwd":"packages/app","port":3000,"url":"http://localhost:3000","env":{}}]}; only name, command and port are required.',
    inputSchema: { type: "object", properties: { directory: directoryProperty }, required: ["directory"] },
    run: async (args) => {
      const directory = requireDirectory(args)
      const parsed = await loadConfigurations(directory)
      const lines = parsed.configurations.map((config) => {
        const running = previews.get(key(directory, config.name))
        return `${config.name}: ${[config.command, ...config.args].join(" ")} (port ${config.port})${running && !running.exited ? " [running]" : ""}`
      })
      return text(
        [lines.join("\n") || "No valid configurations.", ...parsed.errors.map((error) => `Problem: ${error}`)].join(
          "\n",
        ),
      )
    },
  },
  {
    name: "preview_start",
    description:
      "Start a dev server from .opencode/launch.json, wait until its port accepts connections (up to 90 seconds) and open it in the built-in browser panel. Reuses the process if that configuration is already running. On failure returns the recent output so you can fix the problem.",
    inputSchema: {
      type: "object",
      properties: { directory: directoryProperty, name: nameProperty },
      required: ["directory", "name"],
    },
    run: async (args) => {
      const directory = requireDirectory(args)
      const config = await requireConfiguration(directory, string(args, "name"))
      return start(directory, config)
    },
  },
  {
    name: "preview_logs",
    description: "Show the most recent stdout/stderr lines of a dev server started with preview_start.",
    inputSchema: {
      type: "object",
      properties: {
        directory: directoryProperty,
        name: nameProperty,
        lines: { type: "integer", description: `Number of lines. Default ${DEFAULT_LOG_LINES}, at most 500.` },
      },
      required: ["directory", "name"],
    },
    run: async (args) => {
      const preview = previews.get(key(requireDirectory(args), string(args, "name")))
      if (!preview) throw new ToolError("That preview has not been started in this app session.")
      const lines = Math.min(Math.max(number(args, "lines") ?? DEFAULT_LOG_LINES, 1), 500)
      return text(`${status(preview)}\n${preview.logs.tail(lines).join("\n") || "(no output yet)"}`)
    },
  },
  {
    name: "preview_stop",
    description: "Stop a dev server started with preview_start (kills its whole process tree).",
    inputSchema: {
      type: "object",
      properties: { directory: directoryProperty, name: nameProperty },
      required: ["directory", "name"],
    },
    run: async (args) => {
      const id = key(requireDirectory(args), string(args, "name"))
      const preview = previews.get(id)
      if (!preview) throw new ToolError("That preview is not running.")
      previews.delete(id)
      if (!preview.exited) killTree(preview.child)
      return text(`Stopped ${preview.config.name}.`)
    },
  },
]

/** Kills every running preview process; called when the app quits. */
export function stopAllPreviews() {
  previews.forEach((preview) => {
    if (!preview.exited) killTree(preview.child)
  })
  previews.clear()
}

async function start(directory: string, config: LaunchConfiguration): Promise<ToolResult> {
  const id = key(directory, config.name)
  const existing = previews.get(id)
  if (existing && !existing.exited) {
    await existing.starting
    if (existing.exited) return failure(existing, "exited while starting")
    const url = config.url ?? `http://localhost:${config.port}`
    const opened = await openUrl(url, true)
    return text(
      `Already running (pid ${existing.child.pid}).\n${opened.content[0]?.type === "text" ? opened.content[0].text : ""}`,
    )
  }

  const preview = spawnPreview(config)
  previews.set(id, preview)
  const waiting = waitForPort(config.port, { timeoutMs: START_TIMEOUT, alive: () => !preview.exited })
  preview.starting = waiting.then(() => undefined)
  const ready = await waiting
  if (!ready) {
    const reason = preview.exited
      ? `exited with code ${preview.exitCode}`
      : `did not open port ${config.port} within 90s`
    if (!preview.exited) killTree(preview.child)
    previews.delete(id)
    return failure(preview, reason)
  }
  const url = config.url ?? `http://localhost:${config.port}`
  const opened = await openUrl(url, true)
  return text(
    `Started ${config.name} (pid ${preview.child.pid}) at ${url}\n${opened.content[0]?.type === "text" ? opened.content[0].text : ""}`,
  )
}

function spawnPreview(config: LaunchConfiguration): Preview {
  const env = { ...process.env, ...config.env }
  const windows = process.platform === "win32"
  // On Windows, .cmd shims (npm, bun, pnpm) only run through the shell; parts are validated and quoted.
  const child = windows
    ? spawn(windowsCommandLine(config.command, config.args), { cwd: config.cwd, env, shell: true, windowsHide: true })
    : spawn(config.command, config.args, { cwd: config.cwd, env, detached: true })
  const preview: Preview = { config, child, logs: new LineBuffer(500), exited: false }
  const collect = (chunk: Buffer) => preview.logs.push(chunk.toString("utf8"))
  child.stdout?.on("data", collect)
  child.stderr?.on("data", collect)
  child.on("error", (error) => {
    preview.logs.push(`[spawn error] ${error.message}\n`)
    preview.exited = true
  })
  child.on("exit", (code) => {
    preview.exited = true
    preview.exitCode = code
  })
  return preview
}

function failure(preview: Preview, reason: string): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `${preview.config.name} ${reason}.\nRecent output:\n${preview.logs.tail(DEFAULT_LOG_LINES).join("\n") || "(none)"}`,
      },
    ],
  }
}

function status(preview: Preview) {
  return preview.exited
    ? `${preview.config.name}: exited (code ${preview.exitCode})`
    : `${preview.config.name}: running (pid ${preview.child.pid})`
}

function killTree(child: ChildProcess) {
  if (!child.pid) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}

function requireDirectory(args: Record<string, unknown>) {
  const directory = string(args, "directory")
  if (!isAbsolute(directory)) throw new ToolError("directory must be an absolute path.")
  return resolve(directory)
}

async function loadConfigurations(directory: string) {
  const file = join(directory, ".opencode", "launch.json")
  const content = await readFile(file, "utf8").catch(() => undefined)
  if (content === undefined) {
    const exists = await stat(directory).then(
      (info) => info.isDirectory(),
      () => false,
    )
    throw new ToolError(
      exists ? `No .opencode/launch.json found in ${directory}.` : `Directory does not exist: ${directory}`,
    )
  }
  return parseLaunchConfig(content, directory)
}

async function requireConfiguration(directory: string, name: string) {
  const parsed = await loadConfigurations(directory)
  const config = parsed.configurations.find((item) => item.name === name)
  if (config) return config
  const known = parsed.configurations.map((item) => item.name).join(", ") || "none"
  throw new ToolError(
    `No configuration named "${name}". Available: ${known}.${parsed.errors.map((e) => `\nProblem: ${e}`).join("")}`,
  )
}

function key(directory: string, name: string) {
  return `${process.platform === "win32" ? directory.toLowerCase() : directory}\0${name}`
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] }
}
