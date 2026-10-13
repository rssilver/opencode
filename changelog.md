# Changelog

This file records the changes made in this working session. It is separate from
the repo's own conventions (`AGENTS.md`) and translations. Each entry is dated
and grouped by area. See `spec.md` for repo documentation and a section on the
features added here.

## 2026-10-13 — General defaults, dark mode, collapse thinking blocks

### General settings enabled by default (app)
- Flipped all general toggles to `true` in `defaultSettings.general`:
  `showFileTree`, `showNavigation`, `showSearch`, `showStatus`, `showTerminal`,
  `showReasoningSummaries`, `shellToolPartsExpanded`, `showCustomAgents`.
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
