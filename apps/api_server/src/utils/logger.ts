export const logger = {
  info(message: string, ...args: unknown[]) {
    // eslint-disable-next-line no-console
    console.log(`[INFO] ${message}`, ...args);
  },
  error(message: string, ...args: unknown[]) {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${message}`, ...args);
  },
};
