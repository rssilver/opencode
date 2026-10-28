import path from "path"

export const MAX_ENTRY_CHARS = 500
export const MAX_LOADED_CHARS = 4000
export const HEADING = "Project memory (from .opencode/memory.md)"

/** Memory lives at the project root; non-git projects report "/" as worktree, so fall back to the directory. */
export function file(instance: { directory: string; worktree: string }) {
  return path.join(instance.worktree === "/" ? instance.directory : instance.worktree, ".opencode", "memory.md")
}

/** One memory per `- ` bullet line; everything else in the file is ignored. */
export function parse(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*[-*]\s+(.+?)\s*$/.exec(line)
    return match ? [match[1]] : []
  })
}

export function serialize(entries: readonly string[]) {
  return entries.length ? entries.map((entry) => `- ${entry}`).join("\n") + "\n" : ""
}

/** Entries are single lines, so newlines collapse to spaces; long entries are cut at the cap. */
export function normalize(text: string) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > MAX_ENTRY_CHARS ? flat.slice(0, MAX_ENTRY_CHARS).trimEnd() : flat
}

export type AddResult = { status: "added" | "duplicate" | "empty"; entries: string[]; entry: string }

export function add(entries: readonly string[], text: string): AddResult {
  const entry = normalize(text)
  if (!entry) return { status: "empty", entries: [...entries], entry }
  if (entries.includes(entry)) return { status: "duplicate", entries: [...entries], entry }
  return { status: "added", entries: [...entries, entry], entry }
}

export type RemoveResult = { status: "removed" | "missing"; entries: string[]; entry?: string }

/** Removes by 1-based index, or by exact text when no index is given. */
export function remove(entries: readonly string[], target: { index?: number; text?: string }): RemoveResult {
  const at =
    target.index !== undefined
      ? target.index - 1
      : target.text !== undefined
        ? entries.indexOf(normalize(target.text))
        : -1
  if (!Number.isInteger(at) || at < 0 || at >= entries.length) return { status: "missing", entries: [...entries] }
  return { status: "removed", entries: entries.filter((_, i) => i !== at), entry: entries[at] }
}

/** Formats entries for the system prompt, dropping the oldest entries first to stay within the cap. */
export function render(entries: readonly string[], max = MAX_LOADED_CHARS) {
  const kept: string[] = []
  let used = 0
  for (const entry of entries.toReversed()) {
    const line = `- ${entry}`
    if (used + line.length + 1 > max) break
    kept.unshift(line)
    used += line.length + 1
  }
  if (!kept.length) return undefined
  return `${HEADING}\n${kept.join("\n")}`
}

export * as ProjectMemory from "./memory"
