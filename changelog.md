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
