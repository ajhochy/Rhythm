// Ported verbatim from apps/web/src/components/HeaderTaskAction.tsx.
import { Icon } from './Icon';

export function HeaderTaskAction({
  onClick,
  disabled = false,
  describedBy,
  testId,
  label = 'Add task',
}: {
  onClick(): void;
  disabled?: boolean;
  describedBy?: string;
  testId: string;
  label?: string;
}) {
  return (
    <button
      className="primary-button page-task-action"
      type="button"
      disabled={disabled}
      aria-describedby={describedBy}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon name="plus" size={15} />
      <span>{label}</span>
    </button>
  );
}
