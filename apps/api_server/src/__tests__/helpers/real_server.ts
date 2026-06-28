import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

/**
 * Shape returned by {@link startTestServer}.
 *
 * - `baseUrl` is the `http://127.0.0.1:<port>` origin the test should hit with
 *   the global `fetch`.
 * - `close` tears the server down deterministically (see below) and resolves
 *   once the listener is fully closed.
 * - `server` is the underlying http.Server for the rare test that needs it
 *   (e.g. to attach a WebSocket upgrade handler).
 */
export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
  server: Server;
}

/**
 * Start an Express app on an ephemeral port for a real-server (over-the-wire
 * `fetch`) test, hardened against the undici keep-alive socket flake.
 *
 * Background — the flake this prevents:
 * The real-server harness spins up `createApp().listen(0)` and hits it with
 * Node's global `fetch` (backed by undici). If teardown only calls
 * `server.close()`, undici's idle keep-alive socket stays pooled against the
 * now-closed server's ephemeral port. When a later test's `listen(0)` recycles
 * that same port, undici reuses the dead socket and the next request fails
 * intermittently with `UND_ERR_SOCKET` ("other side closed"). It is
 * load/timing dependent, so it surfaces only under the full parallel suite and
 * passes on isolated re-run.
 *
 * Two server-side settings make the cycle deterministic (undici is not a direct
 * dependency — it backs built-in `fetch` — so `setGlobalDispatcher`/`Agent` is
 * unavailable; this is the dependency-free fix):
 *   - `maxRequestsPerSocket = 1` so every response carries `Connection: close`
 *     and undici never pools a socket — nothing stale to reuse.
 *   - `closeAllConnections()` before `close()` in teardown, to evict any
 *     in-flight socket from undici's pool.
 *
 * Usage:
 * ```ts
 * const { baseUrl, close } = await startTestServer(createApp());
 * // ...fetch(`${baseUrl}/...`)...
 * await close();
 * ```
 *
 * @param app the Express application to serve, typically `createApp()`.
 */
export async function startTestServer(app: Express): Promise<TestServer> {
  // `app.listen(0)` binds an ephemeral port and returns the http.Server.
  const server = app.listen(0) as Server;
  // Disable keep-alive: every response gets `Connection: close`, so undici
  // never pools a socket against this server's ephemeral port.
  server.maxRequestsPerSocket = 1;

  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const close = () =>
    new Promise<void>((resolve, reject) => {
      // Force-destroy any sockets (including undici's pooled keep-alive
      // connection) before resolving, so a later `listen(0)` that recycles
      // this port cannot reuse a stale socket.
      server.closeAllConnections();
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { baseUrl, close, server };
}
