
## Backburner (planned, not started)

### 4. Rich previews inside the chat
Show running apps and media inline in the timeline so they can be tested without leaving the chat.
- **HTML/CSS snippets:** a "preview" block for an `html` code fence or a written `.html` file, rendered in a
  sandboxed iframe (`sandbox="allow-scripts"`, no same-origin, `srcdoc`, strict CSP, no network unless the
  user opts in). Toggle between code and preview; resizable height. Works in web and desktop.
- **Live pages:** a preview card for a dev-server URL (from `preview_start` / the browser tools) that shows an
  auto-refreshing screenshot, with "open in browser panel" to interact. A truly interactive inline page is
  only possible in desktop (a `WebContentsView` positioned over the card, like the browser panel), which
  also inherits the panel's problems: views paint over dialogs and need hiding while scrolling. Start with
  screenshots; move to embedded views if it proves worth it.
- **Video:** short recordings of a page (desktop: `webContents` capture frames → WebM via `MediaRecorder` on
  a `capturePage` stream, or Electron's `desktopCapturer` for a window) attached to a tool result and played
  inline with a `<video>` element. Also lets the model "watch" by sampling frames into images for
  `view_images`-style analysis (most local vision models can't take video directly).
- Pieces already in place: the browser tools, chat screenshots (tool-part image thumbnails), `view_images`.

### 5. Screenshot + bug catcher (annotate and send)
Capture the app (or a frame of a recording), draw on it, and send it to the model as a bug report.
- **Capture:** buttons on the browser panel ("capture page") and the prompt bar ("capture app window"), plus
  pick-from-recording later. Desktop uses `webContents.capturePage`; web falls back to paste/upload.
- **Annotate:** a canvas editor dialog with red pen (freehand), rectangle/circle, arrow, text label, undo,
  and crop. Export a flattened PNG and keep the shape data.
- **Send:** attach the annotated PNG to the prompt plus a short auto-generated note: page URL, viewport size,
  timestamp, and the marked regions as boxes in page coordinates (so the model can match them to
  `browser_read` elements). Optionally include console errors and failed network requests captured by the
  browser panel at that moment.
- **Model side:** a vision model reads it directly; a text-only model goes through `vision.model` like
  `view_images`. Follow-up: the agent can re-screenshot the same area after a fix to confirm.
- Effort: medium (editor UI is most of it). Video annotation (draw on a paused frame) comes after video capture.

### 6. Native desktop apps (.exe) in a panel
Run a Windows program and see/use it inside the app, like the browser panel.
- **Real embedding** (reparent the program's window into ours with Win32 `SetParent`) is possible but fragile:
  focus, DPI scaling, input, menus and popups misbehave, many apps (UWP, Chromium/Electron, GPU-heavy) refuse
  or render wrong, and it's Windows-only. Not recommended as the main path.
- **Recommended: mirror + forward input.** Launch the .exe as a child process, capture just its window with
  Windows Graphics Capture (Electron `desktopCapturer` with the window's source id) and show the stream as a
  video in a panel; translate clicks/keys on the panel into input for that window (a small native helper or
  a library like `@nut-tree/nut-js` using `SendInput`, after bringing the window to front). The app itself
  stays a normal window, so nothing breaks; the panel is a live view with control.
- Same panel gives the agent eyes (frame → screenshot → vision) and, with #7, hands.
- Lifecycle like dev-server previews: start/stop/logs from a per-project config entry (`type: "exe"`),
  kill the process tree on stop or app quit.

### 7. Screen control for the model ("computer use")
Tools that let the model see and operate the desktop: `screen_screenshot` (whole screen, a monitor, or one
window), `screen_click(x, y, button)`, `screen_type(text)`, `screen_key(combo)`, `screen_scroll`,
`window_list` / `window_focus`.
- **Scope first:** default to one chosen window (e.g. the #6 panel's program); full-screen control is an
  explicit opt-in per session. Coordinates are relative to the captured image, scaled back for DPI.
- **Safety:** every session starts with control off; the user grants it (once or per action), a visible
  overlay/border shows when the model is in control, a global hotkey (e.g. Ctrl+Alt+Esc) and the app's stop
  button revoke it instantly, typing into password fields is blocked when detectable, and every action is
  logged in the timeline with its screenshot. Only the local desktop backend gets these tools (same MCP
  bridge as the browser tools, never remote servers).
- **Model loop:** screenshot → model picks an action → act → new screenshot; works best with vision models;
  text-only models go through `vision.model`.
- Effort: medium–high (native input helper, permission UI, overlay); Windows first, macOS needs
  Accessibility + Screen Recording permissions.

### 8. Interactive "next step" cards at the end of a turn
The small card some AI coding apps show when a turn ends: a 2–3 sentence recap of what changed and what is
not done or verified, then at most one question with 1–2 reply buttons (e.g. "Closed it" / "Test later").
Clicking a button sends its canned reply as the user's next message; the user can always type instead.
- **Model side:** a `wrap_up` tool (recap, optional question, up to 2 actions `{label, message}`) the model
  calls once at the end of a turn, plus a short system-prompt rule for when to call it (after multi-step
  work; skip for plain answers). opencode's existing `question` tool covers "ask and wait"; this is the
  lighter end-of-turn version.
- **App side:** render the tool part as a card pinned under the last answer (not inside the "Worked for"
  group), with the recap text, the question and buttons; disable the buttons once one is used or the user
  types something else; the recap doubles as the session's status line in the sidebar.
- **Extras later:** buttons that trigger app actions instead of text (commit, open PR, open browser panel,
  rebuild), and a pinned task list that the model updates while it works (the checklist these apps show
  above the card).

### 9. Session info side panel
A collapsible right-hand panel of cards showing what the session is working with and what is running:
- **Environment:** where it runs (this computer / WSL / remote server), project name + path, git branch.
- **Context:** the context meter from the header, expanded (tokens, summary trigger, TTFT trend).
- **Outputs:** files the agent created or that matter for review (e.g. docs/reports it wrote), click to open.
- **Changes:** lines added/removed vs. the base branch (the app already has review/diff data) with a
  "Create PR" / "Commit" action when a git remote exists.
- **Servers:** dev-server previews started via `preview_start` (name, URL, running dot; click opens in the
  browser panel; stop button), plus the backend the app is connected to.
- **Background tasks:** long-running shell commands/subagents with elapsed time and a stop button; a
  "N finished" row that expands to the history.
- Each card collapsible and remembered per user; panel toggle in the session header; data comes from
  existing session/sync state plus the desktop tool server (previews) — no new backend storage needed.
