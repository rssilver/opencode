// Preload for browser panel tabs (sandboxed, isolated from the page). It only reports login
// submits to the main process so it can offer "Save password?". It exposes nothing to the page.
// IPC is used rather than console output because renderer console messages go to the log files.
import { ipcRenderer } from "electron"

const shown = (el: HTMLElement) => el.getClientRects().length > 0
const isUserField = (el: HTMLInputElement) =>
  /username|email/.test(el.autocomplete) || el.type === "email" || /user|email|login/i.test(`${el.name} ${el.id}`)

function report(scope: ParentNode) {
  const password = [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    .filter((el) => el.value && shown(el))
    .pop()
  const users = [...scope.querySelectorAll("input")].filter(
    (el) =>
      ["text", "email", "tel", ""].includes(el.type) &&
      el.value &&
      shown(el) &&
      (!password || el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING),
  )
  const user = users.find((el) => /username|email/.test(el.autocomplete)) ?? users.pop()
  // A username-only step (two-step sign-in) is reported so the password step can be paired with it.
  if (!password && !(user && isUserField(user))) return
  // Synchronous so the report is delivered before the submit navigates the page away.
  ipcRenderer.sendSync("browser-login-submit", { username: user?.value ?? "", password: password?.value ?? "" })
}

window.addEventListener("submit", (event) => report(event.target instanceof HTMLFormElement ? event.target : document), true)
window.addEventListener(
  "click",
  (event) => {
    const button = event.target instanceof Element ? event.target.closest("button, input[type=submit], [role=button]") : null
    if (!button) return
    // Submit buttons are covered by the submit event; "Next" buttons in two-step forms are not.
    const form = button.closest("form")
    if (!form) return report(document)
    if ((button as HTMLButtonElement).type !== "submit") report(form)
  },
  true,
)
window.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && !event.target.form) report(document)
  },
  true,
)
