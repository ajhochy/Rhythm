import { readFileSync } from 'node:fs';
import * as readline from 'node:readline';

/**
 * #872 — reusable prompt IO seam. Every wizard step in this feature talks to
 * a `PromptIO` interface rather than `process.stdin`/`stdout` directly, so
 * tests can inject a scripted driver and assert on exact prompts/output
 * without a real TTY. Secret prompts (`askSecret`) never echo the typed
 * value to output and are masked in transcripts recorded by the driver.
 */
export interface PromptIO {
  /** Prints an informational line (e.g. "Already set: ✅ Anthropic API key"). */
  info(message: string): void;
  /** Asks a free-text question; returns the trimmed answer. */
  ask(question: string): Promise<string>;
  /** Asks for a secret value; input is not echoed. Returns the raw (untrimmed-of-meaning) answer. */
  askSecret(question: string): Promise<string>;
  /** Asks a yes/no question; returns true for yes. `defaultValue` is used on empty input. */
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
  /** Closes any open resources (e.g. the readline interface). Safe to call multiple times. */
  close(): void;
}

/**
 * Non-TTY backing for `createReadlinePromptIO` — see the note there for why
 * this exists. Reads all of stdin synchronously (fd 0) exactly once, before
 * the first prompt, and serves every subsequent question from that buffer
 * in order. Running out of buffered lines throws (same "surfaces a bug
 * immediately rather than hanging" contract as `ScriptedPromptIO`).
 */
function createBufferedPromptIO(): PromptIO {
  let lines: string[] = [];
  try {
    const raw = readFileSync(0, 'utf8');
    // ''.split('\n') is ['' ] (one empty "line"), not zero lines — that would
    // let the FIRST question silently succeed with an empty answer instead
    // of throwing "out of input" (which is what a Ctrl+C / truly empty
    // stdin must do, so setup never writes a blank value to .env). Also drop
    // one trailing empty element from a normal trailing-newline file.
    lines = raw.length === 0 ? [] : raw.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  } catch {
    // fd 0 not readable (e.g. no stdin attached at all) — treat as empty input.
    lines = [];
  }
  let cursor = 0;

  const nextLine = (question: string): string => {
    if (cursor >= lines.length) {
      throw new Error(
        `rhythm setup: no more input available to answer "${question}" (stdin reached EOF).`,
      );
    }
    const line = lines[cursor];
    cursor += 1;
    return line;
  };

  return {
    info(message: string) {
      // eslint-disable-next-line no-console
      console.log(message);
    },
    async ask(question: string) {
      return nextLine(question).trim();
    },
    async askSecret(question: string) {
      return nextLine(question).trim();
    },
    async confirm(question: string, defaultValue = false) {
      const raw = nextLine(question).trim().toLowerCase();
      if (raw === '') return defaultValue;
      return raw === 'y' || raw === 'yes';
    },
    close() {
      // no-op — nothing to release; stdin was already fully drained up front.
    },
  };
}

/**
 * Real terminal-backed implementation used by `rhythm setup` outside tests.
 * Secret input is masked by intercepting stdin's raw write to stdout — a
 * minimal approach sufficient for a CLI wizard (no external dependency).
 *
 * Non-TTY note: Node's `readline.Interface` closes itself as soon as the
 * underlying input stream emits `'end'` (EOF). A real terminal (TTY) never
 * sends EOF mid-session, so interactive use is unaffected. But piped/heredoc/
 * CI stdin delivers all of its data and then EOF essentially immediately —
 * if ANY `question()` call happens after an `await`/microtask gap (e.g. this
 * wizard's `info()` calls or a dynamic `import()` between steps), the
 * interface can already be closed by the time that call runs, surfacing
 * `ERR_USE_AFTER_CLOSE`, and — because piped data is consumed exactly once —
 * there is no way to recover it after the fact by recreating the interface.
 *
 * Fix: for non-TTY stdin, eagerly drain the entire input into a line buffer
 * up front (before any prompt is shown) and serve every subsequent
 * `ask`/`askSecret`/`confirm` call from that buffer instead of a live
 * `readline.question()`. TTY stdin keeps using live `readline.question()`
 * calls exactly as before.
 */
export function createReadlinePromptIO(): PromptIO {
  const isInteractiveTty = process.stdin.isTTY === true;

  if (!isInteractiveTty) {
    return createBufferedPromptIO();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const askRaw = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));

  return {
    info(message: string) {
      // eslint-disable-next-line no-console
      console.log(message);
    },
    async ask(question: string) {
      const answer = await askRaw(`${question} `);
      return answer.trim();
    },
    async askSecret(question: string) {
      // Node's readline has no first-class masked input; muting stdout during
      // the question is the standard workaround for a dependency-free CLI.
      const stdoutWrite = process.stdout.write.bind(process.stdout);
      let muted = false;
      process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
        if (muted) return true;
        // @ts-expect-error -- forwarding to the original (overloaded) write signature
        return stdoutWrite(chunk, ...args);
      }) as typeof process.stdout.write;
      try {
        muted = true;
        const answer = await askRaw(`${question} `);
        return answer.trim();
      } finally {
        muted = false;
        process.stdout.write = stdoutWrite;
        process.stdout.write('\n');
      }
    },
    async confirm(question: string, defaultValue = false) {
      const hint = defaultValue ? 'Y/n' : 'y/N';
      const answer = (await askRaw(`${question} (${hint}) `)).trim().toLowerCase();
      if (answer === '') return defaultValue;
      return answer === 'y' || answer === 'yes';
    },
    close() {
      rl.close();
    },
  };
}

/**
 * Scripted, injectable `PromptIO` for tests. Answers are consumed in order;
 * asking more questions than there are scripted answers throws (surfaces a
 * test bug immediately rather than hanging).
 */
export class ScriptedPromptIO implements PromptIO {
  private readonly answers: string[];
  private cursor = 0;
  readonly infoLog: string[] = [];
  readonly questionLog: string[] = [];

  constructor(answers: string[]) {
    this.answers = answers;
  }

  info(message: string): void {
    this.infoLog.push(message);
  }

  private nextAnswer(question: string): string {
    if (this.cursor >= this.answers.length) {
      throw new Error(
        `ScriptedPromptIO ran out of scripted answers (asked: "${question}"). Provide more answers.`,
      );
    }
    const answer = this.answers[this.cursor];
    this.cursor += 1;
    this.questionLog.push(question);
    return answer;
  }

  async ask(question: string): Promise<string> {
    return this.nextAnswer(question).trim();
  }

  async askSecret(question: string): Promise<string> {
    return this.nextAnswer(question).trim();
  }

  async confirm(question: string, defaultValue = false): Promise<boolean> {
    const raw = this.nextAnswer(question).trim().toLowerCase();
    if (raw === '') return defaultValue;
    return raw === 'y' || raw === 'yes';
  }

  close(): void {
    // no-op — nothing to release for a scripted driver.
  }
}
