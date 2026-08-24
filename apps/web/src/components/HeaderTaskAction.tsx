import { Icon } from '../icons';

export function HeaderTaskAction({
  onClick,
  disabled = false,
  describedBy,
  testId,
}: {
  onClick(): void;
  disabled?: boolean;
  describedBy?: string;
  testId: string;
}) {
  return (
    <button
      className="primary-button page-task-action"
      type="button"
      disabled={disabled}
      aria-describedby={describedBy}
      onClick={onClick}
      data-od-id="header-add-task"
      data-testid={testId}
    >
      <Icon name="plus" size={15} />
      <span>Add task</span>
    </button>
  );
}
