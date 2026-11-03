export async function cloudAccountFailure(result: Response): Promise<string | undefined> {
  if (result.status !== 401 && result.status !== 503) return;
  try {
    if ((await result.clone().json()).error?.code === 'CLOUD_ACCOUNT_DISCONNECTED') {
      return 'Upstream account connection problem. Reconnect browser access in the signed-in Rhythm desktop app; local agents remain available.';
    }
  } catch { /* Preserve each domain's existing error for non-cloud responses. */ }
}
