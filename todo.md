# Todo

Sorted by impact vs. effort: quick wins first, then large high-impact work, then items that depend on earlier ones.

| # | Item | Effort | Impact | Why here |
|---|------|--------|--------|----------|
| 1 | ~~Richer "Thinking" loader with animation~~ **done** | low | medium | seen on every turn, one component |
| 2 | ~~Add models and providers from the app~~ **done** | low–medium | high | form and config writes already exist |
| 3 | ~~Update the session title as the session progresses~~ **done** | low–medium | medium | small backend change, fixes stale titles |
| 4 | ~~Interactive "next step" cards at the end of a turn~~ **done** (extras left) | medium | high | big usability gain; reuses the `question` tool pattern |
| 5 | Browser password vault so the agent can sign in | medium | high | bookmarks done; vault + agent sign-in left |
| 6 | Sidebar rework (Devin / Claude Code style) and `@` workspace tagging | high | high | biggest UX change; do after the quick wins |
| 7 | Deep-wiki for a workspace (Devin style) | medium–high | high | faster, cheaper sessions on big repos |
| 8 | Session info side panel | medium | medium | easier once the new layout exists |
| 9 | Interactive visuals in the chat (model decides) | medium | high | simulations, graphs, calculators inline; save/open on the side |
| 10 | Open files the way a person would (viewers + native apps) | medium | medium | step 1 shares #9's preview; step 2 waits for #14 |
| 11 | Let a vision model "watch" videos (browser or local files) | medium | medium | builds on browser tools + `view_images`; feeds #15 |
| 12 | Screenshot + bug catcher (annotate and send) | medium | medium | editor UI is most of the work |
| 13 | Screen control for the model ("computer use") | medium–high | medium | native input helper + careful safety UI |
| 14 | Native desktop apps (.exe) in a panel | high | low–medium | fragile on Windows; mostly useful with #13 |
| 15 | Skill system that learns tools end-to-end (`!skill`) | very high | high | needs #11, #13 and #14 first |
| 16 | UI design refresh (modern, more colour, softer) | medium–high | high | best done together with #6 so the new layout ships in the new style |
| 17 | Model routing by task difficulty + local-model capacity planner | medium–high | high | saves cost; builds on #2's model settings |

## Quick fixes

- ~~Collapse arrows sit too far from their label~~ **done** (chevron now sits right after the label).

## Backlog

### 1. Richer "Thinking" loader with animation (done)
The row that shows while the model works is a shimmer of the word "Thinking" plus an optional
reasoning heading (`TimelineThinkingRow` in `packages/app/src/pages/session/timeline/message-timeline.tsx`).
- **More detail:** elapsed time (`Thinking · 12s`), what it is doing now (thinking / writing / running
  `bash` / reading 3 files, from the live part types), and a live output-token count when the stream reports it.
  Keep the reasoning heading as the topic.
- **Animation:** a small animated glyph before the label (cycling dots or a pulsing/rotating mark, like the
  ones Claude Code and Devin use), CSS-only, respecting `prefers-reduced-motion`.
- New i18n keys for the phase labels (en first, other locales fall back).
- Effort: low (one component + CSS, data already in the session store).

### 2. Add models and providers from the app (done)
A custom-provider dialog already exists (`dialog-custom-provider.tsx`, saved through `updateConfig`), but it
only adds OpenAI-compatible providers, can't edit or remove one afterwards, and can't add a model to a
provider that's already listed.
- **Add a model to any provider:** "Add model" in Settings → Models (e.g. a new OpenRouter model that
  models.dev doesn't list yet): id, display name, context/output limits, and capability toggles (vision,
  tools, reasoning, attachments). Saved as a `provider.<id>.models.<model>` override.
- **Discover models:** for OpenAI-compatible base URLs (Ollama, LM Studio, vLLM, llama.cpp), a "Fetch models"
  button that calls `GET {baseURL}/models` and prefills the list; tick which ones to add.
