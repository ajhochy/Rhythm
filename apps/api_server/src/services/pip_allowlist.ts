/**
 * pip_allowlist.ts — #876 (setup-06): the curated allowlist of PyPI packages
 * lazy_deps.ts is permitted to auto-install on a skill's first use.
 *
 * SECURITY (non-negotiable, per the issue): this list is a maintained,
 * code-reviewed file — additions require a PR, never a runtime config change.
 * A package NOT on this list is never installed automatically; the caller
 * gets a `FeatureUnavailable` with the exact manual `pip install` command
 * instead. Only bare PyPI package names are ever accepted (see
 * `isAllowedPackage` — no `git+https://`, no custom index URLs, no local
 * paths; `lazy_deps.ts` additionally rejects those forms at parse time before
 * this allowlist is even consulted, so this file only has to gate the name).
 *
 * Kept deliberately small: general-purpose, widely-used libraries with no
 * known history of supply-chain compromise as of this writing. Extend this
 * list only after review — see setup-07 (supply-chain advisory scanning) for
 * the follow-up that will continuously vet it.
 */

export const PIP_ALLOWLIST: readonly string[] = [
  'httpx',
  'requests',
  'pandas',
  'numpy',
  'pillow',
  'beautifulsoup4',
  'pyyaml',
  'python-dateutil',
  'markdown',
  'jinja2',
];

const ALLOWLIST_SET = new Set(PIP_ALLOWLIST.map((p) => p.toLowerCase()));

/** True iff `packageName` (case-insensitive) is on the curated allowlist. */
export function isAllowedPackage(packageName: string): boolean {
  return ALLOWLIST_SET.has(packageName.trim().toLowerCase());
}
