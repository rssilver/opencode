# Changelog

This file records the changes made in this working session. It is separate from
the repo's own conventions (`AGENTS.md`) and translations. Each entry is dated
and grouped by area. See `spec.md` for repo documentation and a section on the
features added here.

## 2026-10-13 — General defaults, dark mode, collapse thinking blocks

### General settings enabled by default (app)
- Flipped all general toggles to `true` in `defaultSettings.general`:
  `showFileTree`, `showNavigation`, `showSearch`, `showStatus`, `showTerminal`,
  `showReasoningSummaries`, `collapseShellTools`, `showCustomAgents`. (`shellToolPartsExpanded`
  was later replaced by the `collapseShellTools` dropdown; see below.)
- Kept `editToolPartsExpanded: false` at the user's request.

### Dark mode on by default (ui)
- New installs now start in dark mode. In
  `packages/ui/src/theme/context.tsx` the color-scheme fallback changed from
  `"system"` to `"dark"`. Existing saved preferences are unaffected.

### Collapse thinking blocks setting (new feature — see spec.md)
- Added a general setting `collapseThinkingBlocks` with options:
  `"yes"`, `"once-complete"` (default), `"no"`.
- Renders as a dropdown in **General settings** on both surfaces: v1
  (`packages/app/src/components/settings-general.tsx`) and v2
  (`packages/app/src/components/settings-v2/general.tsx`).
- Reasoning/thinking blocks now render as collapsible accordions, like tool
  calls. Behavior by mode:
  - `yes` — always collapsed.
  - `once-complete` — the current block stays open only while the turn is still
    streaming; once thinking stops it collapses too (earlier blocks stay
    collapsed).
  - `no` — always expanded.
  - A manual expand/collapse by the user is respected and sticks.
- Wired through `packages/session-ui/src/components/message-part.tsx`: new
  `ThinkingCollapseMode` type, collapsible `ReasoningPartDisplay`, threading via
  `MessagePartProps` (`Part`, `AssistantParts`, `AssistantMessageDisplay`,
  `Message`). The v2 timeline passes the setting in
  `packages/app/src/pages/session/timeline/message-timeline.tsx`.

### Collapse shell tool parts setting (new feature)
- Replaced the boolean `shellToolPartsExpanded` general setting with a dropdown
  `collapseShellTools` using the same three-mode `ThinkingCollapseMode`:
  `"yes"`, `"once-complete"` (default), `"no"`. Behavior by mode for shell/tool
  parts:
  - `yes` — always collapsed.
  - `once-complete` — the part stays open only while its tool call is still
    running/pending; it collapses as soon as that call completes or errors.
  - `no` — always expanded.
  - A manual expand/collapse by the user is respected and sticks: the v2
    timeline persists the choice in its per-part `toolOpen` store, so the mode
    only governs open state before the user first interacts with a part.
- `partDefaultOpen` now takes a collapse mode instead of a boolean; shell/bash
  parts return true while `state.status` is pending/running under
  `once-complete`, false otherwise. Updated `part-default-open.test.ts`.
- Wired through `packages/session-ui/src/components/message-part.tsx` and
  `session-turn.tsx` (legacy path keeps the old boolean for backward-compat and
  coerces it to a mode). The active v2 timeline reads the setting in
  `packages/app/src/pages/session/timeline/message-timeline.tsx`.
- Setting rendered as the same Select dropdown as thinking on both surfaces
  (`settings-general.tsx`, `settings-v2/general.tsx`), with i18n keys for all 62
  locales: `settings.general.row.collapseShellTools.{title,description,option.yes,option.onceComplete,option.no}`.
- Store getter reads the persisted setting and falls back to `"once-complete"`
  (`packages/app/src/context/settings.tsx`). The old boolean `shellToolPartsExpanded`
  key is now ignored, so every user (existing or new) defaults to `once-complete`.

### Known issue (deferred)

The shell and thinking collapse dropdown selection does not stick — see
[`bugs.md`](./bugs.md). The intended default (`once-complete`) applies regardless,
so users get the desired behavior without needing to select it.

### Collapsible arrow UX fix (session-ui)
- The thinking-block chevron now uses a single `chevron-right` glyph for both
  states, rotated to point down when open. Sized with `size="small"` to match
  the label; rotation is RTL-safe (`:dir(rtl)` flips the rotation direction).
- Fixes the earlier mismatch where the right chevron looked bigger than the
  down one and was off-center / too big.

### i18n
- Added keys for all locales (62 files): `settings.general.row.collapseThinkingBlocks.title`, `.description`, `.option.yes`, `.option.onceComplete`, `.option.no`. English strings are placeholders pending translation. `i18n parity` test passes.

### Verification
- `session-ui` and `app` typecheck pass (only the pre-existing, unrelated
  `packages/app/src/custom-elements.d.ts` error remains).
- `i18n parity`: 5/5. `session-ui` component tests: 65/65.
- Desktop rebuilt with `electron-vite build` and packed to an NSIS installer at
  `packages/desktop/dist/opencode-desktop-win-x64.exe`.

## 2026-10-14 — Thinking-panel scrollbar: auto-scroll fix and draggable thumb

### Auto-scroll follow fix (session-ui)
- Fixed the thinking panel no longer scrolling as text grows past its max-height. The
  follow loop gated on `scrollHeight - scrollTop - clientHeight < 24`, so once per-tick
  growth exceeded ~24px the gap only kept growing and follow stalled; text piled up
  off-screen below the fold.
