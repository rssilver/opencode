# Bugs (working session)

Open / deferred bugs discovered during this working session on branch
`custom-collapsible-thinking`. Tracked here separately from
[`changelog.md`](./changelog.md) so the change record stays focused on shipped
behavior. Each entry has status and a proposed fix.

## Select dropdown selection does not stick (both collapse settings)

**Status:** deferred — the intended default (`once-complete`) applies regardless,
so users get the desired behavior without needing to select it.

**Reproduce:** In General settings, open the shell (or thinking) *collapse*
dropdown and pick an option. The choice is not shown as selected and the dropdown
cannot be reopened until the settings menu is left and re-entered.

**Affected:** `packages/app/src/components/settings-general.tsx`,
`packages/app/src/components/settings-v2/general.tsx`. Both share the same wrapper,
so both are affected identically.

**Root cause:** `packages/ui/src/components/select.tsx` passes the whole option
object to Kobalte as `value={local.current}` while also supplying `optionValue`,
which derives a string key per item. In controlled mode Kobalte compares its stored
value against those keys, so an object never reconciles after `onChange`; the
selected state and open flag get stuck until the component remounts (leaving
settings).

**Why uncaught:** no test drives an actual selection interaction on this Select, and
typecheck passes because the option-object shape is structurally valid.

**Proposed fix:** pass the `optionValue`-derived string as the controlled `value`
instead of the option object:

```ts
value={local.current ? (local.value ? local.value(local.current) : String(local.current)) : undefined}
```

Add a regression test that renders the Select in happydom and asserts the selected
option persists across re-renders after selection.
