import { describe, expect, it } from 'vitest';

import { createReadlinePromptIO } from './prompts';

// Buffered (non-TTY) mode is exercised via the `bufferedInput` test seam rather
// than mocking `node:fs` + toggling `process.stdin.isTTY`. The old approach
// used `vi.doMock('node:fs')` in both tests and leaked the empty-input mock
// across cases, flaking the second test on CI ("no more input available").
describe('createReadlinePromptIO (non-TTY buffered mode)', () => {
  it('throws immediately on the first question when stdin is completely empty (Ctrl+C / EOF simulation) rather than returning an empty answer', async () => {
    const io = createReadlinePromptIO({ bufferedInput: '' });

    await expect(io.askSecret('Paste your Anthropic API key:')).rejects.toThrow(
      /no more input/i,
    );
  });

  it('serves buffered answers in order for non-empty piped stdin, dropping a single trailing newline', async () => {
    const io = createReadlinePromptIO({
      bufferedInput: 'first-answer\nsecond-answer\n',
    });

    await expect(io.ask('Q1:')).resolves.toBe('first-answer');
    await expect(io.ask('Q2:')).resolves.toBe('second-answer');
    await expect(io.ask('Q3:')).rejects.toThrow(/no more input/i);
  });
});
