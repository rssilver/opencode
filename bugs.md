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

**Leads to check:** what re-renders when a collapse setting changes. Changing a
collapse setting recomputes the whole timeline behind the dialog. On the old branch,
that remounted every timeline row (see the "No remounts" note in `spec.md`), which may
have blocked or reset the dropdown mid-close.
