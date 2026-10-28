import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import electron from "electron"
import type { BrowserWindow, WebContents } from "electron"
import type { BrowserPasswordState, BrowserSignInAnswer } from "@opencode-ai/app/browser"

export type PasswordEntry = { origin: string; username: string; password: string; created: number; updated: number }

/** Everything the vault persists. `never` = origins the user opted out of saving; `grants` = agent sign-in allowed. */
export type VaultData = { entries: PasswordEntry[]; never: string[]; grants: string[] }

export type Cipher = { encrypt(text: string): Buffer; decrypt(data: Buffer): string }

const FILE = "opencode.browser-passwords.bin"
const PENDING_USERNAME_MS = 5 * 60_000
const SIGN_IN_PROMPT_MS = 2 * 60_000

export const emptyVault = (): VaultData => ({ entries: [], never: [], grants: [] })

/** Normalizes a site to its exact origin. Bare hosts become https. Only http(s) is accepted. */
export function siteOrigin(input: string) {
  const value = input.trim()
  if (!value) return undefined
  const parsed = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`)
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.hostname) return undefined
  return parsed.origin
}

/** Entries for exactly `origin`; a look-alike or a subdomain never matches. */
export function findEntries(data: VaultData, origin: string) {
  return data.entries.filter((entry) => entry.origin === origin)
}

/** Adds or replaces the entry for (origin, username). `previous` renames an existing username. */
export function upsertEntry(
  data: VaultData,
  input: { origin: string; username: string; password: string; previous?: string },
  now = Date.now(),
) {
  const key = input.previous ?? input.username
  const existing = data.entries.find((entry) => entry.origin === input.origin && entry.username === key)
  const change: "added" | "updated" | "unchanged" = !existing
    ? "added"
    : existing.password === input.password && existing.username === input.username
      ? "unchanged"
      : "updated"
  const others = data.entries.filter(
    (entry) => entry !== existing && !(entry.origin === input.origin && entry.username === input.username),
  )
  const entry = {
    origin: input.origin,
    username: input.username,
    password: input.password,
    created: existing?.created ?? now,
    updated: change === "unchanged" ? existing!.updated : now,
  }
  return { data: { ...data, entries: [...others, entry] }, change }
}

export function removeEntry(data: VaultData, origin: string, username: string) {
  return { ...data, entries: data.entries.filter((entry) => !(entry.origin === origin && entry.username === username)) }
}

/** What a submitted login means for the vault: nothing to do, a new entry, or a changed password. */
export function offerKind(data: VaultData, origin: string, username: string, password: string) {
  if (!password || data.never.includes(origin)) return undefined
  const existing = findEntries(data, origin).find((entry) => entry.username === username)
  if (!existing) return "save" as const
  return existing.password === password ? undefined : ("update" as const)
}

/** Parses Chrome's password export (`name,url,username,password`, optionally `note`). */
export function parseChromeCsv(text: string) {
  const rows = parseCsv(text)
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? []
  const col = (name: string) => header.indexOf(name)
  const [url, username, password] = [col("url"), col("username"), col("password")]
  if (url < 0 || username < 0 || password < 0) return []
  return rows.slice(1).flatMap((row) => {
    const origin = siteOrigin(row[url] ?? "")
    if (!origin || !row[password]) return []
    return [{ origin, username: row[username] ?? "", password: row[password] }]
  })
}

function parseCsv(text: string) {
  const rows: string[][] = []
  const state = { row: [] as string[], cell: "", quoted: false }
  const chars = text.replace(/^﻿/, "")
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (state.quoted) {
      if (ch === '"' && chars[i + 1] === '"') {
        state.cell += '"'
        i++
      } else if (ch === '"') state.quoted = false
      else state.cell += ch
      continue
    }
    if (ch === '"') state.quoted = true
    else if (ch === ",") {
      state.row.push(state.cell)
      state.cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && chars[i + 1] === "\n") i++
      state.row.push(state.cell)
      if (state.row.some((cell) => cell !== "")) rows.push(state.row)
      state.row = []
      state.cell = ""
    } else state.cell += ch
  }
  state.row.push(state.cell)
  if (state.row.some((cell) => cell !== "")) rows.push(state.row)
  return rows
}

/** Reads and writes the vault as one encrypted file. Unreadable data yields an empty vault. */
export function createVault(file: string, cipher: Cipher) {
  return {
    load(): VaultData {
      if (!existsSync(file)) return emptyVault()
      try {
        const parsed = JSON.parse(cipher.decrypt(readFileSync(file))) as Partial<VaultData>
        return {
          entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : [],
          never: Array.isArray(parsed.never) ? parsed.never.filter((item) => typeof item === "string") : [],
          grants: Array.isArray(parsed.grants) ? parsed.grants.filter((item) => typeof item === "string") : [],
        }
      } catch {
        return emptyVault()
      }
    },
    save(data: VaultData) {
      // Write then rename so a crash never leaves a half-written vault.
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(`${file}.tmp`, cipher.encrypt(JSON.stringify(data)))
      renameSync(`${file}.tmp`, file)
    },
  }
}

function isEntry(value: unknown): value is PasswordEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.origin === "string" &&
    typeof entry.username === "string" &&
    typeof entry.password === "string" &&
    typeof entry.created === "number" &&
    typeof entry.updated === "number"
  )
}

// ---- Electron side: the app's single vault, login detection, save offers and sign-in prompts ----

export function passwordsAvailable() {
  return electron.safeStorage.isEncryptionAvailable()
}

function vault() {
  if (!passwordsAvailable()) throw new Error("Encrypted storage is not available on this system.")
  return createVault(join(electron.app.getPath("userData"), FILE), {
    encrypt: (text) => electron.safeStorage.encryptString(text),
    decrypt: (data) => electron.safeStorage.decryptString(data),
  })
}

export function loadVault() {
  return passwordsAvailable() ? vault().load() : emptyVault()
}

export function updateVault(change: (data: VaultData) => VaultData) {
  const store = vault()
  const next = change(store.load())
  store.save(next)
  return next
}

/** What the renderer may see: never a password. */
export function passwordState(data = loadVault()): BrowserPasswordState {
  return {
    available: passwordsAvailable(),
    entries: data.entries
      .map((entry) => ({ origin: entry.origin, username: entry.username, created: entry.created, updated: entry.updated }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)),
    never: [...data.never].sort(),
    grants: [...data.grants].sort(),
  }
}

type Offer = { origin: string; username: string; password: string }
const offers = new Map<string, Offer>()
const pendingUsernames = new Map<number, { origin: string; username: string; at: number }>()
const suppressed = new Set<number>()

/**
 * Listens for login submits reported by the tab's preload (`preload/browser-login.ts`); a submit
 * with a password becomes a save offer. Only the main frame counts, and the origin comes from the
 * frame itself, never from the page.
 */
export function watchLogins(win: BrowserWindow, tabId: string, wc: WebContents) {
  wc.ipc.on("browser-login-submit", (event, value: unknown) => {
    event.returnValue = null
    if (suppressed.has(wc.id) || !passwordsAvailable() || event.senderFrame !== wc.mainFrame) return
    const origin = siteOrigin(event.senderFrame?.url ?? "")
    const report = parseReport(value)
    if (!origin || !report) return
    offerFor(win, tabId, wc.id, { origin, ...report })
  })
  wc.once("destroyed", () => pendingUsernames.delete(wc.id))
}

function offerFor(win: BrowserWindow, tabId: string, wcId: number, report: Offer) {
  // Two-step sign-ins submit the username first; remember it for the password step.
  if (!report.password) {
    if (report.username) pendingUsernames.set(wcId, { origin: report.origin, username: report.username, at: Date.now() })
    return
  }
  const pending = pendingUsernames.get(wcId)
  const username =
    report.username ||
    (pending && pending.origin === report.origin && Date.now() - pending.at < PENDING_USERNAME_MS ? pending.username : "")
  pendingUsernames.delete(wcId)
  const kind = offerKind(loadVault(), report.origin, username, report.password)
  if (!kind || win.isDestroyed()) return
  const id = randomUUID()
  offers.clear()
  offers.set(id, { origin: report.origin, username, password: report.password })
  win.webContents.send("browser-password-offer", { id, tabId, host: new URL(report.origin).host, username, kind })
}

export function respondToOffer(id: string, action: "save" | "never" | "dismiss") {
  const offer = offers.get(id)
  offers.delete(id)
  if (!offer || action === "dismiss") return passwordState()
  if (action === "never")
    return passwordState(updateVault((data) => ({ ...data, never: [...new Set([...data.never, offer.origin])] })))
  return passwordState(updateVault((data) => upsertEntry(data, offer).data))
}

/** Stops save offers for a tab while the agent fills a saved login into it. */
export async function withoutOffers<T>(wc: WebContents, run: () => Promise<T>) {
  suppressed.add(wc.id)
  try {
    return await run()
  } finally {
    suppressed.delete(wc.id)
  }
}

const signInPrompts = new Map<string, (answer: BrowserSignInAnswer) => void>()

/** Asks the user in the app whether the agent may sign in to `origin`. "always" is remembered. */
export function askSignInPermission(win: BrowserWindow, origin: string) {
  if (loadVault().grants.includes(origin)) return Promise.resolve<BrowserSignInAnswer>("always")
  return new Promise<BrowserSignInAnswer>((resolve) => {
    const id = randomUUID()
    const timer = setTimeout(() => finish("no"), SIGN_IN_PROMPT_MS)
    const finish = (answer: BrowserSignInAnswer) => {
      clearTimeout(timer)
      signInPrompts.delete(id)
      if (answer === "always") updateVault((data) => ({ ...data, grants: [...new Set([...data.grants, origin])] }))
      resolve(answer)
    }
    signInPrompts.set(id, finish)
    if (win.isDestroyed()) return finish("no")
    win.webContents.send("browser-sign-in-request", { id, host: new URL(origin).host })
  })
}

export function respondToSignIn(id: string, answer: BrowserSignInAnswer) {
  signInPrompts.get(id)?.(answer === "always" || answer === "once" ? answer : "no")
}

function parseReport(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const report = value as Record<string, unknown>
  if (typeof report.username !== "string" || typeof report.password !== "string") return undefined
  return { username: report.username, password: report.password }
}
