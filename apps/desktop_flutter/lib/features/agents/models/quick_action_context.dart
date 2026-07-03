/// Issue #863 — generic context object consumed by the shared
/// [QuickActionsBar] widget so it can attach to a task, a project/plan, or a
/// message thread without depending on any of those feature models.
///
/// This is intentionally minimal: quick actions only need enough text to
/// pre-load an agent prompt and enough identity to link a created follow-up
/// task back to its source.
class QuickActionContext {
  const QuickActionContext({
    required this.kind,
    required this.sourceId,
    required this.title,
    this.description,
  });

  /// One of 'task', 'project', or 'thread'. Used to label the linked
  /// follow-up task's notes (e.g. "Follow-up from task ...").
  final String kind;

  /// The id of the source task/project/thread, used to link created
  /// follow-up tasks back to where they came from.
  final String sourceId;

  /// Short human title (task title, project name, or thread title).
  final String title;

  /// Notes/body/last-message-preview — whatever free text best represents
  /// the item's content. May be null or empty.
  final String? description;
}
