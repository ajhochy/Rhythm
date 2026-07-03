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
 * Real terminal-backed implementation used by `rhythm setup` outside tests.
 * Secret input is masked by intercepting stdin's raw write to stdout — a
 * minimal approach sufficient for a CLI wizard (no external dependency).
 */
export function createReadlinePromptIO(): PromptIO {
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
