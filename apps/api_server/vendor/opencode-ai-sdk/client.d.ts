export * from "./gen/types.gen.js";
export type { McpLocalConfigInput, McpRemoteConfigInput, McpStatusEntry, PartInput, RhythmEvent, SdkAgent, SessionMessage, } from "./rhythm.js";
import { type Config } from "./gen/client/types.gen.js";
import { OpencodeClient } from "./gen/sdk.gen.js";
export { type Config as OpencodeClientConfig, OpencodeClient };
export declare function createOpencodeClient(config?: Config & {
    directory?: string;
}): OpencodeClient;
