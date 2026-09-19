import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildRhythmIcns, stageRhythmIcon } from '../scripts/package-mac.mjs';

const run = promisify(execFile);
const artwork = resolve(import.meta.dirname, '../../desktop_flutter/macos/Runner/Assets.xcassets/AppIcon.appiconset');
const iconutil = spawnSync('iconutil', ['--help']);
const skipNative = iconutil.error?.code === 'ENOENT' ? 'iconutil unavailable; macOS icon assembly requires Apple iconutil' : false;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const standardNames = [
  'icon_16x16.png', 'icon_16x16@2x.png', 'icon_32x32.png', 'icon_32x32@2x.png',
  'icon_128x128.png', 'icon_128x128@2x.png', 'icon_256x256.png', 'icon_256x256@2x.png',
  'icon_512x512.png', 'icon_512x512@2x.png',
];

async function temporary(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'rhythm-icon-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('Rhythm icon: assembly maps every source slot and inventories the converter output', async (t) => {
  const outDir = await temporary(t);
  const contents = JSON.parse(await readFile(resolve(artwork, 'Contents.json'), 'utf8'));
  let converted;
  const result = await buildRhythmIcns({ appiconsetDir: artwork, outDir, run: async (command, args) => {
    assert.equal(command, 'iconutil');
    assert.equal(args[0], '-c'); assert.equal(args[1], 'icns'); assert.equal(args[3], '-o');
    assert.deepEqual((await readdir(args[2])).sort(), [...standardNames].sort());
    for (const entry of contents.images) {
      const name = `icon_${entry.size}${entry.scale === '2x' ? '@2x' : ''}.png`;
      assert.deepEqual(await readFile(resolve(args[2], name)), await readFile(resolve(artwork, entry.filename)));
    }
    // Fake only the external converter boundary; real iconutil coverage follows below.
    const png = await readFile(resolve(args[2], 'icon_512x512@2x.png'));
    const header = Buffer.alloc(16);
    header.write('icns'); header.writeUInt32BE(png.length + 16, 4);
    header.write('ic10', 8); header.writeUInt32BE(png.length + 8, 12);
    converted = Buffer.concat([header, png]);
    await writeFile(args[4], converted);
  } });
  assert.deepEqual(await readFile(result.iconPath), converted);
  const inventory = JSON.parse(await readFile(result.inventoryPath, 'utf8'));
  assert.equal(inventory.sha256, hash(converted));
  assert.deepEqual(inventory.images.map((image) => image.iconsetName), standardNames);
  for (const image of inventory.images) assert.equal(image.sha256, hash(await readFile(resolve(artwork, image.source))));
  assert.deepEqual((await readdir(outDir)).sort(), ['Rhythm.icns', 'Rhythm.icns.json']);
});

