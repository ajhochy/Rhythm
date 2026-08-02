export type TrailingCoalescer = {
  trigger(): void;
  cancel(): void;
};

export function createTrailingCoalescer(
  delayMs: number,
  callback: () => void,
): TrailingCoalescer {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return {
    trigger() {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = undefined;
        callback();
      }, delayMs);
    },
    cancel() {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
    },
  };
}