- Introduced a `pinnedToBottom` flag (starts true). While streaming, every tick now
  always re-pins to the bottom (`scrollTop = scrollHeight`) so it keeps up regardless of
  token rate. Scroll events only flip the flag: scrolling past ~24px from the bottom
  stops following; returning to the bottom resumes it. `message-part.tsx`.

### Draggable scrollbar thumb (session-ui)
- Added pointer-capture handlers (`onPointerDown/Move/Up`) on `.reasoning-scrollbar-thumb`
  that map drag distance to scroll position using the thumb's travel range
  (`trackHeight - thumbHeight`) against the full scrollable range, clamped to `[0, max]`.
- Grabbing sets `pinnedToBottom = false` so auto-follow yields while dragging and resumes
  when the user returns to the bottom. Same white 3px thumb / dim track visually; only
  added `pointer-events: auto` and `grab`/`grabbing` cursor on the thumb in
  `message-part.css`.

### Verification
- `session-ui` typecheck passes. Desktop rebuilt with `electron-vite build` and packed to
  an NSIS installer at `packages/desktop/dist/opencode-desktop-win-x64.exe`.

### Global collapse alignment and boundary fix (app)
- Fixed two bugs in the "Worked for X" supersection collapse (`collapseWorkingSections`,
  `packages/app/src/pages/session/timeline/working-sections.ts` + `message-timeline.tsx`).
- **Alignment** — the section trigger rendered flush-left at full viewport width while the
  actual message text sits in a centered, padded column, so "Worked for" appeared far to the
  left of its content. `WorkingSectionSummary` now applies the same framing as other rows:
  `min-w-0 w-full max-w-full`, `md:max-w-200 2xl:max-w-[1000px]` + `md:mx-auto` when centered,
  and an inner `w-full px-4 md:px-5` wrapper so the label aligns with message columns.
  `centered` is threaded from `MessageTimeline` through `VirtualTimelineRow`.
- **User messages never collapse** — boundaries (user messages) are now always rendered inline
  and split the timeline into turn groups; they are never folded into a collapsed section. The
  algorithm treats both visible responses and boundary rows as inline anchors that flush the
  pending working section before rendering. Section duration is summed over *distinct* turn
  `userMessageID`s (deduped) so repeated tool/thinking rows in one turn don't multiply the total.
- Updated `working-sections.test.ts` to assert user messages stay visible as boundaries and the
  collapsed response folds into a section between them; duration counts only distinct turns.
- Verification: `bun run typecheck` OK; timeline suite 36/36 (`working-sections.test.ts` 5/5);
  `oxlint` on changed files 0 warnings / 0 errors (remaining warnings are pre-existing in the
  large `message-timeline.tsx`). Desktop rebuilt and packed to
  `packages/desktop/dist/opencode-desktop-win-x64.exe`.

### 2026-10-16 — Global collapse: ghost sections, toggle persistence, arrow placement

### Ghost section above every user message (app)
- The "Worked for X" trigger was appearing above every user message with nothing inside it.
  Root cause: `TurnGap` spacer rows (inserted before each turn by the projection,
  `rows.ts`) were being folded into collapsed sections and rendered as empty groups.
- `buildDisplayRows` in `working-sections.ts` now filters out `TurnGap` rows up front, so spacers
  can never become phantom sections or shift section keys/content.

### Expand/collapse made persistent (app)
- Previously a collapsed summary was the only row emitted for its group; expanding replaced it with
  child rows and left no way to collapse back ("disappear and never come back"). `WorkingSectionSummary`
  is now always emitted as the disclosure header, and expanded sections additionally reveal their
  child rows inline after it. The toggle therefore stays in the timeline in both states.
- `buildDisplayRows`/`flushRun` now always push the summary row and only append child rows when
  `isExpanded(key)` is true.

### Arrow moved to the right of the label (app)
- The disclosure chevron was on the left of the "Worked for" text. It now sits to the right via a
  `justify-between` button layout, rotating from a right-pointing arrow (collapsed) to down (expanded).
- Rotation is applied as an inline `transform` style computed at render time (`document.documentElement.dir`)
  rather than a stylesheet rule, so it can flip direction for RTL without relying on cascade order. The old
  scoped stylesheet `message-timeline-working-sections.css` was removed once the import dropped out.

### Section durations are distinct per assistant message (app)
- Previously every collapsed section in a turn reported the whole turn's duration (`turnDurationMs`), so
  consecutive "Worked for X" labels were identical ("linked times"). `buildSummary` now sums a per-row
  contribution keyed by assistant message instead of deduping by user-message id, and `message-timeline.tsx`
  supplies that via `partMessageDurationMs`, which resolves each `AssistantPart` to its own assistant message
  (`time.created`/`time.completed`) and contributes only that response's span. Distinct responses therefore
  yield distinct totals; repeated parts of one message are counted once.

### Active-turn rows stay visible (app)
- While a turn is still running, its thinking/shell/explore work should not collapse into a group until it
  finishes. `buildDisplayRows` gained an `isActive` predicate and now treats active-turn rows as inline
  anchors (flush + render), matching how boundaries/visible responses behave; once the turn completes they
  fold normally. `message-timeline.tsx` passes `isActive: row => workingTurn(row.userMessageID)`.

