/**
 * Parse security-sensitive JSON while rejecting duplicate decoded object
 * member names. The lexical pass deliberately leaves the source string
 * untouched so callers can bind or hash the exact bytes after validation.
 */
export function parseStrictJson(raw: string, label = 'value'): unknown {
  if (typeof raw !== 'string') throw new Error(`${label} must be JSON bytes`);

  let index = 0;
  const malformed = (reason: string): never => {
    throw new Error(`${label} contains malformed JSON (${reason} at offset ${index})`);
  };
  const skipWhitespace = (): void => {
    while (index < raw.length && /[\t\n\r ]/.test(raw[index])) index += 1;
  };
  const scanString = (): string => {
    if (raw[index] !== '"') return malformed('expected string');
    const start = index;
    index += 1;
    while (index < raw.length) {
      const code = raw.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        return raw.slice(start, index);
      }
      if (code < 0x20) return malformed('unescaped control character');
      if (code === 0x5c) {
        index += 1;
        if (index >= raw.length) return malformed('unterminated escape');
        const escape = raw[index];
        if ('"\\/bfnrt'.includes(escape)) {
          index += 1;
          continue;
        }
        if (escape !== 'u') return malformed('invalid escape');
        if (!/^[0-9a-fA-F]{4}$/.test(raw.slice(index + 1, index + 5))) {
          return malformed('invalid unicode escape');
        }
        index += 5;
        continue;
      }
      index += 1;
    }
    return malformed('unterminated string');
  };
  const scanValue = (): void => {
    skipWhitespace();
    const token = raw[index];
    if (token === '{') {
      index += 1;
      skipWhitespace();
      const names = new Set<string>();
      if (raw[index] === '}') {
        index += 1;
        return;
      }
      while (index < raw.length) {
        const keyToken = scanString();
        const decoded = JSON.parse(keyToken) as string;
        if (names.has(decoded)) {
          throw new Error(`${label} contains duplicate JSON member '${decoded}'`);
        }
        names.add(decoded);
        skipWhitespace();
        if (raw[index] !== ':') return malformed('expected colon');
        index += 1;
        scanValue();
        skipWhitespace();
        if (raw[index] === '}') {
          index += 1;
          return;
        }
        if (raw[index] !== ',') return malformed('expected comma or object end');
        index += 1;
        skipWhitespace();
        if (raw[index] !== '"') return malformed('expected member name');
      }
      return malformed('unterminated object');
    }
    if (token === '[') {
      index += 1;
      skipWhitespace();
      if (raw[index] === ']') {
        index += 1;
        return;
      }
      while (index < raw.length) {
        scanValue();
        skipWhitespace();
        if (raw[index] === ']') {
          index += 1;
          return;
        }
        if (raw[index] !== ',') return malformed('expected comma or array end');
        index += 1;
        skipWhitespace();
        if (raw[index] === ']') return malformed('trailing comma');
      }
      return malformed('unterminated array');
    }
    if (token === '"') {
      scanString();
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (raw.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    const number = raw.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      index += number[0].length;
      return;
    }
    return malformed('unexpected token');
  };

  scanValue();
  skipWhitespace();
  if (index !== raw.length) malformed('trailing content');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return malformed('invalid JSON');
  }
}
