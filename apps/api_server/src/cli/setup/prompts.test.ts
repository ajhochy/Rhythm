import { describe, expect, it, vi } from 'vitest';

describe('createReadlinePromptIO (non-TTY buffered mode)', () => {
  it('throws immediately on the first question when stdin is completely empty (Ctrl+C / EOF simulation) rather than returning an empty answer', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, readFileSync: vi.fn(() => '') };
    });
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const { createReadlinePromptIO } = await import('./prompts');
    const io = createReadlinePromptIO();

    await expect(io.askSecret('Paste your Anthropic API key:')).rejects.toThrow(/no more input/i);

    vi.doUnmock('node:fs');
  });

  it('serves buffered answers in order for non-empty piped stdin, dropping a single trailing newline', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, readFileSync: vi.fn(() => 'first-answer\nsecond-answer\n') };
    });
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    const { createReadlinePromptIO } = await import('./prompts');
    const io = createReadlinePromptIO();

    await expect(io.ask('Q1:')).resolves.toBe('first-answer');
    await expect(io.ask('Q2:')).resolves.toBe('second-answer');
    await expect(io.ask('Q3:')).rejects.toThrow(/no more input/i);

    vi.doUnmock('node:fs');
  });
});
