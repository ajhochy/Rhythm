import { GoogleAgentBridgeService } from './google_agent_bridge_service';

/**
 * Process-wide singleton for the Google→opencode Gemini bridge (Option C).
 * A single instance owns the one refresh loop (mirrors how
 * opencode_auth_routes.ts exports one CredentialsBridgeService for Anthropic).
 */
export const googleAgentBridge = new GoogleAgentBridgeService();
