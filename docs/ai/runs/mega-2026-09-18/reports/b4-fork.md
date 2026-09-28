# Summary

Implemented a generic dashboard-plugin theme seam and shipped the Rhythm theme entirely inside `plugins/rhythm/`. Active plugins may now declare a validated relative CSS theme in `dashboard/manifest.json`; `/api/dashboard/themes` lists it, and the SPA applies it through `data-theme`, a same-origin stylesheet, local storage, and the existing server preference endpoint. The Rhythm package manifest includes the light/dark CSS asset and the deterministic builder copies it into staged packages.

The Python/plugin/package checks are green. Web typecheck and Vitest were attempted but could not start because the supplied `web/node_modules` symlink lacks `typescript`, `vitest`, and `jsdom`; no install was run. Browser/Playwright/axe checks remain for the orchestrator because this worker was explicitly forbidden from binding a server or running Playwright.

# Files changed

- `hermes_cli/web_server.py` — validates plugin theme declarations, shares active-plugin filtering, and adds contributed themes to `/api/dashboard/themes` without product-specific strings.
- `web/src/themes/context.tsx` — sets `data-theme`, loads only validated same-origin contributed stylesheets, clears conflicting inline variables, and preserves local/server preference behavior.
- `web/src/themes/types.ts` — adds the optional contributed-theme stylesheet field.
- `web/src/lib/api.ts` — adds the stylesheet field to the themes API response type.
- `web/src/themes/context.test.ts` — covers contributed CSS custom properties, `data-theme`, stylesheet injection, and persisted choice.
- `plugins/rhythm/dashboard/manifest.json` — declares the Rhythm dashboard theme.
- `plugins/rhythm/dashboard/theme/rhythm.css` — defines light and dark Rhythm custom-property overrides with AA-safe applied text/status colors.
- `plugins/rhythm/packaging/package-manifest.json` — includes the theme CSS in package assets and package-data coverage.
- `tests/plugins/rhythm/test_rhythm_dashboard_theme.py` — covers manifest/build inclusion, required tokens, endpoint discovery, served CSS, generic core, and unsafe-path rejection.
- `tests/plugins/rhythm/test_rhythm_packaging_scaffold.py` — updates the deterministic package-data contract and keeps the unmatched-pattern negative test meaningful.
- `REPORT.md` — records this worker handoff and the orchestrator-only visual gate.

# Checks run

- PASS — `/Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m pytest tests/plugins/rhythm/test_rhythm_dashboard_theme.py -q`
  - Tail: `5 passed in 5.25s`
- PASS — `scripts/run_tests.sh tests/hermes_cli/test_web_server.py -k 'Theme or TestDashboardPluginManifestExtensions' -q`
  - Tail: `13 tests passed, 0 failed`
- PASS — `/Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m pytest tests/plugins/rhythm/test_rhythm_packaging_scaffold.py -q`
  - Tail: `61 passed in 6.90s`
- PASS — `/Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m pytest tests/plugins/rhythm -q`
  - Tail: `282 passed in 66.52s (0:01:06)`
- PASS — `theme_stage=$(mktemp -d /tmp/rhythm-theme-package.XXXXXX); /Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m plugins.rhythm.packaging.build --output "$theme_stage"`
  - Tail: `Validated package: /private/tmp/rhythm-theme-package.rLVcDn`; staged `dashboard/theme/rhythm.css` was 3542 bytes.
- PASS — `/Users/ajhochhalter/.hermes/hermes-agent/venv/bin/python -m py_compile hermes_cli/web_server.py`
  - Tail: exit 0.
- PASS — from `web/`: `node -e "const fs=require('fs'); const p=require('@babel/parser'); for (const f of ['src/themes/context.tsx','src/themes/types.ts','src/themes/context.test.ts','src/lib/api.ts']) { p.parse(fs.readFileSync(f,'utf8'), {sourceType:'module',plugins:['typescript', ...(f.endsWith('.tsx')?['jsx']:[])]}); console.log('parsed '+f); }"`
  - Tail: `parsed src/lib/api.ts` after all four changed TS/TSX files parsed.
- PASS — `node -e "const lum=h=>{const a=h.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*a[0]+.7152*a[1]+.0722*a[2]}; const cr=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return ((x+.05)/(y+.05)).toFixed(2)}; for(const [n,a,b] of [['light primary','#4E69F2','#FFFFFF'],['light secondary','#6B7280','#FFFFFF'],['light error','#DC2626','#FFFFFF'],['light success','#047857','#FFFFFF'],['dark text','#F9FAFB','#111827'],['dark secondary','#D1D5DB','#111827'],['dark primary','#8EA0FF','#111827'],['dark error','#F87171','#111827'],['dark success','#34D399','#111827']]) console.log(n+': '+cr(a,b)+':1')"`
  - Tail: light mappings were 4.54:1–5.48:1; dark mappings were 6.41:1–16.98:1.