- **Edit / remove** custom providers and models; pick the SDK package (OpenAI-compatible, Anthropic,
  Google, …) from a dropdown instead of only OpenAI-compatible; "Test connection" sends a 1-token request.
- Choose where it's saved: global config (default) or this project's config.
- Effort: low–medium (form + config writes already exist). Impact: high (the most common setup snag).

### 3. Update the session title as the session progresses (done)
Titles are generated once, from the first user message, and only while the title is still the default
(`SessionPrompt.ensureTitle` in `packages/opencode/src/session/prompt.ts`). Long sessions drift away from it.
- **When:** re-run the `title` agent at natural boundaries, not every turn: e.g. after the 3rd and then
  every ~8th real user message, after a compaction/summary, or when the turn's work changes topic. At most
  once per N minutes. Runs in the background on the small model, like today.
- **Input:** current title + the last few user messages (or the compaction summary) with "keep the title
  unless the focus has clearly changed; reply with the same title if so", so it doesn't churn.
- **Never override the user:** track whether the title was set by the user (rename) or generated, e.g. a
  `title_source` flag on the session (needs a migration) or an auto-title marker; only regenerate generated ones.
- Optional setting: `autoRetitle` on/off in general settings.
- Effort: low–medium (backend trigger + flag; the app already reacts to title updates).

### 4. Interactive "next step" cards at the end of a turn (done; "Extras later" still open)
The small card some AI coding apps show when a turn ends: a 2–3 sentence recap of what changed and what is
not done or verified, then at most one question with 1–2 reply buttons (e.g. "Closed it" / "Test later").
Clicking a button sends its canned reply as the user's next message; the user can always type instead.
- **Model side:** a `wrap_up` tool (recap, optional question, up to 2 actions `{label, message}`) the model
  calls once at the end of a turn, plus a short system-prompt rule for when to call it. opencode's existing
  `question` tool covers "ask and wait"; this is the lighter end-of-turn version.
- **Only when needed (user decision):** the model calls it only when the turn leaves the user a real
  decision or next step (approve a commit, pick between two fixes, test something by hand) or after long
  multi-step work where a recap helps. Plain answers, small edits and chat get no card. No question → no
  buttons; a recap alone only after multi-step work. The tool description and system rule say this
  explicitly, and the app never adds a card on its own.
- **App side:** render the tool part as a card pinned under the last answer (not inside the "Worked for"
  group), with the recap text, the question and buttons; disable the buttons once one is used or the user
  types something else; the recap doubles as the session's status line in the sidebar.
- **Extras later:** buttons that trigger app actions instead of text (commit, open PR, open browser panel,
  rebuild), and a pinned task list that the model updates while it works (the checklist these apps show
  above the card).

### 5. Browser password vault so the agent can sign in
**Done:** bookmarks (Chrome/Edge import, star button, menu); cookies already persist in
`persist:opencode-browser`, so a site stays logged in until its session expires.
**Goal:** a password manager for the built-in browser. You log in to a site once yourself; after that the
agent can sign in again on its own (e.g. when the session expired) without asking you.
- **Saving:** when you submit a login form in the panel, offer "Save password for github.com?" (like
  Chrome). Detect forms in the panel's preload (password field + submit). Also allow adding/editing in a
  "Passwords" settings page, and optional import of a CSV you export from Chrome's password manager.
- **Storage:** encrypted with Electron `safeStorage` (Windows DPAPI, tied to your Windows account) in the
  app's userData; never in plain text, never in config files or logs.
- **Agent sign-in:** a `browser_sign_in({ site })` tool. The main process fills the saved username/password
  straight into the page's form and submits; the model only gets "signed in" / "failed" back and never sees
  the values. Matches by exact site origin so a look-alike domain can't receive them.
