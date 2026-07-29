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

export interface SourceTranscriptMessage {
  id: number | string;
  role: string;
  rawText: string;
  parts: unknown[];
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
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{35}\b/g,
  /\b(?:set-cookie\s*:\s*|(?:session|sessionid|connect\.sid)\s*=)[^\r\n;]+/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"',}]+/gi,
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

function stringField(
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === 'string') return value[key] as string;
  }
  return undefined;
}

function deriveCategory(
  role: string,
  part: Record<string, unknown>,
): TranscriptShareCategory {
  if (role === 'system') return 'system_prompt';
  const type = (stringField(part, 'type') ?? '').toLowerCase();
  const toolName = (
    stringField(part, 'tool', 'toolName', 'name') ??
    (part.state && typeof part.state === 'object'
      ? stringField(part.state as Record<string, unknown>, 'tool', 'toolName', 'name')
      : undefined) ??
    ''
  ).toLowerCase();
  if (/gmail|email|mail/.test(toolName)) return 'email';
  // \b fails on snake_case (pco_people_search); split on _- before matching.
  if (/planning.?center|\bpco\b/.test(toolName.replace(/[_-]/g, ' '))) {
    return 'pco_data';
  }
  if (
    type.includes('tool') ||
    'toolCallId' in part ||
    'tool_call_id' in part
  ) {
    return 'tool_output';
  }
  if (
    part.attachment === true ||
    part.isAttachment === true ||
    type === 'attachment' ||
    type === 'file'
  ) {
    return 'attachment';
  }
  if (
    type === 'file_content' ||
    part.fileContent !== undefined ||
    part.file_content !== undefined
  ) {
    return 'file_content';
  }
  return 'message';
}

/**
 * Build the only trusted review input from persisted source messages. Caller
 * categories and content never participate in classification or snapshotting.
 */
export function deriveTranscriptShareReview(
  messages: readonly SourceTranscriptMessage[],
): TranscriptShareReview {
  return {
    items: messages.flatMap((message) => {
      const parts = message.parts.length > 0
        ? message.parts
        : [{ type: 'text', text: message.rawText }];
      return parts.map((rawPart, index) => {
        const part = rawPart && typeof rawPart === 'object'
          ? rawPart as Record<string, unknown>
          : { type: 'text', text: String(rawPart ?? '') };
        const id = stringField(part, 'id') ?? `${message.id}:${index}`;
        return {
          id,
          category: deriveCategory(message.role, part),
          content: part,
        };
      });
    }),
  };
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
