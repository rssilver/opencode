# Spec — opencode

Documentation for this repository, kept for local use. It covers repo layout at
a high level and records the features added during this working session. See
[`changelog.md`](./changelog.md) for the dated change record; the parent-repo
conventions live in [`AGENTS.md`](./AGENTS.md).

## Repository overview

`opencode` is a monorepo (managed with Bun workspaces) that powers an AI coding
assistant across web, desktop (Electron), and TUI surfaces. Packages include:

- `packages/core` — SDK, schema (Drizzle/Effect), plugin/model config, database.
- `packages/opencode` — server + provider layer; resolves model capabilities
  from declared `modalities`.
- `packages/app` — SolidJS web app / settings UI (`src/components/settings-*`,
  `src/context/settings.tsx`).
- `packages/desktop` — Electron wrapper; builds with `electron-vite build` and
  packages with `electron-builder` (NSIS installer → `packages/desktop/dist`).
- `packages/session-ui` — shared message/timeline rendering, including tool and
  reasoning part display (`src/components/message-part.tsx`, `session-turn.tsx`).
- `packages/ui` — design-system components (theme, collapsible, icon, i18n).

### Settings architecture

General settings live in `packages/app/src/context/settings.tsx`
(`defaultSettings.general`) with getters/setters. There are **two** settings
surfaces that both read the same store:

- v1 — `packages/app/src/components/settings-general.tsx` (`SettingsGeneral`).
- v2 (new layout) — `packages/app/src/components/settings-v2/general.tsx`
  (`SettingsGeneralV2`).

Image input is gated on a model's declared capabilities. In
`packages/opencode/src/provider/provider.ts`, `capabilities.input.image` is
derived from the model's `modalities.input` array:

```ts
image: model.modalities?.input?.includes("image") ?? false,
```

If `"image"` is not listed in `modalities.input`, the model is treated as
text-only and attachments are rejected. A model only supports images when its
config explicitly declares them (e.g. `cyber-tiel-coder-35b-a3b-mtp`,
`gemma-4-31b-it-uncensored-heretic`).

### Reasoning / thinking block rendering

Reasoning parts render through `PART_MAPPING["reasoning"]` in
`packages/session-ui/src/components/message-part.tsx` (`ReasoningPartDisplay`).
Both the v2 timeline (`message-timeline.tsx`) and the share page (via
`session-turn.tsx` → `AssistantParts`) route part rendering through the shared
`Part` component, so collapse behavior is centralized there.

## Features added this session

### `collapseThinkingBlocks` general setting

New setting with three modes: `"yes"`, `"once-complete"` (default), `"no"`.

- **UI:** a dropdown in **General settings** on both surfaces —
  `packages/app/src/components/settings-general.tsx` and
  `packages/app/src/components/settings-v2/general.tsx` (`CollapseThinkingBlocksSetting`).
- **Store:** field + default + setter in `defaultSettings.general`,
  `packages/app/src/context/settings.tsx`. Type: `ThinkingCollapseMode`
  (`"yes" | "once-complete" | "no"`), defined and exported from
  `packages/session-ui/src/components/message-part.tsx`.
- **i18n:** keys in all 62 locale files —
  `settings.general.row.collapseThinkingBlocks.title/.description`, plus
   `.option.yes`, `.option.onceComplete`, `.option.no` (English placeholders).

### `collapseShellTools` general setting

Replaces the boolean `shellToolPartsExpanded`. Same three modes: `"yes"`,
`"once-complete"` (default), `"no"`, backed by the same `ThinkingCollapseMode`
type.

- **UI:** a dropdown in **General settings** on both surfaces, mirroring the
  thinking setting (`settings-general.tsx`; `CollapseShellToolsSetting` in
  `packages/app/src/components/settings-v2/general.tsx`).
- **Store:** field + default (`"once-complete"`) + setter in
  `defaultSettings.general`, `packages/app/src/context/settings.tsx`. The getter
  reads the persisted setting; if it is unset and the legacy boolean
  `shellToolPartsExpanded` is `true`, it maps to `"no"` (always expanded), otherwise
  it falls back to `"once-complete"`. This keeps existing users' "expanded" choice and
  the e2e fixtures that still set the legacy key.
- **i18n:** English keys in `en.ts`, mirrored as English placeholders in the other
  61 locale files (required by `parity.test.ts`; awaiting real translations) —
  `settings.general.row.collapseShellTools.title/.description`, plus `.option.yes`,
  `.option.onceComplete`, `.option.no`.

Behavior by mode for shell/tool parts:

- `yes`: always collapsed.
- `once-complete`: the part stays open only while its tool call is still
  running/pending; it collapses as soon as that call completes or errors.
- `no`: always expanded.
- A manual expand/collapse is respected and sticks — the v2 timeline persists the
  choice in its per-part `toolOpen` store, so the mode governs open state only
  before the user first interacts with a part.

Wiring: `partDefaultOpen` (`packages/session-ui/src/components/part-default-open.ts`)
now takes a collapse mode instead of a boolean; shell/bash parts return true while
`state.status` is pending/running under `once-complete`. The active v2 timeline
reads `settings.general.collapseShellTools` in
`packages/app/src/pages/session/timeline/message-timeline.tsx`, where the reactive
default feeds the controlled tool-open state.

