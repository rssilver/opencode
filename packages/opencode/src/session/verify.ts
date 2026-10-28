export const DEFAULT_TIMEOUT_MS = 120_000
export const DEFAULT_MAX_ATTEMPTS = 2
export const MAX_OUTPUT_CHARS = 8000

/** Tool ids that modify files in the project. */
export const FILE_TOOLS = new Set(["edit", "write", "apply_patch", "patch", "multiedit"])

/** Metadata flag on the synthetic parts this feature writes, so later turns can find them. */
export const MARKER = "verify"

/**
 * Message history reduced to what the decision needs, oldest first.
 * - `user`: a real (non-synthetic) user message; resets everything
 * - `tool`: a tool call and whether it completed successfully
 * - `verify`: a verification result recorded by this feature
 */
export type Event =
  | { kind: "user" }
  | { kind: "tool"; tool: string; completed: boolean }
  | { kind: "verify"; passed: boolean }

export type Settings = {
  command: string
  timeoutMs: number
  maxAttempts: number
}

export type Decision = { run: false } | { run: true; attempt: number }

export function settings(
  config: { command?: string; timeout_ms?: number; max_attempts?: number; enabled?: boolean } | undefined,
): Settings | undefined {
  const command = config?.command?.trim()
  if (!command || config?.enabled === false) return undefined
  return {
    command,
    timeoutMs: config?.timeout_ms || DEFAULT_TIMEOUT_MS,
    maxAttempts: config?.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
  }
}

/** Number of failed verifications since the last real user message. */
export function failures(events: Event[]) {
  return events
    .slice(events.findLastIndex((event) => event.kind === "user") + 1)
    .filter((event) => event.kind === "verify" && !event.passed).length
}

/** True when a file-changing tool completed after the last user message and the last verification. */
export function changed(events: Event[]) {
  const boundary = events.findLastIndex((event) => event.kind === "user" || event.kind === "verify")
  return events
    .slice(boundary + 1)
    .some((event) => event.kind === "tool" && event.completed && FILE_TOOLS.has(event.tool))
}

export function decide(input: {
  events: Event[]
  maxAttempts: number
  /** Subagent (task) sessions never verify. */
  subagent?: boolean
  aborted?: boolean
}): Decision {
  if (input.subagent || input.aborted) return { run: false }
  if (!changed(input.events)) return { run: false }
  const failed = failures(input.events)
  if (failed >= input.maxAttempts) return { run: false }
  return { run: true, attempt: failed + 1 }
}

/** Keeps the end of the output, where failures usually are. */
export function tail(output: string, max = MAX_OUTPUT_CHARS) {
  if (output.length <= max) return output
  return `[output truncated, showing last ${max} characters]\n${output.slice(output.length - max)}`
}

export function passedNote(command: string) {
  return `Verify passed: ${command}`
}

export function failedNote(input: { command: string; attempt: number; maxAttempts: number; exitCode: number | null }) {
  const status = input.exitCode === null ? "timed out" : `exit code ${input.exitCode}`
  if (input.attempt >= input.maxAttempts)
    return `Verify failed (${status}) after ${input.attempt} attempt(s): ${input.command}. Verification still fails; stopping.`
  return `Verify failed (${status}, attempt ${input.attempt}/${input.maxAttempts}): ${input.command}. Asking the agent to fix it.`
}

export function fixPrompt(input: { command: string; exitCode: number | null; output: string }) {
  const status = input.exitCode === null ? "timed out" : `exited with code ${input.exitCode}`
  return [
    `Automatic verification failed. The command \`${input.command}\` ${status}.`,
    "",
    "Output:",
    "```",
    tail(input.output).trim() || "(no output)",
    "```",
    "",
    "Fix the problems reported above, then stop. Do not change the verification command.",
  ].join("\n")
}

export * as SessionVerify from "./verify"
