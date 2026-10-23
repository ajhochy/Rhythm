import { readFileSync } from 'node:fs';
import ts from 'typescript';

const modules = new Map();

// Load acyclic, dependency-local gateway modules without a Vite resolver.
// Keep their actual imports: data URLs cannot resolve relative specifiers.
export function sourceModuleUrl(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  let source = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports = ts.preProcessFile(source).importedFiles;
  for (const item of imports.reverse()) {
    if (!item.fileName.startsWith('.')) continue;
    const target = new URL(item.fileName, url);
    if (!target.pathname.endsWith('.ts')) target.pathname += '.ts';
    const dependency = sourceModuleUrl(target);
    source = source.slice(0, item.pos + 1) + dependency + source.slice(item.end + 1);
  }
  const result = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  modules.set(url.href, result);
  return result;
}