for (const hasIconName of [true, false]) test(`Rhythm icon: staged plist and artwork identity (IconName=${hasIconName})`, { skip: skipNative }, async (t) => {
  const root = await temporary(t);
  const resources = resolve(root, 'Contents/Resources');
  const infoPlist = resolve(root, 'Contents/Info.plist');
  await mkdir(resources, { recursive: true });
  await writeFile(resolve(resources, 'electron.icns'), 'upstream icon');
  await writeFile(infoPlist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIconFile</key><string>electron.icns</string>${hasIconName ? '<key>CFBundleIconName</key><string>electron</string>' : ''}</dict></plist>`);
  const result = await stageRhythmIcon({ appiconsetDir: artwork, resources, infoPlist, run: async (command, args) => {
    if (command === 'iconutil') assert.deepEqual((await readdir(args[2])).sort(), [...standardNames].sort());
    return run(command, args);
  } });
  const plist = JSON.parse((await run('plutil', ['-convert', 'json', '-o', '-', infoPlist])).stdout);
  assert.equal(plist.CFBundleIconFile, 'Rhythm');
  assert.equal(plist.CFBundleIconName, hasIconName ? 'Rhythm' : undefined);
  assert.equal(result.iconPath, resolve(resources, `${plist.CFBundleIconFile}.icns`));
  const inventory = JSON.parse(await readFile(result.inventoryPath, 'utf8'));
  assert.equal(inventory.icon, 'Rhythm.icns');
  assert.equal(inventory.sha256, hash(await readFile(result.iconPath)));
  assert.deepEqual(inventory.images.map((image) => image.iconsetName), standardNames);
  const contents = JSON.parse(await readFile(resolve(artwork, 'Contents.json'), 'utf8'));
  const retina = contents.images.find((image) => image.size === '512x512' && image.scale === '2x');
  assert.equal(inventory.images.at(-1).source, retina.filename);
  assert.equal(inventory.images.at(-1).pixels, 1024);
  assert.equal(inventory.images.at(-1).sha256, hash(await readFile(resolve(artwork, retina.filename))));
  for (const image of inventory.images) assert.equal(image.sha256, hash(await readFile(resolve(artwork, image.source))));
  assert.deepEqual((await readdir(resources)).sort(), ['Rhythm.icns', 'Rhythm.icns.json']);
  // Real conversion back out catches an arbitrary/generic icon accompanied by a plausible inventory.
  const extracted = resolve(root, 'extracted.iconset');
  await run('iconutil', ['-c', 'iconset', result.iconPath, '-o', extracted]);
  assert.equal(hash(await readFile(resolve(extracted, 'icon_512x512@2x.png'))), inventory.images.at(-1).sha256);
});

for (const fault of ['missing mapping', 'missing file', 'wrong dimensions', 'invalid PNG']) test(`Rhythm icon: rejects ${fault} before conversion`, async (t) => {
  const root = await temporary(t);
  const appiconsetDir = resolve(root, 'source');
  const outDir = resolve(root, 'output');
  await cp(artwork, appiconsetDir, { recursive: true });
  const contentsPath = resolve(appiconsetDir, 'Contents.json');
  const contents = JSON.parse(await readFile(contentsPath, 'utf8'));
  const source = resolve(appiconsetDir, contents.images.at(-1).filename);
  if (fault === 'missing mapping') {
    contents.images.pop(); await writeFile(contentsPath, JSON.stringify(contents));
  } else if (fault === 'missing file') await rm(source);
  else if (fault === 'wrong dimensions') await cp(resolve(appiconsetDir, contents.images[0].filename), source);
  else await writeFile(source, 'not a PNG');
  await assert.rejects(buildRhythmIcns({ appiconsetDir, outDir, run: async () => assert.fail('invalid artwork must never reach iconutil') }), /(?:Required|Invalid) Rhythm artwork/);
  assert.deepEqual(await readdir(outDir), []);
});

for (const fault of ['missing iconutil', 'missing output', 'invalid output']) test(`Rhythm icon: fails clearly for ${fault}, never reuses a stale icon`, async (t) => {
  const outDir = await temporary(t);
  await writeFile(resolve(outDir, 'Rhythm.icns'), 'stale icon');
  await writeFile(resolve(outDir, 'Rhythm.icns.json'), '{}');
  await assert.rejects(buildRhythmIcns({ appiconsetDir: artwork, outDir, run: async (_command, args) => {
    if (fault === 'missing iconutil') throw Object.assign(new Error('spawn iconutil ENOENT'), { code: 'ENOENT' });
    if (fault === 'invalid output') await writeFile(args.at(-1), 'not an icns');
  } }), /iconutil (?:is required|did not produce|produced an invalid)/);
  assert.deepEqual(await readdir(outDir), []);
});

test('Rhythm icon: packaging and release assemble icons before bundle signing', async () => {
  const source = await readFile(new URL('../scripts/package-mac.mjs', import.meta.url), 'utf8');
  const stage = source.indexOf('await stageRhythmIcon(');
  const signing = source.indexOf("await run('codesign'");
  assert.ok(stage > source.indexOf('await cp(sourceApp, stagingArtifact') && stage < signing);
  assert.equal(source.indexOf('await stageRhythmIcon(', signing), -1);
  const workflow = await readFile(new URL('../../../.github/workflows/electron_release.yml', import.meta.url), 'utf8');
  assert.ok(workflow.indexOf('npm run package:mac') < workflow.indexOf('npm run sign:mac'));
  const sign = await readFile(new URL('../scripts/sign-and-notarize-mac.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(sign, /iconutil|stageRhythmIcon|CFBundleIcon/);
});
