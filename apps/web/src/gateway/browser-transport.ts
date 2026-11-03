// Composition marks only its credential-stripping, same-origin transport.
const browserFetchers = new WeakSet<typeof fetch>();
export function trustedBrowserFetcher(origin: string, fetcher: typeof fetch): typeof fetch {
  const trusted: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) return Promise.reject(new Error('Browser gateway requires same-origin requests'));
    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    return fetcher(input, { ...init, headers });
  };
  browserFetchers.add(trusted);
  return trusted;
}
export const isTrustedBrowserFetcher = (fetcher: typeof fetch) => browserFetchers.has(fetcher);
