import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { chromium } from '@playwright/test';

// Execute the actual private production resolver in Chromium with native File/FileReader.
// No copied resolver, fake FileReader, compression stub, API, or app server.
const composer = await readFile(new URL('../../src/components/Composer.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('Composer.tsx', composer, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const resolver = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'resolveLiveAttachment');
assert.ok(resolver, 'production attachment resolver must exist');
const compression = await readFile(new URL('../../src/compressImage.ts', import.meta.url), 'utf8');
const script = ts.transpileModule(
  `${compression.replaceAll('export ', '')}\nconst MAX_LIVE_TEXT_ATTACHMENT_CHARS = 100 * 1024;\nconst MAX_LIVE_FRAME_PARTS_BYTES = 20 * 1024 * 1024 - 4096;\n${resolver.getText(parsed)}\nwindow.resolveAttachment = resolveLiveAttachment;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

test('A1 picker sends selected workbook bytes, never fabricated file:name', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: script });
    const bytes = [80, 75, 3, 4, 0, 255, 17, 0];
    const part = await page.evaluate(async bytes => {
      const file = new File([new Uint8Array(bytes)], 'synthetic.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      return window.resolveAttachment(file);
    }, bytes);
    assert.equal(part.filename, 'synthetic.xlsx');
    assert.equal(part.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(part.size, bytes.length);
    assert.equal(part.dataUrl, `data:${part.mime};base64,${Buffer.from(bytes).toString('base64')}`);
    assert.equal(part.fileUrl, undefined, 'browser selection is not a server filesystem reference');
  } finally {
    await browser.close();
  }
});

for (const mime of ['image/jpeg', 'image/png']) {
  test(`A1 picker retains decodable ${mime} bytes (not provider vision proof)`, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addScriptTag({ content: script });
      const result = await page.evaluate(async mime => {
        const canvas = document.createElement('canvas');
        canvas.width = 2; canvas.height = 2;
        const context = canvas.getContext('2d');
        context.fillStyle = '#ff0000'; context.fillRect(0, 0, 2, 2);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, mime));
        const file = new File([blob], mime === 'image/png' ? 'synthetic.png' : 'synthetic.jpg', { type: mime });
        const part = await window.resolveAttachment(file);
        const decoded = await createImageBitmap(await (await fetch(part.dataUrl)).blob());
        return { part, width: decoded.width, height: decoded.height };
      }, mime);
      assert.equal(result.part.mime, mime);
      assert.match(result.part.dataUrl, new RegExp(`^data:${mime};base64,`));
      assert.equal(result.width, 2); assert.equal(result.height, 2);
      assert.equal(result.part.fileUrl, undefined);
    } finally {
      await browser.close();
    }
  });
}

test('A1 picker refuses selected binary bytes that base64-expand beyond the WebSocket attachment limit', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: script });
    await assert.rejects(
      page.evaluate(() => window.resolveAttachment(new File([new Uint8Array(16 * 1024 * 1024)], 'large.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }))),
      /20 MiB|attachment.*too large/i,
    );
  } finally {
    await browser.close();
  }
});
