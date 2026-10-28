import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { write as writeLog } from "../logging"
import { browserTools } from "./browser-tools"
import { previewTools, stopAllPreviews } from "./preview-tools"
import { videoTools } from "./video-tools"
import { runTool, type Tool } from "./tool"

const MAX_BODY = 1024 * 1024

export type AgentToolsServer = { url: string; token: string; stop: () => Promise<void> }

const tools: Tool[] = [...browserTools, ...videoTools, ...previewTools]

/**
 * Starts the local MCP server that exposes the desktop app's browser panel and dev-server
 * previews to the agent. It binds loopback only and requires a random bearer token.
 */
export async function startAgentToolsServer(): Promise<AgentToolsServer> {
  const token = randomBytes(32).toString("hex")
  const server = createServer((req, res) => {
    void handle(req, res, token, port()).catch((error: unknown) => {
      writeLog("agent-tools", "request failed", { error: String(error) }, "warn")
      if (!res.headersSent) respond(res, 500, "Internal error")
      else res.end()
    })
  })
  const port = () => {
    const address = server.address()
    return typeof address === "object" && address ? address.port : 0
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  writeLog("agent-tools", "listening", { port: port() })

  return {
    url: `http://127.0.0.1:${port()}/mcp`,
    token,
    stop: () => {
      stopAllPreviews()
      server.closeAllConnections()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, token: string, port: number) {
  // Loopback-only sockets can still be reached from web pages (DNS rebinding), so pin the
  // Host header and refuse anything that looks like a browser request.
  if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin) return respond(res, 403, "Forbidden")
  if (!authorized(req.headers.authorization, token)) return respond(res, 401, "Unauthorized")
  if (new URL(req.url ?? "/", "http://127.0.0.1").pathname !== "/mcp") return respond(res, 404, "Not found")
  // Stateless mode: each request gets its own MCP server and transport.
  if (req.method !== "POST") return respond(res, 405, "Method not allowed")

  const body = await readBody(req)
  if (body === undefined) return respond(res, 413, "Payload too large")

  const mcp = new Server({ name: "opencode-desktop", version: "1.0.0" }, { capabilities: { tools: {} } })
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  }))
  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((item) => item.name === request.params.name)
    if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] }
    const args = request.params.arguments
    return runTool(tool, typeof args === "object" && args !== null && !Array.isArray(args) ? args : {})
  })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on("close", () => {
    void transport.close()
    void mcp.close()
  })
  await mcp.connect(transport)
  await transport.handleRequest(req, res, body)
}

function authorized(header: string | undefined, token: string) {
  const prefix = "Bearer "
  if (!header?.startsWith(prefix)) return false
  const given = Buffer.from(header.slice(prefix.length))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) return undefined
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function respond(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "text/plain" }).end(message)
}
