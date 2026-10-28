# Bugs (working session)

Open / deferred bugs discovered during this working session (originally on branch
`custom-collapsible-thinking`, now rebuilt as `collapse-settings`). Tracked here
separately from [`changelog.md`](./changelog.md) so the change record stays focused
on shipped behavior. Each entry has a status and next steps.

## Select dropdown selection does not stick (both collapse settings)

**Status:** open, cause unknown. Needs to be reproduced in the running app on
`collapse-settings`; it may already be gone, since the timeline no longer remounts
rows on every update.

**Reproduce:** In General settings, open the shell (or thinking) *collapse*
dropdown and pick an option. The choice is not shown as selected and the dropdown
cannot be reopened until the settings menu is left and re-entered.

**Affected:** `packages/app/src/components/settings-general.tsx`,
`packages/app/src/components/settings-v2/general.tsx`.

**Earlier diagnosis was likely wrong:** it blamed `packages/ui/src/components/select.tsx`
for passing the option object as Kobalte's `value`. Kobalte's `value` is typed as the
option itself (with `optionValue` deriving its key), and the colour-scheme dropdown on
the same page uses the identical pattern and works. Do not apply the "pass the string
key" change.

**Update 2026-10-27:** not reproducible on `collapse-settings`. Selections stick and the menu reopens
(checked live in the app dev server).

**Leads to check:** what re-renders when a collapse setting changes. Changing a
collapse setting recomputes the whole timeline behind the dialog. On the old branch,
that remounted every timeline row (see the "No remounts" note in `spec.md`), which may
have blocked or reset the dropdown mid-close.

## "Thinking" stays on screen after the turn has finished (upstream)

**Status:** open, pre-existing upstream behavior (also seen by the user outside this branch).

**Reproduce:** In the app, send a prompt that triggers an automatic summary (compaction) in a session
on the legacy V1 engine. The backend finishes the turn (`exiting` in the server log), but the session
keeps showing "Thinking" and no answer until the page is reloaded. After a reload, the summary and the
final answer are both there.

**Seen:** 2026-10-27 with LM Studio (`cyber-tiel-coder-35b-a3b-mtp`), session `ses_e8027c8b5ffeWurnb20RAQW3WM`.

**Leads to check:** whether the compaction step's messages and the follow-up answer are published on the
event stream the app listens to (v2 `/api/event`), and whether the session status returns to idle in the
app's store after a compaction run.

**Update 2026-10-28 (static read, not reproduced):** the timeline renders from the V2 projection
(`data.session_message`, `message-timeline.tsx:382`), built by `server-session-v2-reducer.ts` from
`session.*` V2 events. The V1 engine's compaction (`packages/opencode/src/session/compaction.ts`) only writes V1
messages/parts (`session.updateMessage` / `updatePart` → `message.updated` events, handled by
`global-sync/event-reducer.ts`) and publishes `Event.Compacted`. It never emits `session.compaction.*` or new
`session.step.*` events for the follow-up turn. Likely cause: after compaction, the V2 projection stops advancing
for a V1 session until a reload refetches it. Next step: reproduce with a small `compaction` threshold, then log
which event types reach `applyV2` after `session.compacted`. Server-side status (`processor.ts` / `run-state.ts`)
looks correct.

**Update 2026-10-28 (live test):** ruled out the plain "summarize + auto-continue" path. With LM Studio, `POST
/session/:id/summarize {auto: true}` on a session open in the app: the server emits every message/part, ends
`idle`, and the app updates live (summary, continuation and answer all shown, no stuck "Thinking"). The
remaining suspect is the **overflow-triggered** path: `processor.ts` `halt()` sets `ctx.needsCompaction` and
publishes `Session.Event.Error` (ContextOverflow) mid-turn, then `prompt.ts` runs compaction inside the loop.
Check what the app does with that `session.error` and the errored assistant message (e.g. `rows.ts` `error`
handling, or a status/turn that never clears). Repro needs a tiny context limit (model `limit.context`, or a
low summary threshold) so a normal prompt overflows. Trace script: scratchpad `repro/trace.ts` pattern (SSE
`/event` + `prompt_async` + `summarize`).

**Update 2026-10-28 (soft auto-compaction, live in the app):** not reproducible on `collapse-settings`. Backend
run with `OPENCODE_CONFIG_CONTENT='{"compaction":{"threshold":0.5},"provider":{"lmstudio":{"models":{"tiel-coder-35b-a3b":{"limit":{"context":24000,"output":4000}}}}}}'`
so the next prompt auto-compacted. The app showed the summary and the answer live, and went idle. Side note: custom
LM Studio models with no `limit.context` never auto-compact (`isOverflow` returns false for context 0). Still open
only for the hard-overflow path, i.e. a provider context-length error mid-turn.

## `read` test "normalizes read permission paths on Windows" fails (pre-existing)

**Status:** open, not caused by this branch (fails with this branch's tool changes reverted).

**Reproduce:** from `packages/opencode`, `bun test test/tool/read.test.ts -t "normalizes read permission paths on Windows"`.
Fails with `File not found: E:\users\roses\appdata\local\temp\...\test.txt`: the path is lower-cased
before the file is opened, which breaks on a temp folder whose real path has upper-case segments.

## Compaction test "anchors repeated compactions with the previous summary" times out under load

**Status:** open, timing flake. Passes when run alone (3/3), fails with a 5 s timeout (≈5.4 s) when run in the
same `bun test` invocation as other test files. Not yet compared against `dev`, so it may or may not predate
this branch. Fix options: raise that test's timeout, or find what makes it slow when other files run first.

## Browser panel reports `canGoBack: false` after a link click

**Status:** open, minor. After the agent clicked a link (example.com → iana.org) in the same tab, the panel
state still had `canGoBack: false`. Likely `sync()` runs on `did-navigate` before Electron's navigation
history updates; re-sync on `did-stop-loading` / `did-finish-load` or read history lazily.