### Each turn's final answer stays visible; middle answers fold (app)
- The visibility rule used a global "last two responses" window, so early turns' answers folded into groups
  and only the very last two stayed open. It now keys off the turn: a single `userMessageID` can emit several
  assistant messages/responses, and `buildDisplayRows` keeps each turn's **final** answer visible (largest
  response index per turn) plus any `persist` flag, folding every other response — middle/intermediate answers
  inside a turn — into that turn's "Worked for…" group along with its thinking and tool-calls. This stops the
  groups from swallowing a turn's answer while still collapsing the work around it; turns with one answer keep
  it visible, turns with no text answer fold their whole work into the next group. The `RESPONSE_WINDOW`
  constant was removed as part of this.

### Padding above worked-on sections (app)
- The summary header sat flush against the content above it. Added `pt-3` to the outer wrapper, matching the
  sibling collapsible header (`previousAssistantPart`) spacing.

### Verification
- `working-sections.test.ts`: 7/7 pass, including tests asserting each turn's final answer stays visible while
  its thinking/tool-calls and any middle answers fold into the per-turn group (plus persisted-visible, active,
  TurnGap no-ghost, and distinct-duration cases).
- Full timeline suite: 38/38 (`packages/app/src/pages/session/timeline/`).
- `bun run typecheck` OK; `oxlint` on changed files 0 errors (25 pre-existing warnings in the large
  `message-timeline.tsx`). Desktop rebuilt and packed to
  `packages/desktop/dist/opencode-desktop-win-x64.exe`.

## 2026-10-27 — Rebuilt on a clean branch from `dev` (`collapse-settings`)

The work from `custom-collapsible-thinking` was re-applied onto a fresh branch cut from `dev`
(`aa481b8f56`), dropping its accidental damage and fixing the flicker. The old branch is kept as-is;
its last uncommitted edits are in `git stash` ("custom-collapsible-thinking WIP"), and the newer
per-turn final-answer grouping from them is included here.

### Translation files repaired (app)
- The old branch's first commit re-saved all 62 `packages/app/src/i18n/*.ts` files through a
  wrong-encoding round trip (e.g. "öffnen" → "Ã¶ffnen", plus a BOM), touching ~47k lines. Here
  every locale file is byte-identical to `dev` except for the 13 new setting lines (English
  placeholders, required by `parity.test.ts`). Edits were made in Python with explicit UTF-8, not
  PowerShell `Get-Content`/`Set-Content`.

### Flicker fixes (app, session-ui)
- **Timeline rows no longer remount on every token** — `message-timeline.tsx` `VirtualTimelineRow`
  rendered rows through an inline function that re-ran whenever `displayRows()` was rebuilt (every
  streamed token), recreating each row and re-rendering its markdown. Rows now unwrap to the
  projection's stable row object and switch with two `<Show>`s.
- **Turns don't fold and unfold mid-stream** — grouping now uses `turnInProgress` (session busy on the
  turn, or any of its assistant messages lacking `time.completed`) instead of session status alone.
- **Thinking panel keeps one markdown instance** — `message-part.tsx` used separate streaming and
  finished copies of `PacedMarkdown`, remounting when the message completed. Now one copy, height-bounded
  by CSS only while streaming.
- **Thinking panel follows by content growth, not a timer** — the 80ms `setTimeout` loop that reset
  `scrollTop` and the hand-built draggable scrollbar (~100 lines) were replaced by a `ResizeObserver` and
  the native thin scrollbar in theme colors (`--border-weak-base` instead of hard-coded white).

### Settings (app)
- `collapseShellTools` reads the legacy `shellToolPartsExpanded: true` as `"no"` when the new key is
  unset, so saved "expanded" choices and e2e fixtures still work (`context/settings.tsx`).

### Bugs
- `bugs.md`: the Select "selection doesn't stick" entry is reopened as cause-unknown. The proposed fix
  (pass a string as Kobalte's `value`) contradicts Kobalte's API and the working colour-scheme Select
  that uses the same pattern. Not applied.

### Verification
- `bun typecheck` passes in `packages/session-ui`, `packages/app`, `packages/ui`, `packages/enterprise`.
- `packages/app`: `bun test --conditions=solid --preload ./happydom.ts ./src` → 731/731 pass
  (includes i18n parity and `working-sections.test.ts`).
- `packages/session-ui`: `bun test` → 84/84 pass.
- Live check in the app dev server (`localhost:4444`, backend on `4096`) against LM Studio
  (`cyber-tiel-coder-35b-a3b-mtp`): a MutationObserver showed no timeline rows removed or re-added while
  a long markdown answer streamed; the only markdown removals were thinking blocks collapsing as the
  answer started, and the "Worked for" fold happened once when the turn finished. Collapse dropdowns
  keep their selection and reopen. Long mid-stream pauses were not tested (the model streams fast).

### Dark mode default actually applies (ui)
- `theme/context.tsx` had a second fallback, in the mount step, that still read `"system"` and overrode
  the `"dark"` initial value, so dark mode only appeared when the OS was dark. Both fallbacks are `"dark"` now.
  Verified on a fresh browser profile with a light OS theme.

## 2026-10-27 — Global collapse: first + latest answer, fold finished work during a turn

### Working sections (app)
- `working-sections.ts`: each turn keeps its first and latest answer visible (was: final only); middle
  answers fold. `isActive` (whole running turn inline) replaced by `isUnfinished` (row-level), so finished
  thinking/tool rows fold as soon as they finish, even mid-turn. Section keys use the first row only, so a
  growing section keeps its expanded state.
- `message-timeline.tsx`: `rowIsUnfinished` decides per row (running/pending tool, streaming text or
  thinking, status rows of a running turn).

### Verification
- `working-sections.test.ts` updated (first+latest visible, mid-turn folding, stable key): timeline suite
  39/39; `bun typecheck` (app) passes.
- Live, LM Studio, prompt sent from the app input: `echo one` folded the moment it finished, the running
  `ping` stayed inline until done, and the turn settled as user / group / first answer / group / latest answer.
- Note: prompts sent through the legacy v1 `prompt_async` route don't stream into the app (it listens on
  the v2 event stream); they appear after a reload. Upstream behavior, not changed here.

