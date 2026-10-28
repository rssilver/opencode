import { connect } from "node:net"

export type PortProbe = (port: number, host: string) => Promise<boolean>

const HOSTS = ["127.0.0.1", "::1"]

export function probePort(port: number, host: string) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ port, host })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(1000, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

/**
 * Resolves true once `port` accepts a TCP connection on any loopback address,
 * false on timeout or when `alive` reports the process is gone.
 */
export async function waitForPort(
  port: number,
  options: {
    timeoutMs: number
    intervalMs?: number
    probe?: PortProbe
    alive?: () => boolean
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  },
) {
  const probe = options.probe ?? probePort
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = now() + options.timeoutMs
  while (true) {
    if (options.alive && !options.alive()) return false
    const results = await Promise.all(HOSTS.map((host) => probe(port, host)))
    if (results.some(Boolean)) return true
    if (now() >= deadline) return false
    await sleep(options.intervalMs ?? 250)
  }
}
