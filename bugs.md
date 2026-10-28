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

## `read` test "normalizes read permission paths on Windows" fails (pre-existing)

**Status:** open, not caused by this branch (fails with this branch's tool changes reverted).

**Reproduce:** from `packages/opencode`, `bun test test/tool/read.test.ts -t "normalizes read permission paths on Windows"`.
Fails with `File not found: E:\users\roses\appdata\local\temp\...\test.txt`: the path is lower-cased
before the file is opened, which breaks on a temp folder whose real path has upper-case segments.
