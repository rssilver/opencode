import type { WebContents } from "electron"
import { getBrowserContents, requestBrowserOpen } from "../browser-panel"
import { askSignInPermission, findEntries, loadVault, passwordsAvailable, siteOrigin, withoutOffers } from "../browser-passwords"
import { openUrl, targetWindow } from "./browser-tools"
import { string, type Tool, type ToolResult, ToolError } from "./tool"

// Own isolated world: the page's scripts never see the fill code.
const FILL_WORLD = 1002
const STEP_WAIT = 10_000
const SETTLE_MS = 2_500
const MAX_STEPS = 3

type Step = "password" | "username" | "none" | "challenge"
type Outcome = "signed_in" | "failed" | "needs_user"

export const browserSignInTool: Tool = {
  name: "browser_sign_in",
  description:
    "Sign in to a site in the built-in browser panel with a login the user saved in the app's password vault. Open the site's login page first (or the tool opens the site's home page). The app fills the saved username and password into the page itself and submits, including two-step flows; you never see the values. The first time for a site the user is asked to allow it. Returns signed_in, failed (with a reason) or needs_user (2FA code, CAPTCHA or passkey: ask the user to finish in the panel).",
  inputSchema: {
    type: "object",
    properties: { site: { type: "string", description: "Site to sign in to, e.g. github.com or https://github.com." } },
    required: ["site"],
  },
  run: async (args) => {
    const origin = siteOrigin(string(args, "site"))
    if (!origin) throw new ToolError("site must be an http(s) site such as github.com.")
    const host = new URL(origin).host
    if (!passwordsAvailable()) return result("failed", "encrypted password storage is not available on this system.")
    const entry = findEntries(loadVault(), origin)[0]
    if (!entry)
      return result(
        "failed",
        `no saved password for ${origin}. Ask the user to sign in once in the browser panel and choose Save.`,
      )

    const win = targetWindow()
    requestBrowserOpen(win)
    const answer = await askSignInPermission(win, origin)
    if (answer === "no") return result("failed", `the user did not allow signing in to ${host}.`)

    // Exact-origin match only: a look-alike page in the tab never receives the values.
    if (siteOrigin(getBrowserContents(win)?.contents.getURL() ?? "") !== origin) await openUrl(origin, false)
    const tab = getBrowserContents(win)
    if (!tab || siteOrigin(tab.contents.getURL()) !== origin)
      return result("failed", `the tab did not end up on ${origin}.`)

    const outcome = await withoutOffers(tab.contents, () => signIn(tab.contents, origin, entry))
    return result(outcome.status, outcome.reason)
  },
}

async function signIn(
  wc: WebContents,
  origin: string,
  entry: { username: string; password: string },
): Promise<{ status: Outcome; reason: string }> {
  const steps = await Array.from({ length: MAX_STEPS }).reduce<Promise<Step | "done">>(async (previous) => {
    const last = await previous
    if (last === "done" || last === "challenge" || last === "none") return last
    if (siteOrigin(wc.getURL()) !== origin) return "done"
    await waitForField(wc)
    if (siteOrigin(wc.getURL()) !== origin) return "done"
    const step = await run<Step>(wc, fillScript(entry.username, entry.password))
    if (step === "password") return settle(wc).then(() => "done" as const)
    if (step === "username") await settle(wc)
    return step ?? "none"
  }, Promise.resolve("username"))

  if (steps === "none") return { status: "failed", reason: "no login form was found on the page." }
  if (steps === "username") return { status: "failed", reason: "the password field never appeared." }
  const check = await run<"ok" | "challenge" | "still_form">(wc, checkScript)
  if (steps === "challenge" || check === "challenge")
    return { status: "needs_user", reason: "the site asks for a verification step (2FA code, CAPTCHA or passkey)." }
  if (check === "still_form" && siteOrigin(wc.getURL()) === origin)
    return { status: "failed", reason: "the login form is still shown; the saved password may be wrong." }
  return { status: "signed_in", reason: `now at ${wc.getURL()}` }
}

async function run<T>(wc: WebContents, code: string) {
  if (wc.isDestroyed()) return undefined
  return (await wc.executeJavaScriptInIsolatedWorld(FILL_WORLD, [{ code }]).catch(() => undefined)) as T | undefined
}

/** Waits until a username or password field is visible, or the timeout passes. */
async function waitForField(wc: WebContents) {
  const deadline = Date.now() + STEP_WAIT
  while (Date.now() < deadline && !wc.isDestroyed()) {
    if (!wc.isLoading() && (await run<boolean>(wc, fieldScript))) return
    await sleep(250)
  }
}

async function settle(wc: WebContents) {
  await sleep(SETTLE_MS)
  const deadline = Date.now() + STEP_WAIT
  while (Date.now() < deadline && !wc.isDestroyed() && wc.isLoading()) await sleep(250)
}

function result(status: Outcome, reason: string): ToolResult {
  return { content: [{ type: "text", text: `${status}: ${reason}` }], isError: status === "failed" ? true : undefined }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const helpers = `
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.disabled
  const passwordField = () => [...document.querySelectorAll('input[type="password"]')].find((el) => shown(el) && !/new-password/.test(el.autocomplete))
  const userField = () => {
    const inputs = [...document.querySelectorAll('input')].filter((el) => ['text', 'email', 'tel', ''].includes(el.type) && shown(el) && !el.readOnly)
    return inputs.find((el) => /username|email/.test(el.autocomplete)) ??
      inputs.find((el) => el.type === 'email' || /user|email|login|account|identifier/i.test(el.name + ' ' + el.id))
  }
  const challenge = () =>
    !!document.querySelector('input[autocomplete="one-time-code"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha') ||
    /two-factor|2-step|verification code|authenticator app|security key|passkey|captcha|verify (it'?s|that it'?s) you/i.test(document.body ? document.body.innerText.slice(0, 5000) : '')
`

const fieldScript = `(() => {${helpers}
  return !!(passwordField() || userField())
})()`

const checkScript = `(() => {${helpers}
  if (challenge()) return 'challenge'
  // A login page still showing a username or password field means the sign-in did not go through.
  return passwordField() || (userField() && document.querySelector('input[type="password"]')) ? 'still_form' : 'ok'
})()`

/** Fills what the current step shows and submits it. The values are only ever inside this script. */
function fillScript(username: string, password: string) {
  return `(() => {${helpers}
  const set = (el, value) => {
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const submit = (field, step) => {
    const scope = field.form ?? document
    const buttons = [...scope.querySelectorAll('button, input[type="submit"], [role="button"]')].filter(shown)
    const named = (re) => buttons.find((el) => re.test(el.innerText || el.value || el.getAttribute('aria-label') || ''))
    const button = (step === 'username' ? named(/next|continue/i) : undefined) ??
      buttons.find((el) => el.type === 'submit') ?? named(/sign in|log ?in|next|continue|submit/i)
    if (button) return button.click()
    if (field.form && typeof field.form.requestSubmit === 'function') return field.form.requestSubmit()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
  }
  if (challenge()) return 'challenge'
  const pw = passwordField()
  const user = userField()
  if (user && ${JSON.stringify(username)} && (!pw || !user.value)) set(user, ${JSON.stringify(username)})
  if (pw) {
    set(pw, ${JSON.stringify(password)})
    submit(pw, 'password')
    return 'password'
  }
  if (!user) return 'none'
  submit(user, 'username')
  return 'username'
})()`
}
