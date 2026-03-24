# src/client — agent notes

## App.tsx — state model

### Signal architecture
```
pkgInput  (draft)     — live text field value, updated on every keystroke
pkg       (committed) — updated only on "check" click via commitPkg()
cdn                   — 'jsdelivr' | 'esm.sh' | 'unpkg'
selectedExport        — '' (index) or export key string (e.g. 'jsx-runtime')
discoverData          — DiscoverResult | null — populated by handleMeasure
measuredInput / measuredCdn / measuredExport  — snapshot at last successful measurement
```

### Dirty flags
```
isDirty    = measuredInput===null || pkgInput!==measuredInput || cdn!==measuredCdn || selectedExport!==measuredExport
inputDirty = pkgInput !== pkg   (disables export dropdown when package text has changed)
```

### handleMeasure flow
1. `commitPkg()` → `pkg = pkgInput()`
2. **Discover skip:** if `discoverData()?.package === pkgName`, reuse existing data — do NOT call `setDiscoverData`. This keeps the `<For>`-rendered `<option>` list stable, preserving the controlled `<select>` value. Only fetch `/_discover` when switching to a new package.
3. `measurePackages(entries, cdn)` — runs iframe measurement
4. Fire-and-forget `/_record` POST with annotated resources
5. Batch-set `measuredInput/Cdn/Export/Entries/Resources`

### Export dropdown — SolidJS gotcha
`<select value={selectedExport()}>` relies on SolidJS reactively setting `el.value`.
When `<For each={discoverData()?.exports}>` re-renders (e.g. after `setDiscoverData(dr)`),
the DOM option list changes but the `value` prop effect does NOT re-run (signal unchanged).
This causes the visible selection to reset to the first option even though `selectedExport()`
still holds the correct value.

**Fix:** never call `setDiscoverData` for the same package — see discover skip above.

### Package-change effect
```typescript
createEffect(on(firstPkg, (pkgName) => {
  if (pkgName !== lastPkg) {
    lastPkg = pkgName;
    setSelectedExport('');    // reset export
    setDiscoverData(null);    // clear options
    setResources(null);
    setMeasuredEntries(null);
  }
}, { defer: true }));
```
Fires only when the base package name changes, not on every `pkg` signal update.

---

## components/Waterfall.tsx

Groups `ResourceTimingEntry[]` into rounds: consecutive resources whose `startTime`
difference > 5ms open a new round. Displays per-round bars on a shared timeline
(left/width % of total span). Shows totals: files, wire, parsed, round trips, duration.

---

## components/BundleHistory.tsx

Two-phase:
1. `/_versions/<pkg>` → version skeleton (hollow dots)
2. Click or "generate all" → `/_bundle/<pkg>@<ver>?cdn=...` per version

`onVersionClick` callback updates `pkgInput` in App.tsx (making inputs dirty).

---

## components/BadgeGenerator.tsx

Shows `/_banner/compact/`, `/_banner/standard/`, `/_banner/full/` preview images.
Copy-URL buttons. Dimmed when `isDirty()`.

---

## utils/measurement.ts

`measurePackages(entries, cdn)` — injects importmap + module script into srcdoc iframe,
waits for `load` event, reads `performance.getEntriesByType('resource')`, annotates
entries with pkg/version/exportKey. Returns `ResourceTimingEntry[]`.

`getBrowserInfo()` / `getConnectionInfo()` — navigator UA + connection type strings.

---

## CSS vars (style.css)
All colours: `--color-{bg|grid|text|text-muted|accent|border|border-light}`
`prefers-color-scheme:dark` overrides all `--color-*` vars.

## App.module.css key classes
`pkgInputWrap` `inputRow` `inputGroup` `cdnGroup` `exportGroup`
`pkgInput` `cdnSelect` `exportSelect`
`runBtn` `runBtnDirty` (glow anim when dirty) `revertBtn`
`resultsDimmed` (opacity 0.4 + pointer-events:none) `results` `error`
`spinnerWrap` `spinner`
