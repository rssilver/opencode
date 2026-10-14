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