## 2026-10-27 — Session summarizer setting (threshold + auto TTFT)

- **app** — "Summarize sessions" row on both General settings surfaces
  (`components/summarize-sessions.ts`, `settings-general.tsx`, `settings-v2/general.tsx`); writes the server's
  global config. 7 new i18n keys (English placeholders in the 61 other locales).
- **core (V2)** — `config/compaction.ts`, `v1/config/config.ts`, `v1/config/migrate.ts`: new `threshold`
  and `ttft` keys. `session/compaction.ts`: threshold rule, `ttftDegraded`, per-session TTFT samples, loop
  guard. `session/runner/llm.ts`: TTFT measured per attempt.
- **opencode (V1)** — `session/overflow.ts` (threshold, `userMessagesSinceCompaction`), `session/ttft.ts`
  (sample store), `session/processor.ts` (TTFT), `session/compaction.ts` (soft triggers + guard),
  `session/prompt.ts` (passes session messages to the check).
- Implemented by a Sonnet subagent from a spec; reviewed here.

### Verification
- core: compaction, compaction-trigger and runner tests 102/102; `bun typecheck` passes.
- opencode: `test/session/compaction.test.ts` 59/59 (1 timeout flake seen once by the subagent, not
  reproduced); `bun typecheck` passes.
- Live (LM Studio, test project with a 40k context and `threshold: 0.4`): turns at 15.9k and 16.9k tokens,
  then exactly one summary before the next turn, which restarted at 13.3k tokens. No repeat loop.
- The app's Select writes `threshold: 0.5` / `ttft.enabled` to the global config after a backend restart
  (the earlier running backend still had the old schema and dropped the new keys).
- Not verified live: a TTFT-triggered summary (needs a real slowdown); covered by unit tests only.

## 2026-10-27 — Built-in browser panel (desktop)

- **desktop** — `main/browser-panel.ts`, `main/browser-url.ts` (+ test), `main/ipc.ts`, `preload/index.ts`,
  `preload/types.ts`, `renderer/index.tsx`.
- **app** — `browser.ts` (shared types, exported as `@opencode-ai/app/browser`), `context/platform.tsx`,
  `context/layout.tsx`, `pages/session/browser-panel.tsx`, `pages/session.tsx`,
  `pages/session/use-session-commands.tsx` (`browser.toggle`, `Mod+Shift+B`, `/browser`),
  `components/session/session-header.tsx` (titlebar button). 11 i18n keys (English placeholders in the
  61 other locales).
- Implemented by a Sonnet subagent from a spec; reviewed here. Added: hide the native view while an app
  dialog/menu/listbox is open, since native views paint above the DOM.

### Verification
- `bun typecheck` passes in `packages/desktop` and `packages/app`; `browser-url.test.ts` 10/10; app suite
  732/732 (i18n parity included); `bun run build` in `packages/desktop` succeeds.
- **Not verified at runtime.** Launching a second desktop instance for an automated check failed: the
  user's installed "OpenCode Dev" app was running and holds the single-instance lock for the same app id.

## 2026-10-27 — `view_images` tool with a vision-model fallback

- **opencode** — `src/tool/view-images.ts` + `.txt` (new), registered in `src/tool/registry.ts`;
  `test/tool/view-images.test.ts` (7 tests, fallback covered with a fake LLM/provider).
- **core** — `v1/config/config.ts`: `vision: { model?: string }`; `v1/config/migrate.ts`: `vision` counts as a
  V1 key.
- Implemented by a Sonnet subagent from a spec; reviewed here.

### Verification
- `bun typecheck` passes in `packages/opencode` and `packages/core`; `view-images.test.ts` 7/7.
- `read.test.ts` → "normalizes read permission paths on Windows" fails, and also fails with the registry change
  reverted, so it's pre-existing (logged in `bugs.md`).
- Live (LM Studio, `cyber-tiel-coder-35b-a3b-mtp`, a folder with two labelled PNGs and a .txt): with the model
  marked vision-capable, the tool attached both images (skipping the .txt) and the model read "PEARS: 5" and
  "APPLES: 3"; with a text-only alias of the same model and `vision.model` set, nothing was attached and the
  vision model's description gave the same answer.

## 2026-10-27 — Context meter in the session header

- **app** — `components/session/context-meter.ts` (pure math: token count, summary trigger, TTFT samples/trend,
  sparkline) + `context-meter.test.ts` (11 tests); `components/session/session-context-meter.tsx` (ring +
  percentage with a tooltip); `components/session/session-header.tsx` renders it in both header variants.
  11 `context.meter.*` i18n keys (English placeholders in the 61 other locales; additions only).
- Tooltip: tokens used / context window, summary trigger point (mirrors the server rule: `min(context ×
  threshold, usable)`, "Summaries off" when `compaction.auto` is false), summarize mode, time to first token
  (latest vs baseline = min of first 3) with a 20-sample sparkline, and a slowdown ratio. The ring turns to
  the warning colour when Auto would trigger or the trigger point is reached.
