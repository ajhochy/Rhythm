type PublicConnectionSettings = {
  serverUrl?: string;
  username?: string;
  directory?: string;
};

export function serializePublicConnectionSettings(settings: {
  serverUrl: string;
  username: string;
  directory: string;
}) {
  const { serverUrl, username, directory } = settings;
  return JSON.stringify({ serverUrl, username, directory });
}

export function parseStoredConnectionSettings(raw: string): {
  publicSettings: PublicConnectionSettings;
  legacyPassword?: string;
} {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const publicSettings: PublicConnectionSettings = {};
    if (typeof parsed.serverUrl === 'string') publicSettings.serverUrl = parsed.serverUrl;
    if (typeof parsed.username === 'string') publicSettings.username = parsed.username;
    if (typeof parsed.directory === 'string') publicSettings.directory = parsed.directory;
    return {
      publicSettings,
      ...(typeof parsed.password === 'string' && parsed.password
        ? { legacyPassword: parsed.password }
        : {}),
    };
  } catch {
    return { publicSettings: {} };
  }
}

export async function migrateLegacyConnectionPassword({
  legacyPassword,
  writePassword,
  writePublicSettings,
}: {
  legacyPassword: string;
  writePassword: (password: string) => Promise<unknown>;
  writePublicSettings: () => Promise<unknown>;
}) {
  await writePassword(legacyPassword);
  await writePublicSettings();
}

export function createCredentialWriteQueue(
  write: (password: string) => Promise<unknown>,
  onError: () => void,
) {
  let pending: Promise<unknown> = Promise.resolve();
  return (password: string) => {
    pending = pending.then(() => write(password)).catch(onError);
    return pending;
  };
}