- FAIL (environment) — `cd web && npm run typecheck`
  - Tail: `sh: tsc: command not found` (exit 127). `web/node_modules/.bin` contains only `parser` and `semver`.
- FAIL (environment) — `cd web && npm run test`
  - Tail: `sh: vitest: command not found` (exit 127). No dependency installation was permitted.
- PASS — `git diff --check`
  - Tail: no output.

Orchestrator gate steps (do not skip any of the six light/dark viewport combinations):

1. With complete workspace dependencies, run `cd web && npm run typecheck && npm run test && npm run build`.
2. From the worktree root, launch exactly `hermes dashboard --port 9122`; confirm the current branch is `mega/2026-09-18-dashboard-theme-seam` before opening `http://127.0.0.1:9122`.
3. In the dashboard, open the accessible **Switch theme** control, choose the **Rhythm** option, reload, and confirm it remains selected. Assert `document.documentElement.dataset.theme === "rhythm"` and that `link[data-hermes-theme-stylesheet]` ends with `/dashboard-plugins/rhythm/theme/rhythm.css`.
4. Run the rendered pass at 1440x900, 1024x768, and 390x844 for both `prefers-color-scheme: light` and `prefers-color-scheme: dark`. At every combination, capture a screenshot and assert the main canvas, sidebar, cards, text hierarchy, border, primary control, error/success state, and visible focus ring use the Rhythm palette without clipping or horizontal document overflow.
5. At every viewport/scheme combination, repeat at 200% browser zoom. Confirm controls and accessible names remain visible, primary hit targets are at least 44x44 CSS px, scrollable regions are keyboard-focusable or contain focusable content, and the theme switcher remains operable by keyboard.
6. At 1440x900 in both color schemes and at 200% zoom, set `document.documentElement.dir = "rtl"`; confirm sidebar/navigation order mirrors without clipped labels and theme-control accessible names remain intact.
7. Run axe after the page settles in all six viewport/scheme combinations and again for both RTL checks. Require zero serious/critical violations and specifically zero `scrollable-region-focusable`, `nested-interactive`, `aria-prohibited-attr`, `color-contrast`, and `target-size` violations.
8. Verify computed custom properties, not only source text: light `--rhythm-primary: #4F6AF5`, sidebar `#F8F9FA`, border `#E5E7EB`; dark canvas `#111827`, sidebar `#1F2937`, primary `#8EA0FF`; then switch to a built-in theme and confirm the contributed stylesheet is removed and no Rhythm variables continue to control the rendered colors.

# Acceptance criteria

- Generic seam — done. Active dashboard plugins contribute validated, same-origin CSS themes; the endpoint lists them; the SPA selects via `data-theme` and persists through local storage plus the existing `PUT /api/dashboard/theme` call. Core changed files contain no `Rhythm` string.
- Rhythm theme — done. The feature pack owns the manifest entry and CSS, includes every requested base hue, provides an automatic dark variant on `#111827`-family surfaces, and maps rendered text/status aliases to AA-safe contrasts.
- Tests — partial. The requested Python and web unit tests were written; all Python coverage passed, while the web test could not execute because the supplied dependency link is incomplete. The changed TS/TSX files passed parser-level syntax validation.
- Package rebuild — done. A fresh temporary package built and validated with the theme present; repository `dist/` remained untouched/untracked.
- Socket-free self-check — partial. Python suites, package build, syntax parsing, contrast calculations, and `git diff --check` passed; web typecheck/Vitest were blocked before compilation by missing executables.
- Rendered accessibility gate — not done in this worker by explicit brief constraint; exact orchestrator steps are above.

# Decisions

- Used the existing `dashboard/manifest.json` as the dashboard-plugin manifest equivalent instead of widening the unrelated native `plugin.yaml` parser.
- Returned only a server-constructed `/dashboard-plugins/.../*.css` URL and rejected absolute, traversing, missing, non-CSS, or invalidly named declarations; arbitrary stylesheet URLs were rejected.
- Loaded contributed CSS only for the selected theme and cleared prior inline theme variables so `prefers-color-scheme` media queries remain live; rejected loading every plugin theme globally.
- Preserved requested palette hex values as Rhythm base tokens while using minimally adjusted applied aliases where the exact value would fail 4.5:1 text contrast on light surfaces.
- Reused the existing server-side dashboard theme preference endpoint and local-storage flash avoidance; rejected a second persistence mechanism.
- Kept the package build in a fresh temporary directory; rejected tracked/generated `dist/` changes.

# Follow-ups

- Orchestrator: restore/use a complete Node workspace install, then run the web typecheck, Vitest, production build, and the rendered/axe gate above.
- No adjacent product bugs were changed.

# Needs a human

None.