- Implemented by a Sonnet subagent; reviewed here. Widened the tooltip (220 → 300px) and stopped truncating
  values after the live check showed the TTFT row cut off.

### Verification
- `bun typecheck` (app) passes; meter + i18n tests 24/24; full app suite 743/743 (subagent run).
- Live in the app dev server with LM Studio: header shows "7%"; tooltip read 13,303 / 200,000 (7%),
  summarizes at 192,000 (96%, = context − max output, as on the server), "At context limit", TTFT 0.6s
  (baseline 0.5s), 1.1× baseline, sparkline drawn.

## 2026-10-27 — Agent browser tools, dev-server previews, chat screenshots, auto-verify, project memory

- **desktop** — `src/main/agent-tools/` (new): local MCP server in the Electron main process (127.0.0.1,
  random port, bearer token, Host pinned, `Origin` rejected, POST `/mcp` only, 1MB body cap) injected into
  the local sidecar via `OPENCODE_CONFIG_CONTENT` as MCP server `desktop`. Tools: `browser_open/tabs/read/
  click/type/scroll/screenshot/back/forward/close_tab` (http/https only, isolated-world page scripts, no
  arbitrary JS) and `preview_list/start/logs/stop` driven by a project's `.opencode/launch.json`.
  `preview_start` is set to **ask** permission by default (`permission.desktop_preview_start`, an explicit
  user setting wins). `browser-panel.ts`, `index.ts`, `server.ts`, preload, `@opencode-ai/app/browser` and
  `pages/session.tsx` wire the "open panel" request. Adds `@modelcontextprotocol/sdk` to desktop.
- **session-ui** — image attachments of completed tool parts render as thumbnails under the tool header
  (also when collapsed); click opens the existing image preview. Fixed after the live check: thumbnails
  were 0px wide (lazy image inside a max-width-only button) — now fixed width, eager load. 1 ui i18n key.
- **opencode / core** — `verify: { command, timeout_ms, max_attempts, enabled }`: after a turn that changed
  files, run the command; on failure feed the output back for a fix (default 2 attempts); synthetic notes
  show pass/fail (`session/verify.ts`, `session/prompt.ts`). `memory` tool + `.opencode/memory.md` loaded
  into the system context, `memory: { enabled }` (`memory/memory.ts`, `tool/memory.ts`, `session/instruction.ts`).
- Built by Sonnet subagents from specs; reviewed here.

### Verification
- `bun typecheck` passes in opencode, core, desktop, session-ui, app. Desktop agent-tools tests 22/22
  (incl. the new permission default); subagent runs: desktop 31/31, app 743/743, session-ui 84/84, opencode
  verify/memory/instruction/prompt/registry tests passing (compaction timing flake as before).
- Live in the rebuilt desktop app (user's OpenCode Dev closed) with LM Studio: backend reported MCP
  `desktop: connected`; the model opened example.com, read it, clicked "Learn more", took a captioned
  screenshot (real IANA page) and answered correctly; the panel opened by itself. The screenshot thumbnail
  rendered in chat (358px) and opened full size. `preview_start` asked for permission, started
  `python -m http.server 8765` from `launch.json`, opened it in the panel, and the model read the listing.
- Not checked live: auto-verify and memory in the app (loop-level tests only); browser "back" state reported
  `canGoBack: false` after a click navigation (logged in bugs.md).

## 2026-10-27 — Todo list: three new items, sorted by impact and effort

- **docs** — `todo.md`: added "Richer Thinking loader with animation", "Update the session title as the
  session progresses", and "Sidebar rework (Devin / Claude Code style) and `@` workspace tagging", each with
  scope notes from the current code (`TimelineThinkingRow`, `SessionPrompt.ensureTitle`, `layout.tsx`).
- Re-sorted all nine items by impact vs. effort with a summary table at the top; renumbered 1–9 and
  fixed cross-references between the native-app panel and computer-use items.

## 2026-10-27 — Todo list: six more items, re-sorted to 15

- **docs** — `todo.md`: added "Add models and providers from the app", "Browser logins and bookmarks",
  "Deep-wiki for a workspace", "Open files the way a person would", "Let a vision model watch videos", and
  "Skill system that learns tools end-to-end (`!skill`)", each scoped against existing code (custom-provider
  dialog, `persist:opencode-browser` partition, `file-tabs.tsx`, `src/skill`).
- Re-sorted all 15 by impact vs. effort; the skill system sits last because it depends on video watching,
  computer use and the mirrored-app panel. Cross-references renumbered.

## 2026-10-27 — Thinking loader, "Worked for" arrow, auto re-titling, more todos

- **app** — "Worked for" row: chevron now sits right after the label instead of the far right
  (`message-timeline.tsx`, `WorkingSectionSummary`).
- **app / session-ui** — Thinking row shows the current activity (reuses existing `ui.sessionTurn.status.*`
  keys: Running commands, Making edits, Searching the codebase, …), an elapsed timer, and an animated star
  glyph (reduced-motion safe). Files: `timeline/rows.ts`, `timeline/timeline-row.ts`, `message-timeline.tsx`,
  `session-turn.css`; tests updated in `working-sections.test.ts`.
- **opencode** — Sessions re-title at the 3rd real user message and every 8th after, only while the title is
  still the auto-generated one (`metadata.autoTitle`; user renames stop it). Files: `session/session.ts`,
  `session/prompt.ts`, new `test/session/retitle.test.ts`.
- **docs** — `todo.md`: quick-fix note for collapse arrows, #16 UI design refresh, #17 model routing + local capacity planner.
- Verification: `bun typecheck` passes in packages/app and packages/opencode; app timeline tests 39 pass;
  opencode retitle/prompt/session tests pass. Not verified live: the glyph's frame cycling (computed style
  showed only the first frame in a quick check) and a real re-title through the loop.

