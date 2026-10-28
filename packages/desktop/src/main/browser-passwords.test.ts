import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createVault,
  emptyVault,
  findEntries,
  offerKind,
  parseChromeCsv,
  removeEntry,
  siteOrigin,
  upsertEntry,
} from "./browser-passwords"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// Reversible stand-in for safeStorage so the file can be checked for plain text.
const cipher = {
  encrypt: (text: string) => Buffer.from(Buffer.from(text).map((byte) => byte ^ 0x5a)),
  decrypt: (data: Buffer) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString(),
}

describe("siteOrigin", () => {
  test("normalizes hosts and URLs to exact origins", () => {
    expect(siteOrigin("github.com")).toBe("https://github.com")
    expect(siteOrigin("https://github.com/login?x=1")).toBe("https://github.com")
    expect(siteOrigin("http://localhost:3000/a")).toBe("http://localhost:3000")
  })
  test("rejects non-web schemes and empty input", () => {
    expect(siteOrigin("")).toBeUndefined()
    expect(siteOrigin("file:///etc/passwd")).toBeUndefined()
    expect(siteOrigin("javascript://alert(1)")).toBeUndefined()
  })
})

describe("matching", () => {
  const data = upsertEntry(emptyVault(), { origin: "https://github.com", username: "me", password: "pw" }, 1).data
  test("matches only the exact origin", () => {
    expect(findEntries(data, "https://github.com")).toHaveLength(1)
    expect(findEntries(data, "https://github.com.evil.test")).toHaveLength(0)
    expect(findEntries(data, "https://gist.github.com")).toHaveLength(0)
    expect(findEntries(data, "http://github.com")).toHaveLength(0)
  })
  test("offers save, update or nothing", () => {
    expect(offerKind(data, "https://github.com", "me", "pw")).toBeUndefined()
    expect(offerKind(data, "https://github.com", "me", "new")).toBe("update")
    expect(offerKind(data, "https://github.com", "other", "pw")).toBe("save")
    expect(offerKind({ ...data, never: ["https://example.test"] }, "https://example.test", "a", "b")).toBeUndefined()
    expect(offerKind(data, "https://example.test", "a", "")).toBeUndefined()
  })
})

describe("upsertEntry", () => {
  test("adds, updates and renames while keeping created time", () => {
    const added = upsertEntry(emptyVault(), { origin: "https://a.test", username: "u", password: "1" }, 10)
    expect(added.change).toBe("added")
    const same = upsertEntry(added.data, { origin: "https://a.test", username: "u", password: "1" }, 20)
    expect(same.change).toBe("unchanged")
    expect(same.data.entries[0].updated).toBe(10)
    const changed = upsertEntry(same.data, { origin: "https://a.test", username: "u", password: "2" }, 30)
    expect(changed.change).toBe("updated")
    expect(changed.data.entries).toEqual([{ origin: "https://a.test", username: "u", password: "2", created: 10, updated: 30 }])
    const renamed = upsertEntry(changed.data, { origin: "https://a.test", username: "v", password: "2", previous: "u" }, 40)
    expect(renamed.data.entries.map((entry) => entry.username)).toEqual(["v"])
    expect(removeEntry(renamed.data, "https://a.test", "v").entries).toEqual([])
  })
})

describe("parseChromeCsv", () => {
  test("reads Chrome's export with quoting and skips bad rows", () => {
    const csv =
      '﻿name,url,username,password,note\r\n' +
      'github.com,https://github.com/login,me,"p,w""1",\r\n' +
      "bad,notaurl ::,x,y,\n" +
      "empty,https://e.test,x,,\n" +
      "local,http://localhost:8080/,,secret,\n"
    expect(parseChromeCsv(csv)).toEqual([
      { origin: "https://github.com", username: "me", password: 'p,w"1' },
      { origin: "http://localhost:8080", username: "", password: "secret" },
    ])
  })
  test("returns nothing without the expected columns", () => {
    expect(parseChromeCsv("a,b\n1,2")).toEqual([])
  })
})

describe("createVault", () => {
  test("round-trips through the cipher and never writes plain text", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-passwords-"))
    roots.push(root)
    const file = join(root, "vault.bin")
    const vault = createVault(file, cipher)
    expect(vault.load()).toEqual(emptyVault())
    const data = {
      ...upsertEntry(emptyVault(), { origin: "https://a.test", username: "user", password: "hunter2-test" }, 1).data,
      grants: ["https://a.test"],
    }
    vault.save(data)
    expect((await readFile(file)).toString()).not.toContain("hunter2-test")
    expect(createVault(file, cipher).load()).toEqual(data)
  })
  test("treats undecryptable data as an empty vault", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-passwords-"))
    roots.push(root)
    const file = join(root, "vault.bin")
    createVault(file, cipher).save(emptyVault())
    const broken = createVault(file, {
      encrypt: cipher.encrypt,
      decrypt: () => {
        throw new Error("no key")
      },
    })
    expect(broken.load()).toEqual(emptyVault())
  })
})
