/**
 * Rhythm compatibility names backed exclusively by generated SDK types.
 *
 * Keep aliases here—not in api_server—so a fork sync + SDK regeneration has
 * one place to typecheck every historical consumer name. No wire shape is
 * redeclared in this file.
 */
export type {
  EventMessagePartDelta,
  EventPermissionAsked,
  EventQuestionAsked,
  EventQuestionReplied,
  EventQuestionRejected,
} from "./v2/gen/types.gen.js"

export type {
  Agent as SdkAgent,
  McpLocalConfig as McpLocalConfigInput,
  McpRemoteConfig as McpRemoteConfigInput,
  McpStatus as McpStatusEntry,
} from "./gen/types.gen.js"

import type {
  Event as LegacyEvent,
  FilePartInput,
  SessionMessagesResponses,
  TextPartInput,
} from "./gen/types.gen.js"
import type { Event as V2Event } from "./v2/gen/types.gen.js"

/** Complete union across the generated legacy transport and v2 fork schema. */
export type RhythmEvent = LegacyEvent | V2Event
export type PartInput = TextPartInput | FilePartInput
export type SessionMessage = SessionMessagesResponses[200][number]