- **Permission:** the first time the agent signs in to a site, ask you once ("Allow the agent to sign in to
  github.com?" — always / this time / no); manage per-site permissions in the Passwords page.
- **Limits:** 2FA/passkeys/CAPTCHAs still need you; the tool stops and asks. Sites with unusual login flows
  (multi-step email → password) handled by filling each step when its field appears.
- Effort: medium. Impact: high.

### 6. Sidebar rework (Devin / Claude Code style) and `@` workspace tagging
Restructure the app shell around a session list instead of project → workspace → session drilling.
- **Left panel:** a "New session" button at the top, then the session list (recent first, grouped by
  project or by date, with running/unread dots, pin, archive, rename inline), search, and settings at the
  bottom. Projects become a filter/grouping, not a required first step.
- **`@` workspaces in the prompt:** typing `@` also offers workspaces/projects (next to files and agents,
  which the prompt already supports). On a new session the tagged workspace decides where it runs (replaces
  the picker); mid-session it adds that directory as extra readable context (via the external-directory
  permission) rather than moving the session. Default stays the last-used workspace.
- **Shape of the work:** `packages/app/src/pages/layout.tsx` (≈2.4k lines) and `layout/sidebar-*.tsx` hold the
  current structure; ship in two steps: (1) the new sidebar on existing data, (2) `@` workspace tagging.
  Check mobile/narrow layout and the desktop titlebar. Pairs naturally with #8 (right-hand info panel).
- Effort: high. Impact: high (it's the first thing every user sees).

### 7. Deep-wiki for a workspace (Devin style)
An agent explores a workspace once and writes a browsable wiki about it, which later sessions read instead of
re-exploring. Different from `AGENTS.md` (short rules, always loaded) and project memory (small facts): the
wiki is large and read on demand.
- **Where it lives:** `~/.local/share/opencode/wiki/<project-id>/` by default (next to other per-project data;
  never touches the repo), with an option to write to `.opencode/wiki/` so a team can commit and share it.
  Store the git commit it was built from.
- **Generate:** a `wiki` agent that (1) surveys the tree, manifests, entry points, build/test scripts; (2) plans
  pages: overview, architecture, one page per package/module, data flow, how-to (build, test, release),
  glossary; (3) writes each page with file:line links and Mermaid diagrams. Runs as a background task, one
  subagent per module in parallel, optionally on a cheaper model.
- **Stay fresh:** "Refresh" redoes only pages whose source files changed since the stored commit
  (`git diff --name-only`); a page shows "out of date" when its files changed.
- **Use it:** inject a short index (page titles + one-line summaries) into the system context, plus
  `wiki_read(page)` / `wiki_search(query)` tools. The model can propose wiki edits when it learns something.
- **View it:** a Wiki tab with a page tree, rendered Markdown + Mermaid, and "Ask about this page".
- Effort: medium–high. Impact: high on big repos (faster, cheaper sessions).

### 8. Session info side panel
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

### 9. Interactive visuals in the chat (model decides)
The model can answer some prompts with a live, interactive result rendered in the chat instead of only text:
e.g. "would foxes survive in a savannah, who would prey on them?" → a small predator/prey world simulation
with sliders; a maths question → the function graphed with the answer marked; "compare these loans" → a
calculator. Like the visualize widgets some AI chat apps have.
- **Tool:** `show_visual({ title, html })` — the model writes self-contained HTML/CSS/JS (canvas, SVG,
  or allowed chart/maths libraries from a CDN allow-list, e.g. Chart.js, D3, Plotly, KaTeX, three.js).
  The tool description says when to use it: simulations, graphs, diagrams, calculators, anything where
  playing with it beats reading; not for plain answers, and not when the user asked for files in their
  project. Also usable on its own for an `html` code block the model wrote.
- **Rendering:** a card in the timeline with a sandboxed iframe (`sandbox="allow-scripts"`, no same-origin,
  `srcdoc`, CSP limited to the CDN allow-list, no other network), app theme colours passed in as CSS
  variables so it matches light/dark, auto height with a max and resize handle.
- **Actions on the card:** open in the side panel (bigger, next to the chat), full screen, reload, view
  source, and "Save" → writes it as an `.html` file into a per-project visuals folder (or the project, if
  you pick) and lists it in a "Saved visuals" menu to reopen later. "Edit" sends "change the visual: …"
  back to the model with the source attached.
- **Model loop:** errors thrown inside the iframe are reported back as a tool note so the model can fix
  its own visual; optional screenshot (`view_images` path) so it can check the result.
- Effort: medium. Impact: high.
- Later (the old scope): live dev-server preview cards and inline video, see #10/#11.

### 10. Open files the way a person would (viewers + native apps)
Click a file in the file tree and see it properly, and let the agent do the same.
- **Step 1, in-app viewers (no mirroring):** extend the file tabs (`pages/session/file-tabs.tsx`) with viewers
  for images (zoom), PDF (Chromium's built-in viewer), audio/video (`<video>`), rendered Markdown/HTML
  (sandboxed, reuses #9's iframe renderer), CSV as a table, and Office docs as a converted preview
  (LibreOffice `--convert-to pdf` when installed). The agent gets `file_view(path)`, which returns a
  screenshot of that viewer through the `view_images` path.
- **Step 2, native app mirrored:** "Open in default app" launches the OS handler (Blender for `.blend`,
  Photoshop for `.psd`, …) and shows it in the mirrored app panel (#14), so you and the agent see the real
  program. Same mirror + input approach; the only new parts are launching the handler (`shell.openPath`)
  and finding its window.
- Effort: step 1 medium; step 2 low once #14 exists.

### 11. Let a vision model "watch" videos (browser or local files)
Turn a video into something a text + image model can read: a timestamped transcript plus key frames.
- **Tool:** `video_watch({ source: url | path, question?, start?, end?, maxFrames? })` returns transcript
  chunks with timestamps, frames at chosen times (as images, via the `view_images` path), and chapter titles.
  A follow-up call can zoom into a time range for denser frames ("what happens at 4:10–4:40?").
- **Finding videos:** the model searches with the web search tool or the browser panel (YouTube's search
  page), picks by title/channel/length/date, and can watch several and compare. Skill research (#15) uses this.
- **Browser videos (YouTube etc.):** play in the built-in browser panel, no downloading. Transcript from the
  page's caption track / transcript panel when present; chapters from the description. Frames by seeking the
  page's `<video>` element and screenshotting the player at each timestamp.
- **Local files:** `ffmpeg` for frames (scene-change detection with `select='gt(scene,0.3)'`, plus evenly
  spaced fallback) and embedded subtitles; with no transcript, local Whisper (whisper.cpp / faster-whisper)
  when installed, or a configured transcription model.
- **Picking frames:** scene changes + moments the transcript points at ("click here", "as you can see"),
  capped by `maxFrames` and downscaled to keep token cost down.
- Text-only models go through `vision.model` like `view_images`.
- Effort: medium. Impact: medium on its own, high as input to #15.

### 12. Screenshot + bug catcher (annotate and send)
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

### 13. Screen control for the model ("computer use")
Tools that let the model see and operate the desktop: `screen_screenshot` (whole screen, a monitor, or one
window), `screen_click(x, y, button)`, `screen_type(text)`, `screen_key(combo)`, `screen_scroll`,
`window_list` / `window_focus`.
- **Scope first:** default to one chosen window (e.g. the #14 panel's program); full-screen control is an
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

### 14. Native desktop apps (.exe) in a panel
Run a Windows program and see/use it inside the app, like the browser panel.
- **Real embedding** (reparent the program's window into ours with Win32 `SetParent`) is possible but fragile:
  focus, DPI scaling, input, menus and popups misbehave, many apps (UWP, Chromium/Electron, GPU-heavy) refuse
  or render wrong, and it's Windows-only. Not recommended as the main path.
- **Recommended: mirror + forward input.** Launch the .exe as a child process, capture just its window with
  Windows Graphics Capture (Electron `desktopCapturer` with the window's source id) and show the stream as a
  video in a panel; translate clicks/keys on the panel into input for that window (a small native helper or
  a library like `@nut-tree/nut-js` using `SendInput`, after bringing the window to front). The app itself
  stays a normal window, so nothing breaks; the panel is a live view with control.
- Same panel gives the agent eyes (frame → screenshot → vision) and, with #13, hands.
- Lifecycle like dev-server previews: start/stop/logs from a per-project config entry (`type: "exe"`),
  kill the process tree on stop or app quit.

### 15. Skill system that learns tools end-to-end (`!skill`)
Builds on opencode's existing skills (`SKILL.md` folders loaded by `packages/opencode/src/skill`, used through
the `skill` tool). Goal: one prompt like `!skill learn Blender and model this image for me` makes the agent
research, install, practise, grade itself, and save what it learned as a skill it keeps improving.
Needs #11 (video watching) and #13–14 (computer use + mirrored apps); benefits from #7 (deep-wiki) and
#4 (next-step cards for your rating).
- **Commands:** `!skill <task>` (learn if needed, then do the task), `!make-skill <topic>`,
  `!improve-skill <name> [feedback]`, parsed in the prompt like `/` commands, with autocomplete.
- **Visible progress:** a "Learning" divider in the chat plus a sidebar card with the phases and their status:
  Research → Plan → Install → Practise → Evaluate → Save → Do the task. Each phase expands to notes and
  screenshots.
- **Research:** official docs first, then tutorials and videos (#11), then forums for pitfalls. Prefer
  scriptable routes over the GUI: for Blender that's its Python API (`blender --background --python
  script.py`) or an existing Blender MCP server, which is far more reliable than clicking. Fall back to GUI
  control (#13/#14) only where there's no scripting route.
- **Install:** propose the install command (winget/choco/brew/official installer) and wait for your approval;
  record version and install path in the skill.
- **Skill format (extends `SKILL.md`):** goal + scope, setup, procedures as step lists with Mermaid
  flowcharts (rendered in the app), verified scripts in `scripts/`, pitfalls, sources, tested version, and
  an `evals/` folder of practice tasks with results and scores.
- **Self-grading:** before practising, write a rubric from the goal (e.g. "silhouette matches the reference
  image", "no non-manifold geometry", "renders without errors"); afterwards check with tools (render →
  screenshot → compare with the reference using the vision model, run validation scripts) and score each
  line. Then ask for your rating with next-step buttons (#4). Keep all three scores per attempt.
- **Improving:** after each use or `!improve-skill`, the agent proposes a diff to the skill (new pitfall,
  better script, updated flow) for your approval; history allows rollback; a score trend shows on the
  skill page.
- **Safety:** installs, downloads and GUI control always need approval; research runs on a visible
  time/token budget you can stop.
- **Skills that know about each other:**
  - **Tags + links:** each skill's front matter gets `tags` (domain: `3d`, `art`, `ui`, `game-assets`;
    technique: `colour-theory`, `scripting`, `export-pipeline`) and `related: [{ skill, why }]`. The skill
    page shows related skills; the model sees "related skills" when one is loaded, so it can pull another
    in instead of re-learning.
  - **Shared steps:** when two skills have near-identical procedures (e.g. "install via winget", "export
    PNG at 2x", "set up a Python venv"), move the step into a small shared skill and reference it from
    both, so improving it once improves every skill that uses it.
  - **Check before adding:** before `!make-skill` saves a new skill, compare it against existing ones
    (tag overlap + embedding similarity of descriptions and steps). Show the result: "overlaps 70% with
    `blender-modelling`: extend it instead?", "reuse these 3 steps from `krita-drawing`", or "new". You pick:
    merge, extend, link, or keep separate.
  - **Combining skills:** score how well skills work together for a task (shared tags, past joint use, and
    a quick model judgement), and suggest pairings: e.g. an `art-style:pastel-lineart` skill feeding a
    `ui-design` or `game-asset` skill with its palette, line weights and shading rules. Style-type skills
    export a reusable "style sheet" (palette, references, do/don't list) that other skills can consume.
  - **Skill graph view:** a page showing skills as nodes, links/shared steps as edges, coloured by tag, with
    each skill's score trend; useful for spotting duplicates and gaps.
  - **Upkeep:** a periodic "tidy skills" pass proposes merges, splits of skills that grew too broad, and
    stale links, always as diffs for your approval.
- Effort: very high (do last). Impact: high.

### 16. UI design refresh (modern, more colour, slightly femme)
The current look reads as flat: blocky icons, low-contrast grey text, little colour.
- **Icons:** move to a rounder, lighter-stroke set (e.g. Lucide/Phosphor at 1.5px stroke, rounded caps and
  joins) at consistent 16/20px sizes; replace filled square glyphs.
- **Text:** raise contrast of `text-weak`/`text-base` tokens a notch, slightly warmer greys, a friendlier
  UI font (e.g. Inter / Geist / Nunito Sans) with tighter heading weights.
- **Colour:** a soft accent palette instead of pure greys: rose/pink primary with lavender and peach
  secondaries, used for focus rings, active session, links, progress, diff highlights and the thinking
  animation. Tune separately for dark and light, check WCAG AA contrast.
- **Shape and depth:** larger radii (8–12px) on cards, inputs, buttons; subtle gradients or tinted surfaces
  for the prompt bar and active items; gentle hover/press motion; softer shadows in light mode.
- **How:** change design tokens in `packages/ui` (theme + CSS variables) first so most screens update at once,
  then fix outliers; ship as a new built-in theme first so the current one stays available, and make it the
  default once it looks right. Do a mock-up pass (screenshots of session, sidebar, settings) before coding.
- Effort: medium–high. Impact: high (first impression, everyday comfort).

### 17. Model routing by task difficulty + local-model capacity planner
Use cheaper/faster models for easy work and stronger ones for hard work, and know what local hardware can run.
- **Routing:** a "router" setting per agent: `off` (today), `suggest`, or `auto`. Before each turn a cheap
  classifier (rules first: prompt length, attached files, keywords like "explain"/"rename" vs.
  "design"/"debug"; then the small model if unsure) scores difficulty as easy / medium / hard and picks
  the model from a user-defined tier list (e.g. easy → Haiku or a local model, medium → Sonnet, hard → Opus).
  Subagents and background jobs (titles, summaries, wiki pages) default to the easy tier.
  Escalate automatically after repeated tool errors or a failed verification; never downgrade mid-turn.
  Show the chosen model + reason on the turn ("easy: rename → local qwen") with a one-click override;
  log choices so the rules can be tuned.
- **Local models:** in provider settings (#2), mark a provider/model as local (auto-detected for
  localhost URLs like Ollama/LM Studio) with its size on disk, quantisation, and context length; read
  these from Ollama's `/api/show` / `/api/ps` where available.
- **Capacity planner:** detect hardware (GPU name + VRAM via `nvidia-smi` / DXGI, system RAM, free disk) or
  let the user enter it, then show per model: fits in VRAM / fits with CPU offload / won't fit, rough
  memory needed at a chosen context size (weights + KV cache), how many copies or which combinations fit
  together (e.g. "a 7B coder + an 8B vision model fit side by side; a 32B needs everything"), and whether
  the disk has room to download more. The router only picks local models that fit alongside what's loaded.
- Effort: medium–high (routing rules + UI; the hardware math is estimates, labelled as such). Impact: high.
