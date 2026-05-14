import { OpencodeClientService } from './opencode_client_service';

/** Singleton Opencode engine client — shared across the server. */
export const opencodeClient = new OpencodeClientService();

/**
 * Maps local agent session IDs -> Opencode SDK session IDs.
 * Needed so the WS gateway can route user input to the correct SDK session.
 * Ephemeral (in-memory) — sessions are created fresh on each app launch.
 */
export const opencodeSessionMap = new Map<string, string>();