## 2026-10-28 — Models/providers in the app, browser bookmarks, next-step cards

- **app (providers)** — Custom provider dialog gets "Fetch models" (`GET {baseURL}/models`, direct request;
  local servers need CORS allowed, e.g. LM Studio's toggle), edit mode for config-defined OpenAI-compatible
  providers, and a new "Add model" dialog for connected providers (limits, vision/tool/reasoning toggles →
  `provider.<id>.models.<model>`). On v1 and v2 settings. Removal stays via Disconnect (config merges can't
  delete keys); env-connected providers don't get the new buttons yet. Files: `dialog-custom-provider*.ts(x)`,
  `dialog-add-model*.ts(x)`, `settings-providers.tsx`, `settings-v2/providers.tsx`, `i18n/en.ts`.
- **desktop + app (browser)** — Bookmarks for the built-in browser: import from Chrome/Edge profiles (reads only
  `Bookmarks` / `Local State`, never cookies or passwords), star button, bookmarks menu by folder, stored in
  `opencode.browser-bookmarks`. Files: `desktop/src/main/bookmarks-import.ts`, `browser-bookmarks.ts`, `ipc.ts`,
  `preload/index.ts`, `app/src/browser.ts`, `pages/session/browser-bookmarks.tsx`, `browser-panel.tsx`.
- **opencode + session-ui + app (next-step cards)** — New `wrap_up` tool (recap, optional question, ≤2 reply
  buttons; returns immediately), only for app/desktop clients and the build/plan agents. Its description tells
  the model to use it only when the user has a decision or step left. Rendered as a card under the final
  answer, never folded into "Worked for"; a button sends its reply as the next prompt and disables after use or
  once a newer turn exists. Files: `tool/wrap-up.ts|txt`, `tool/registry.ts`, `agent/agent.ts`,
  `session-ui/.../message-part.tsx|css`, `session-ui/context/data.tsx`, `app/pages/directory-layout.tsx`,
  `timeline/working-sections.ts`, `message-timeline.tsx`, `ui/src/i18n/en.ts`.
- Verification: `bun typecheck` clean in app, opencode, desktop, session-ui. Tests: app session+components 243
  pass; opencode `wrap-up` + `retitle` 9 pass; desktop bookmarks parser 2 pass. Not checked live: the new
  dialogs, bookmarks UI in Electron, and whether models respect the wrap_up rule.

## 2026-10-28 — LM Studio load and prompt-processing progress

- **schema / sdk** — `SessionStatus` busy gets optional `progress: { kind: "load" | "prompt", value }`
  (`packages/schema/src/session-status-event.ts`); regenerated `packages/sdk/js/src/v2/gen/types.gen.ts`
  (also picked up pending Config fields from earlier sessions).
- **opencode** — New `src/provider/lmstudio-progress.ts`: detects local LM Studio (`/api/v1/models` probe),
  pre-loads an unloaded model through `/api/v1/chat` to read `model_load.progress`, and reads
  `lms log stream --source server --json` for "Prompt processing progress: N%" lines. Hooked into
  `session/processor.ts`; progress clears on the first token. Only the V1 processor path is wired.
- **app / session-ui** — Thinking row shows "Loading model N%" / "Processing prompt N%" with a thin bar
  (`timeline/rows.ts`, `timeline-row.ts`, `projection.ts`, `message-timeline.tsx`, `session-turn.css`,
  `ui/src/i18n/en.ts`).
- Verification: prompt progress streamed live 0→100% from the user's LM Studio; load path unit-tested only.
  Tests: lmstudio-progress 8, processor-effect 17, app session 104 pass; typecheck clean.

## 2026-10-28 — Fix: LM Studio prompt progress in the desktop app

- **opencode** — `src/provider/lmstudio-progress.ts` used `Bun.which` / `Bun.file` / `Bun.spawn`, which don't
  exist when the server runs inside Electron (Node), so prompt progress silently never started in the desktop
  app. Switched to `which` from core, `fs/promises.access`, and `Process.spawn` with a Node stdout stream.
- Verification: bundled the module for Node and ran it under Node 24 against LM Studio — progress
  0→100% for one request, clean exit after the 30s idle shutdown. Unit tests and typecheck pass.

## 2026-10-28 — Fix: LM Studio "Loading model" progress never showed

- **opencode** — Title generation (and summaries) run in the background on the same LM Studio model (no
  small-model match), and their `/v1/chat/completions` request JIT-loaded the model silently before the
  processor's load watcher ran, so it saw the model as loading/loaded and skipped. New shared
  `LmStudioProgress.ensureLoaded` (one load per origin+model through `/api/v1/chat`); `LLM.run` awaits it
  before every LM Studio request, and the processor's watcher attaches to the same load. Closing a watcher
  now only detaches it (interrupting a session no longer cancels the load). Files:
  `src/provider/lmstudio-progress.ts`, `src/session/llm.ts`.
- Verification: under Node, a simulated title request + progress watcher on an unloaded 2 GB model → 41
  load updates 0→100%, title request then 200. User's model restored afterwards. Tests + typecheck pass.

## 2026-10-28 — Nicer expanded "Worked for" sections

- **app** — Rows revealed by an expanded "Worked for" section are tagged (`inSection` on the display row in
  `timeline/working-sections.ts`, `data-in-section` on the row in `message-timeline.tsx`) and styled in
  `app/src/index.css`: indented under the header, a 1px guide line on the left (`--border-base`), and one font
  size/weight (13px regular) for thinking, tool, explored and shell row titles.
- Verification: typecheck clean, timeline tests 41 pass; checked computed styles and a screenshot of a mock
  section in the dev preview (no live session available in the preview backend).
- Follow-up: guide line now continuous (overshoots each row, trimmed by the virtual row's `overflow: clip`),
  and Explored (`context-tool-group-title`) and Edit/Write/Patch (`message-part-title*`) titles join the
  13px regular style. Checked on a mock with clipped, spaced virtual rows in the dev preview.

## 2026-10-28 — Auto-compaction for LM Studio models without a context limit

- **opencode** — Custom LM Studio models usually have no `limit.context` in `opencode.json`, so it was 0 and
  `isOverflow` never fired: those sessions never auto-compacted. `SessionPrompt.getModel`
  (`src/session/prompt.ts`) now fills a missing context limit from the context length the loaded model is
  served with (`LmStudioProgress.contextLength` / `loadedContextLength` in `src/provider/lmstudio-progress.ts`,
  read from `/api/v1/models` → `loaded_instances[0].config.context_length`). Unloaded models are left alone,
  because LM Studio can load them with less than `max_context_length`. A configured limit always wins.
- **docs** — `todo.md`: #1–#4 and the collapse-arrow quick fix marked done. `bugs.md`: the "Thinking stays
  after compaction" bug could not be reproduced through manual summarize + continue or soft auto-compaction
  (live in the app with LM Studio). Only the hard-overflow path is still unverified.
- Verification: new unit tests (`test/provider/lmstudio-progress.test.ts`, 10 pass), `bun typecheck` clean, and
  a live call against LM Studio returned 262144 for the loaded model and undefined for an unloaded one.
## 2026-10-28 — Interactive visuals in the chat (`show_visual`)

- **opencode** — New display-only tool `show_visual({ title, html })` (`src/tool/show-visual.ts`, `.txt`), registered
  in `src/tool/registry.ts` for the `app`/`desktop` clients (same gate as `wrap_up`; default `*: allow` permission, so
  no `agent.ts` change). The description says when to use it (simulations, graphs, diagrams, calculators) and when not
  (plain answers, files in the project). `html` is capped at 400 KB. Each call keeps a copy at
  `<data>/visuals/<project id>/<title-slug>-<call id>.html`; the path is in the tool metadata and output.
- **session-ui** — `VisualCard` (`src/components/visual-card.tsx`, styles in `message-part.css`), rendered from
  `message-part.tsx` for completed `show_visual` parts. Sandboxed iframe (`sandbox="allow-scripts"`, no same-origin,
  `srcdoc`) with an injected CSP: scripts/styles/fonts/images only from cdn.jsdelivr.net, cdnjs.cloudflare.com and
  unpkg.com, `connect-src 'none'`. App theme passed in as CSS variables (`--background`, `--text`, `--accent`, …).
  Auto height via postMessage (120–640px) and a vertical resize handle. Actions: Full screen, Reload, Source, Save
  (downloads the `.html`). Uncaught errors, unhandled rejections and CSP blocks are posted to the card and listed;
  "Ask to fix" sends them back to the model as the next prompt.
- **app** — `message-timeline.tsx`: completed visuals are pinned like the wrap-up card, so they do not fold into
  "Worked for".
- **i18n** — `ui.visual.*` keys in `packages/ui/src/i18n/en.ts` (other locales fall back).
- Verification: `bun typecheck` clean in `packages/opencode`, `packages/session-ui`, `packages/app`;
  `test/tool/show-visual.test.ts` 3 pass. Sandbox document checked in a browser harness: Chart.js loaded from
  jsdelivr, `fetch` to another host blocked and reported, uncaught error reported, height messages received. Not
  checked end to end with a live model in the app.
## 2026-10-28 — Browser password vault and agent sign-in

- **desktop** — new `src/main/browser-passwords.ts`: `safeStorage`-encrypted vault in userData
  (`opencode.browser-passwords.bin`) with saved logins, "never save" origins and agent sign-in grants;
  exact-origin matching; Chrome CSV parsing; save/update offers; sign-in permission prompts.
- **desktop** — new sandboxed tab preload `src/preload/browser-login.ts` (added as a preload input in
  `electron.vite.config.ts`, set in `browser-panel.ts`) reports login submits over synchronous IPC. Console
  output was rejected as the channel because `spyRendererConsole` logs renderer console messages to disk.
- **desktop** — new agent tool `browser_sign_in({ site })` in `src/main/agent-tools/browser-sign-in.ts`
  (registered in `agent-tools/server.ts`). Fills and submits saved logins, including two-step flows, from the
  main process; returns only `signed_in` / `failed` / `needs_user`.
- **desktop** — IPC `browser-passwords-*`, `browser-sign-in-answer` in `main/ipc.ts`; preload
  `window.api.browser.passwords` in `src/preload/index.ts`.
- **app** — `pages/session/browser-passwords.tsx`: save/update bar and "Allow the agent to sign in?" bar in the
  browser panel, and a Passwords dialog from the bookmarks menu (list, show, add, edit, delete, CSV import,
  revoke permissions). Types in `src/browser.ts`; strings `browser.passwords.*` in `i18n/en.ts`.
- Verification: `bun typecheck` clean in `packages/desktop` and `packages/app`; `browser-passwords.test.ts`
  9 pass (the desktop suite's only failure is the existing `draft-store` test, since Bun has no `node:sqlite`).
  An Electron harness ran the real panel, preload, vault and tool against a local fake two-step login page
  with made-up values: save offer → saved; agent sign-in → `signed_in`; denied → `failed`; one-time-code page →
  `needs_user`; wrong password → `failed`; other origin → no match. No password appeared in any renderer
  message, and the vault file had no plain text. The renderer UI was typechecked but not viewed in the app.
## 2026-10-28 — `video_watch` and `browser_video_watch` (todo #11)

- **opencode** — new builtin tool `video_watch` (`packages/opencode/src/tool/video-watch.ts`, `.txt`), registered
  in `registry.ts`. ffprobe chapters/streams, embedded or sidecar subtitles, local whisper.cpp fallback,
  scene-change + narration + evenly spaced frames (768 px JPEG, `maxFrames` default 12), `start`/`end` zoom.
- **opencode** — `view-images.ts`: the vision-model fallback is now the exported `describeImages(services, ...)`
  so `video_watch` reuses it; `view_images` behavior unchanged.
- **desktop** — new agent tool `browser_video_watch` (`agent-tools/video-tools.ts`, `video-script.ts`), added to
  the MCP tool list in `server.ts`; `browser-tools.ts` exports `requireTab`, `runInPage`, `sleep`.
- **Install (outside repo)** — whisper.cpp b5454 CUDA 12.4 + CPU builds and `ggml-large-v3-turbo-q5_0.bin` under
  `%LOCALAPPDATA%\opencode\whisper` (details in `spec.md`).
- Verification: `bun typecheck` clean in `packages/opencode` and `packages/desktop`; `test/tool/video-watch.test.ts`
  (timestamps, VTT/SRT parsing, chunking, frame selection, and an end-to-end run on an ffmpeg `testsrc` clip with an
  embedded SRT track) plus `view-images.test.ts`: 17 pass; desktop `agent-tools` tests: 31 pass.
  Not verified: Whisper transcription through the tool (running the downloaded binary was blocked by the session's
  permission check after one smoke run) and `browser_video_watch` against a live YouTube page.

## 2026-10-28 — Session info side panel

### Session info panel (app)
- New `packages/app/src/pages/session/session-info-panel.tsx`: a 300px right-hand panel of
  collapsible cards, shown on desktop widths for an open session. Toggle button added to the
  session header in both layouts (`components/session/session-header.tsx`, v1 header and
  `SessionHeaderV2Actions`), using the `layout-right` / `layout-right-full` icons.
- Open/closed state and each card's collapsed state persist per user in
  `Persist.global("session.info.v1")`. One shared state object (created once in a detached
  root, with the platform passed to `persisted` explicitly) backs both the header toggle and
  the panel.
- Cards: **Environment** (runs on this computer / WSL distro / remote server URL, project name,
  path, git branch from `vcs`), **Context** (the header meter's details: tokens used / limit,
  summary trigger, mode, TTFT trend + sparkline), **Changes** (+/- lines and file count from
  `session.summary`, falling back to `session_diff`; click opens the review panel).
- `components/session/session-context-meter.tsx`: split into `useContextMeter()` +
  `ContextMeterDetails` so the panel reuses the tooltip content; header meter unchanged.
- `pages/session.tsx`: the panel row is wrapped in a horizontal flex container with the info
  panel after it (wrapper intentionally not re-indented to keep the diff small for merges).
- Not built: **Servers** card (the desktop preload exposes no IPC for `preview_start` previews)
  and **Background tasks** card (no such data in the app). Outputs card and Create PR / Commit
  actions from todo #8 also not built.
- i18n: `session.info.*` keys in `en.ts` only.
- Verification: `bun typecheck` in `packages/app` passes; `bun test src/components/session
  src/pages/session` 101 pass, 2 files fail to load with a pre-existing solid-js `use` export
  error (same failure without these changes). Checked in the app dev server against a local
  backend: panel opens from the header, cards collapse, state survives reload.

## 2026-10-28 — Merged parallel feature branches and rebuilt the desktop app

- **git** — Merged `claude/interactive-visuals-0995d9` (#9), `claude/password-vault-5a7db7` (#5),
  `claude/video-watch-f68ed0` (#11) and `claude/session-info-panel-10bf04` (#8) into `collapse-settings`. Doc
  conflicts (`changelog.md`, `spec.md`) were resolved by union. One code conflict: the agent tool list in
  `packages/desktop/src/main/agent-tools/server.ts` now registers `browserSignInTool` and `videoTools` together.
- **docs** — `todo.md`: #5, #8, #9, #11 marked done.
- Verification: `bun typecheck` clean in `opencode`, `app`, `desktop` and `session-ui`. The new opencode tool tests
  pass (23). Desktop tests: 104 run, and the only failure is the pre-existing upstream `draft-store.test.ts`
  (`node:sqlite` is not available under Bun). `bun run build` + `bun run package` produced
  `packages/desktop/dist/opencode-desktop-win-x64.exe` (186 MB).
