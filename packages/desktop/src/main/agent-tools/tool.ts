export type Args = Record<string, unknown>

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }

export type ToolResult = { content: ToolContent[]; isError?: boolean }

export type Tool = {
  name: string
  description: string
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] }
  run: (args: Args) => Promise<ToolResult>
}

/** Failure that is reported to the model as a tool error rather than crashing the server. */
export class ToolError extends Error {}

export function string(args: Args, key: string) {
  const value = args[key]
  if (typeof value === "string" && value.length > 0) return value
  throw new ToolError(`"${key}" is required and must be a non-empty string.`)
}

export function optionalString(args: Args, key: string) {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value || undefined
  throw new ToolError(`"${key}" must be a string.`)
}

export function number(args: Args, key: string) {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw new ToolError(`"${key}" must be a number.`)
}

export async function runTool(tool: Tool, args: Args): Promise<ToolResult> {
  try {
    return await tool.run(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: [{ type: "text", text: message }], isError: true }
  }
}
