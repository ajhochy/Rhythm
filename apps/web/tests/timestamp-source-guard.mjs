import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ponytail: only timestamp-named display expressions, not user prose, date-only or input serialization.
export function rawTimestampDisplays(source, file = 'fixture.tsx') {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures = [];
  const timestampField = /^(?:createdAt|updatedAt|expiresAt|lastSyncedAt|lastRunAt|lastMatchedAt|lastEvaluatedAt|startedAt|receivedAt|startTime|endTime)$/;
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const expression = node.expression;
      const text = expression.getText(ast);
      // Nested JSX owns its own expressions; don't mistake conditional <Timestamp> props for raw text.
      let raw = false;
      function inspect(child) {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) return;
        if (ts.isConditionalExpression(child)) {
          inspect(child.whenTrue);
          inspect(child.whenFalse);
          return;
        }
        if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          inspect(child.right);
          return;
        }
        if (ts.isPropertyAccessExpression(child) && timestampField.test(child.name.text)) raw = true;
        ts.forEachChild(child, inspect);
      }
      inspect(expression);
      if (raw && !/^dateTimeLabel\(/.test(text)) {
        failures.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${text.slice(0, 100)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return failures;
}

function sourceFiles(paths) {
  return paths.flatMap((path) => statSync(path).isDirectory()
    ? sourceFiles(readdirSync(path).map((entry) => join(path, entry)))
    : /\.[jt]sx$/.test(path) ? [path] : []);
}

export function outstandingTimestampFailures(files, failures, ledger) {
  const deferred = ledger.deferred.flatMap(entry => entry.expressions.map(expression => ({ file: entry.file, expression })));
  const stale = deferred
    .filter(({ file, expression }) => files.includes(file) && !failures.some(item => item.startsWith(`${file}:`) && item.includes(expression)))
    .map(({ file, expression }) => `${file}: stale deferred entry: ${expression}`);
  const unexpected = failures.filter(item => !deferred.some(({ file, expression }) => item.startsWith(`${file}:`) && item.includes(expression)));
  return [...unexpected, ...stale];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = sourceFiles(process.argv.slice(2));
  const ledger = JSON.parse(readFileSync(new URL('./timestamp-outstanding-1565.json', import.meta.url), 'utf8'));
  const failures = files.flatMap(file => rawTimestampDisplays(readFileSync(file, 'utf8'), file));
  const outstanding = outstandingTimestampFailures(files, failures, ledger);
  if (outstanding.length) { console.error(outstanding.join('\n')); process.exitCode = 1; }
}
