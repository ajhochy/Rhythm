// #1075 (OCU-34): SessionModelPicker itself was dead code (never
// instantiated — superseded by UnifiedAgentModelPicker) and has been
// removed. `ModelPickerApplyAs` is kept — `_unified_agent_model_picker.dart`
// still imports it.

/// The "apply as" choice the user makes in the picker.
enum ModelPickerApplyAs {
  /// Persist as the session default (PATCH /agent-sessions/:id).
  session,

  /// Override only the next turn (WS modelOverride).
  turn,
}
