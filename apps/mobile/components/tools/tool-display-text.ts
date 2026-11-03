const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

/** Decodes ordinary email entities as inert display text; it never parses HTML. */
export function decodePlainTextEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, token) => {
    const normalized = String(token).toLowerCase();
    if (normalized.startsWith('#x') || normalized.startsWith('#')) {
      const codePoint = Number.parseInt(
        normalized.startsWith('#x') ? normalized.slice(2) : normalized.slice(1),
        normalized.startsWith('#x') ? 16 : 10,
      );
      if (Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        return String.fromCodePoint(codePoint);
      }
      return entity;
    }
    return NAMED_HTML_ENTITIES[normalized] ?? entity;
  });
}

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  return cells.length > 1 ? cells : null;
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return Boolean(cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function normalizeInlineLinks(line: string) {
  // Deliberately keep the URL as inert text. Research reports must never open
  // external links merely because a report is rendered.
  return line.replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
}

/**
 * Adapts common report tables and links to the existing safe text renderer.
 * It retains their information while avoiding raw table pipes and link syntax.
 */
export function normalizeResearchMarkdown(value: string) {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const normalized: string[] = [];

  for (let index = 0; index < lines.length;) {
    const headers = splitMarkdownTableRow(lines[index] ?? '');
    if (headers && isMarkdownTableSeparator(lines[index + 1] ?? '')) {
      index += 2;
      while (index < lines.length) {
        const cells = splitMarkdownTableRow(lines[index] ?? '');
        if (!cells) break;
        const parts = cells.map((cell, cellIndex) => {
          const label = normalizeInlineLinks(headers[cellIndex] || `Column ${cellIndex + 1}`);
          const content = normalizeInlineLinks(cell);
          return cellIndex === 0
            ? `**${label}:** ${content}`
            : `${label}: ${content}`;
        });
        normalized.push(`- ${parts.join(' — ')}`);
        index += 1;
      }
      continue;
    }

    normalized.push(normalizeInlineLinks(lines[index] ?? ''));
    index += 1;
  }

  return normalized.join('\n');
}
