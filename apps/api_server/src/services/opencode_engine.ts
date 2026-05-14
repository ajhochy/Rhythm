import { OpencodeClientService } from './opencode_client_service';

/** Singleton Opencode engine client — shared across the server. */
export const opencodeClient = new OpencodeClientService();