### Collapsible reasoning blocks

Reasoning/thinking blocks now render as collapsible accordions, mirroring how
tool calls collapse. Behavior:

- `yes`: always collapsed.
- `once-complete`: the current block stays open only while the turn is still
  streaming; once thinking stops it collapses too (earlier blocks stay
  collapsed). Implemented by defaulting a part's open state to its message's
  streaming status.
- `no`: always expanded.
- A manual expand/collapse is respected and sticks (user override over the
  computed default).

Wiring: `ThinkingCollapseMode` is threaded via `MessagePartProps` through
`Part`, `AssistantParts`, `AssistantMessageDisplay`, and `Message` in
`packages/session-ui/src/components/message-part.tsx`. The v2 timeline passes the
setting from `settings.general.collapseThinkingBlocks` in
`packages/app/src/pages/session/timeline/message-timeline.tsx`.

**Streaming thinking panel.** While its message streams, the reasoning part is
sticky and its `reasoning-scroll-box` is height-bounded (`min(60vh, 520px)`) with a
thin native scrollbar in theme colors. When streaming ends only the CSS bound is
lifted — the same `PacedMarkdown` instance stays mounted, so the text is never
re-rendered from scratch. Auto-follow uses a `ResizeObserver` on the content: the box
scrolls to the bottom only when content grows and the user is within 24px of the
bottom. No timers run, so pauses in the stream don't touch the scroll position.

### Collapsible arrow UX fix

The thinking-block chevron uses a single `chevron-right` glyph for both states,
rotated to point down when open (`data-open="true"`, rotate 90°), sized
with `size="small"` to match the label, and RTL-safe (`:dir(rtl)` flips the
rotation) in `packages/session-ui/src/components/message-part.css`. This fixed a
mismatch where the right chevron looked larger than the down one and was
off-center / too big.

### Other session changes

- **Dark mode default:** new installs start in dark mode — color-scheme fallback
  changed from `"system"` to `"dark"` in `packages/ui/src/theme/context.tsx`.
- **General toggles enabled by default:** `showFileTree`, `showNavigation`,
  `showSearch`, `showStatus`, `showTerminal`, `showReasoningSummaries`,
  `collapseShellTools`, `showCustomAgents` set to `true` in
  `defaultSettings.general`; `editToolPartsExpanded` left `false`. (`collapseShellTools`
   defaults to `"once-complete"` rather than a boolean.)

### `collapseWorkingSections` — "Worked for X" supersection (app)

Collapses everything between/around visible responses into collapsible groups so only the most
recent responses stay open. Driven by `buildDisplayRows` in
`packages/app/src/pages/session/timeline/working-sections.ts`.

- **Visible responses:** between user messages, each turn (`userMessageID`) keeps its **first** and
  **latest** text answer visible, plus any response flagged `persist`. Middle answers fold into the turn's
  "Worked for…" groups together with thinking and tool calls (shell, read, explore, ...).
- **No ghost sections:** `TurnGap` spacer rows (inserted before each turn by the projection,
  `rows.ts`) are filtered out up front so spacers can never become empty groups or shift section
  keys/content.
- **Persistent toggle:** the summary header is always emitted as a row; expanded sections additionally
  reveal their child rows inline after it (`flushRun`), so expand/collapse never disappears.
- **Distinct durations:** each section sums a per-row contribution keyed by assistant message instead
  of deduping by user-message id, so consecutive "Worked for X" labels differ. `message-timeline.tsx`
  supplies the resolver via `partMessageDurationMs`, which maps each `AssistantPart` to its own
  assistant message (`time.created`/`time.completed`) and contributes only that response's span;
  repeated parts of one message count once, and pure-thinking sections show the generic label.
- **Fold as you go:** while a turn runs, finished work folds immediately; only unfinished rows stay
  inline (`isUnfinished` → `rowIsUnfinished` in `message-timeline.tsx`): a tool part that is pending or
  running, text/thinking of an incomplete assistant message without `time.end`, and status rows (thinking
  indicator, retry, error) of a running turn. A turn counts as running while the session is busy on it or
  any of its assistant messages lacks `time.completed` (`turnInProgress`), since status can read idle
  between provider steps.
- **Stable section keys:** a section is keyed by its first row only, so a section that grows while its
  turn runs keeps its key and its expanded/collapsed state.
- **No remounts:** `displayRows()` builds new wrapper objects on every streamed token.
  `VirtualTimelineRow` unwraps them to the projection's own stable row object and switches between
  the section header and the row with two `<Show>`s, so rows update in place instead of remounting
  (remounting re-rendered their markdown from scratch and caused flicker).
- **Label:** compact duration via `formatCompactDuration` in `packages/app/src/utils/time.ts`.
- **Placement/UX:** disclosure chevron sits to the right of the label (inline `transform`, RTL-aware
  via `document.documentElement.dir`); the outer wrapper uses `pt-3` for top spacing.

## Verification

- `session-ui` and `app` typecheck pass (only the pre-existing, unrelated
  `packages/app/src/custom-elements.d.ts` error remains).
- `i18n parity`: 5/5; `session-ui` component tests: 65/65.
- Desktop rebuilt with `electron-vite build` and packed to an NSIS installer at
  `packages/desktop/dist/opencode-desktop-win-x64.exe`.
