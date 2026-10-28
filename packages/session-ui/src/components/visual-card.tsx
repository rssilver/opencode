import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useData } from "../context"

const CDN = ["https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"].join(" ")
const MIN_HEIGHT = 120
const MAX_HEIGHT = 640
const MAX_ERRORS = 5

// Theme tokens handed to the visual as plain CSS variables (name in the visual -> app variable, fallback).
const THEME = [
  ["--background", "--v2-background-bg-layer-02", "#ffffff"],
  ["--surface", "--v2-background-bg-layer-01", "#f4f4f4"],
  ["--text", "--v2-text-text-base", "#1a1a1a"],
  ["--text-weak", "--v2-text-text-muted", "#6f6f6f"],
  ["--border", "--v2-border-border-base", "rgba(0,0,0,0.16)"],
  ["--accent", "--v2-text-text-accent", "#034cff"],
  ["--success", "--v2-state-fg-success", "#12a150"],
  ["--warning", "--v2-state-fg-warning", "#c27c0e"],
  ["--danger", "--v2-state-fg-danger", "#d92d20"],
  ["--font-sans", "--font-family-sans", "system-ui, sans-serif"],
  ["--font-mono", "--font-family-mono", "ui-monospace, monospace"],
] as const

// Interactive HTML from the show_visual tool, rendered in a sandboxed iframe (scripts only, no
// same-origin) with a CSP that allows the CDN allow-list and nothing else on the network.
export function VisualCard(props: { part: ToolPart }) {
  const data = useData()
  const i18n = useI18n()
  const title = () => String(props.part.state.input.title ?? "Visual")
  // The tool returns the final page in metadata (a saved template plus its data); older parts only have input.html.
  const html = () => {
    const metadata = props.part.state.status === "completed" ? props.part.state.metadata : undefined
    return typeof metadata?.html === "string" ? metadata.html : String(props.part.state.input.html ?? "")
  }
  const saved = () => {
    const metadata = props.part.state.status === "completed" ? props.part.state.metadata : undefined
    return typeof metadata?.path === "string" ? metadata.path : ""
  }
  const [height, setHeight] = createSignal(MIN_HEIGHT * 2)
  const [manual, setManual] = createSignal(false)
  const [reloads, setReloads] = createSignal(0)
  const [source, setSource] = createSignal(false)
  const [errors, setErrors] = createSignal<string[]>([])
  const [reported, setReported] = createSignal(false)
  const [theme, setTheme] = createSignal("")
  let card: HTMLDivElement | undefined
  let frame: HTMLIFrameElement | undefined
  let box: HTMLDivElement | undefined

  const doc = createMemo(() => (theme() ? buildDocument(html(), theme(), reloads()) : ""))

  const onMessage = (event: MessageEvent) => {
    if (!frame || event.source !== frame.contentWindow) return
    const message = event.data as { type?: string; height?: number; message?: string } | undefined
    if (message?.type === "height" && typeof message.height === "number" && !manual())
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(message.height))))
    if (message?.type === "error" && typeof message.message === "string") {
      const text = message.message
      setErrors((list) => (list.includes(text) || list.length >= MAX_ERRORS ? list : [...list, text]))
    }
  }

  onMount(() => {
    setTheme(readTheme(card))
    window.addEventListener("message", onMessage)
    // The browser's resize handle changes the box height directly; stop auto-sizing once the user drags it.
    const observer = new ResizeObserver(() => {
      if (!box || document.fullscreenElement === box) return
      if (Math.abs(box.offsetHeight - height()) <= 2) return
      setManual(true)
      setHeight(box.offsetHeight)
    })
    if (box) observer.observe(box)
    onCleanup(() => {
      window.removeEventListener("message", onMessage)
      observer.disconnect()
    })
  })

  const reload = () => {
    setErrors([])
    setReported(false)
    setTheme(readTheme(card))
    setReloads((count) => count + 1)
  }

  const save = () => {
    const url = URL.createObjectURL(new Blob([html()], { type: "text/html" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `${slugify(title())}.html`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const report = () => {
    setReported(true)
    data
      .sendReply?.(
        `The visual "${title()}" threw these errors in the sandbox:\n${errors()
          .map((error) => `- ${error}`)
          .join("\n")}\nPlease fix it and show it again.`,
      )
      .catch(() => setReported(false))
  }

  return (
    <div data-component="visual-card" ref={card}>
      <div data-slot="visual-header">
        <span data-slot="visual-title">{title()}</span>
        <div data-slot="visual-actions">
          <ButtonV2 size="small" variant="ghost" onClick={() => box?.requestFullscreen?.()}>
            {i18n.t("ui.visual.fullscreen")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={reload}>
            {i18n.t("ui.visual.reload")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={() => setSource((value) => !value)}>
            {source() ? i18n.t("ui.visual.hideSource") : i18n.t("ui.visual.source")}
          </ButtonV2>
          <ButtonV2 size="small" variant="ghost" onClick={save} title={saved() || undefined}>
            {i18n.t("ui.visual.save")}
          </ButtonV2>
        </div>
      </div>
      <div
        data-slot="visual-frame"
        ref={box}
        style={{ height: `${height()}px`, "max-height": manual() ? undefined : `${MAX_HEIGHT}px` }}
      >
        <Show when={doc()}>
          <iframe
            ref={frame}
            title={title()}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcdoc={doc()}
          />
        </Show>
      </div>
      <Show when={errors().length > 0}>
        <div data-slot="visual-errors" role="alert">
          <For each={errors()}>{(error) => <div data-slot="visual-error">{error}</div>}</For>
          <Show when={data.sendReply}>
            <div>
              <ButtonV2 size="small" variant="outline" disabled={reported()} onClick={report}>
                {i18n.t("ui.visual.askFix")}
              </ButtonV2>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={source()}>
        <pre data-slot="visual-source">{html()}</pre>
      </Show>
    </div>
  )
}

function readTheme(element: HTMLElement | undefined) {
  const style = getComputedStyle(element ?? document.documentElement)
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches
  const scheme = document.documentElement.dataset.colorScheme ?? (dark ? "dark" : "light")
  const vars = THEME.map(
    (entry) => `${entry[0]}:${style.getPropertyValue(entry[1]).trim() || entry[2]};`,
  ).join("")
  return `:root{${vars}color-scheme:${scheme === "dark" ? "dark" : "light"};}html,body{margin:0;background:transparent;color:var(--text);font-family:var(--font-sans);font-size:13px;}body{padding:12px;}`
}

function buildDocument(html: string, theme: string, reloads: number) {
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' blob: ${CDN}`,
    `style-src 'unsafe-inline' ${CDN}`,
    `img-src data: blob: ${CDN}`,
    `font-src data: ${CDN}`,
    "media-src data: blob:",
    "worker-src blob:",
    "connect-src 'none'",
    "form-action 'none'",
  ].join("; ")
  const head = [
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1"><!-- ${reloads} -->`,
    `<style>${theme}</style>`,
    `<script>${BRIDGE}</script>`,
  ].join("")
  // Inject right after <head> (or <html>) so the CSP applies before any of the model's markup.
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => match + head)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${head}</head>`)
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`
}

// Runs inside the iframe: reports content height and uncaught errors to the parent card.
const BRIDGE = `(function(){
function post(m){try{parent.postMessage(m,"*")}catch(e){}}
addEventListener("error",function(e){post({type:"error",message:String(e.message||"Error")+(e.lineno?" (line "+e.lineno+")":"")})});
addEventListener("unhandledrejection",function(e){var r=e.reason;post({type:"error",message:"Unhandled rejection: "+String(r&&r.message||r)})});
document.addEventListener("securitypolicyviolation",function(e){post({type:"error",message:"Blocked by the sandbox: "+(e.blockedURI||e.violatedDirective)})});
function size(){var b=document.body;if(!b)return;var s=getComputedStyle(b);post({type:"height",height:b.getBoundingClientRect().height+parseFloat(s.marginTop)+parseFloat(s.marginBottom)})}
function start(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.body)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
addEventListener("load",size);
})();`

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "visual"
  )
}
