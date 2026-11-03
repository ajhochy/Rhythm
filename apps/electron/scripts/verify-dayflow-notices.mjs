#!/usr/bin/env node
// Independent, read-only check that the staged Dayflow legal payload physically contains every
// expected notice with the hash its manifest promises. No network, writes, launches, or defaults:
// the caller names the legal directory explicitly.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const DEPENDENCIES = ['grdb.swift', 'networkimage', 'posthog-ios', 'sentry-cocoa', 'sparkle', 'swift-cmark', 'swift-markdown-ui'];
const FONTS = ['figtree', 'instrumentserif', 'nunito'];
const FONT_MARKER = 'Google Fonts official family notice';
const LIMITATION = 'license-payload-integrity verified; legal clearance and font binary revision mapping are not established';
const DAYFLOW_LICENSE = `MIT License Copyright (c) 2025 Jerry Liu Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions: The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY
OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function checkEntry(entry, seen) {
  const { name, file, url, sourceRevision, sha256: hash } = entry ?? {};
  if (typeof name !== 'string' || !(DEPENDENCIES.includes(name) || FONTS.includes(name))) {
    throw new Error(`unexpected entry name ${JSON.stringify(name)}`);
  }
  if (seen.has(name)) throw new Error(`duplicate entry ${name}`);
  seen.add(name);
  // Only the exact basename is accepted, so no separator, `..`, or absolute path can reach open().
  if (file !== `LICENSE-${name}.txt`) throw new Error(`${name}: file must be LICENSE-${name}.txt`);
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error(`${name}: sha256 must be 64 lowercase hex`);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name}: url is not a URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.host !== 'raw.githubusercontent.com' || parsed.username
    || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name}: url must be a public https://raw.githubusercontent.com/ path`);
  }
  if (FONTS.includes(name)) {
    if (sourceRevision !== FONT_MARKER) throw new Error(`${name}: font sourceRevision must be "${FONT_MARKER}"`);
    if (url !== `https://raw.githubusercontent.com/google/fonts/main/ofl/${name}/OFL.txt`) {
      throw new Error(`${name}: url must be the official google/fonts OFL notice`);
    }
    return 'font';
  }
  if (typeof sourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(sourceRevision)) {
    throw new Error(`${name}: dependency sourceRevision must be a 40-hex commit`);
  }
  if (!parsed.pathname.includes(`/${sourceRevision}/`)) throw new Error(`${name}: url must be pinned to sourceRevision`);
  return 'dependency';
}

/** Verifies the notice payload in `legalRoot`; throws on the first violation. */
export async function verifyDayflowNotices({ legalRoot } = {}) {
  if (typeof legalRoot !== 'string' || !isAbsolute(legalRoot)) throw new Error('legalRoot must be an absolute path');
  const root = resolve(legalRoot);
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat) throw new Error(`legalRoot not found: ${root}`);
  if (rootStat.isSymbolicLink()) throw new Error('legalRoot must not be a symlink');
  if (!rootStat.isDirectory()) throw new Error('legalRoot must be a directory');

  let bytesRead = 0;
  // O_NOFOLLOW rejects a symlinked final component, so nothing can redirect outside `root`.
  // O_NONBLOCK keeps open() from waiting on a FIFO writer; fstat then rejects it before any read.
  async function readRegular(basename, maxBytes = MAX_TOTAL_BYTES) {
    let handle;
    try {
      handle = await open(resolve(root, basename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      throw new Error(`${basename}: ${error.code === 'ELOOP' ? 'symlink rejected' : error.code ?? error.message}`);
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`${basename} must be a regular file`);
      const { size } = stat;
      const limit = Math.min(maxBytes, MAX_TOTAL_BYTES - bytesRead);
      if (size > limit) throw new Error(`${basename} exceeds read limit (${limit} bytes left)`);
      const buffer = Buffer.alloc(size + 1);
      const { bytesRead: count } = await handle.read(buffer, 0, size + 1, 0);
      if (count > size) throw new Error(`${basename} changed while reading`);
      bytesRead += count;
      return buffer.subarray(0, count);
    } finally {
      await handle.close();
    }
  }

  let manifest;
  try {
    manifest = JSON.parse((await readRegular('notice-sources.json', MAX_MANIFEST_BYTES)).toString('utf8'));
  } catch (error) {
    throw error instanceof SyntaxError ? new Error(`notice-sources.json: corrupt manifest (${error.message})`) : error;
  }
  const expected = DEPENDENCIES.length + FONTS.length;
  if (!Array.isArray(manifest)) throw new Error('notice-sources.json: manifest must be an array');
  const seen = new Set();
  const kinds = manifest.map((entry) => checkEntry(entry, seen));
  if (manifest.length !== expected) throw new Error(`notice-sources.json: expected ${expected} entries, found ${manifest.length}`);

  const inventory = [];
  for (const [index, entry] of manifest.entries()) {
    const content = await readRegular(entry.file);
    if (content.length === 0) throw new Error(`${entry.file} is empty`);
    const actual = sha256(content);
    if (actual !== entry.sha256) throw new Error(`sha256 mismatch for ${entry.name}: manifest ${entry.sha256}, file ${actual}`);
    inventory.push({ name: entry.name, kind: kinds[index], file: entry.file, sha256: actual, bytes: content.length, sourceRevision: entry.sourceRevision });
  }

  const license = await readRegular('LICENSE');
  if (normalize(license.toString('utf8')) !== normalize(DAYFLOW_LICENSE)) {
    throw new Error('Dayflow LICENSE is not the full MIT text with "Copyright (c) 2025 Jerry Liu"');
  }

  return {
    ok: true,
    legalRoot: root,
    dayflowLicense: { file: 'LICENSE', sha256: sha256(license), bytes: license.length },
    inventory,
    bytesRead,
    limitation: LIMITATION,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('usage: verify-dayflow-notices.mjs <absolute legalRoot>');
    console.log(JSON.stringify(await verifyDayflowNotices({ legalRoot: process.argv[2] }), null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
