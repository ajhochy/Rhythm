/** Accept a JSON-only model reply, optionally wrapped in one whole code fence. */
export function parseEvaluationModelJson(raw: string): unknown {
  if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) {
    throw new Error('Evaluation model response exceeds 64 KiB');
  }
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
  if (trimmed.startsWith('```') && !fenced) {
    throw new Error('Evaluation model response must be one JSON-only block');
  }
  try {
    return JSON.parse(fenced ? fenced[1].trim() : trimmed) as unknown;
  } catch {
    throw new Error('Evaluation model response is invalid JSON');
  }
}
