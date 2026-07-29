export const TRANSCRIPT_SHARE_CATEGORIES = [
  'message',
  'file_content',
  'tool_output',
  'email',
  'pco_data',
  'system_prompt',
  'attachment',
] as const;

export type TranscriptShareCategory =
  (typeof TRANSCRIPT_SHARE_CATEGORIES)[number];

export interface TranscriptShareItem {
  id: string;
  category: TranscriptShareCategory;
  content: unknown;
}

export interface TranscriptShareReview {
  items: TranscriptShareItem[];
}

const EXCLUDED_BY_DEFAULT = new Set<TranscriptShareCategory>([
  'file_content',
  'tool_output',
  'email',
  'pco_data',
  'system_prompt',
  'attachment',
]);

const SECRET_PATTERNS = [
  /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/gi,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"',}]+/gi,
  /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
];

const HOST_PATH_PATTERNS = [
  /\/Users\/[^/\s"',}]+(?:\/[^\s"',}]*)?/g,
  /\/home\/[^/\s"',}]+(?:\/[^\s"',}]*)?/g,
  /[A-Za-z]:\\Users\\[^\\\s"',}]+(?:\\[^\s"',}]*)?/g,
];

function containsSecret(value: unknown): boolean {
  if (typeof value === 'string') {
    return SECRET_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    });
  }
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, nested]) =>
        /authorization|api[_-]?key|token|secret|password/i.test(key) ||
        containsSecret(nested),
    );
  }
  return false;
}

function redactString(value: string): string {
  let result = value;
  for (const pattern of [...SECRET_PATTERNS, ...HOST_PATH_PATTERNS]) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function redact(value: unknown, key?: string): unknown {
  if (key && /authorization|api[_-]?key|token|secret|password/i.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nested]) => [
        nestedKey,
        redact(nested, nestedKey),
      ]),
    );
  }
  return value;
}

export function sanitizeTranscriptShare(
  review: TranscriptShareReview,
  explicitlyIncludedItemIds: readonly string[] = [],
): TranscriptShareReview {
  const included = new Set(explicitlyIncludedItemIds);
  const items = review.items
    .filter((item) => {
      if (EXCLUDED_BY_DEFAULT.has(item.category)) return included.has(item.id);
      if (containsSecret(item.content)) return included.has(item.id);
      return true;
    })
    .map((item) => ({
      id: item.id,
      category: item.category,
      content: redact(item.content),
    }));
  return JSON.parse(JSON.stringify({ items })) as TranscriptShareReview;
}
