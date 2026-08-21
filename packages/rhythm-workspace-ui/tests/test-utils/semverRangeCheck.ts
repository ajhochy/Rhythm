// A minimal, scope-limited semver check: this package's peer range is always an
// OR-of-caret-ranges (e.g. "^18.3.1 || ^19.2.0"), so a full semver engine is unneeded —
// this only needs to answer "does this exact version satisfy that specific shape."

function parse(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`not a plain semver version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function satisfiesCaret(version: string, caretRange: string): boolean {
  const range = caretRange.trim();
  if (!range.startsWith('^')) throw new Error(`only caret ranges are supported, got: ${range}`);
  const [rMajor, rMinor, rPatch] = parse(range.slice(1));
  const [vMajor, vMinor, vPatch] = parse(version);
  if (vMajor !== rMajor) return false;
  if (vMinor > rMinor) return true;
  if (vMinor < rMinor) return false;
  return vPatch >= rPatch;
}

function satisfies(version: string, orRange: string): boolean {
  return orRange.split('||').some((part) => satisfiesCaret(version, part));
}

export default { satisfies };
