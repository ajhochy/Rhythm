import type { FormEvent, Ref } from 'react';

export type TaskCreateMember = {
  id: string;
  name: string;
};

type TaskCreateTestIds = {
  title: string;
  notes: string;
  scheduledDate: string;
  dueDate: string;
  collaborator: string;
  cancel: string;
  submit: string;
  error?: string;
  mutations?: string;
};

type TaskCreateFormProps = {
  idPrefix: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onCancel(): void;
  members: readonly TaskCreateMember[];
  testIds: TaskCreateTestIds;
  titleRef?: Ref<HTMLInputElement>;
  titleError?: string;
  onTitleChange?(): void;
  defaultScheduledDate?: string;
  disabled?: boolean;
  describedBy?: string;
  noValidate?: boolean;
};

export function TaskCreateForm({
  idPrefix,
  onSubmit,
  onCancel,
  members,
  testIds,
  titleRef,
  titleError,
  onTitleChange,
  defaultScheduledDate = '',
  disabled = false,
  describedBy,
  noValidate = false,
}: TaskCreateFormProps) {
  const titleErrorId = titleError ? `${idPrefix}-title-error` : undefined;
  const titleDescription = [titleErrorId, describedBy].filter(Boolean).join(' ') || undefined;

  return (
    <form className="task-editor-form" onSubmit={onSubmit} noValidate={noValidate} data-od-id={`${idPrefix}-task-editor`}>
      <fieldset disabled={disabled} aria-disabled={disabled || undefined} aria-describedby={describedBy} data-testid={testIds.mutations}>
        <legend className="sr-only">New task details</legend>

        <label className="task-editor-field">
          <span>Task title</span>
          <input
            ref={titleRef}
            name="title"
            required
            placeholder="What needs doing?"
            autoComplete="off"
            aria-invalid={titleError ? 'true' : undefined}
            aria-describedby={titleDescription}
            onChange={onTitleChange}
            data-autofocus
            data-testid={testIds.title}
            data-od-id={`${idPrefix}-task-title`}
          />
        </label>

        <label className="task-editor-field">
          <span>Task notes</span>
          <textarea
            name="notes"
            rows={4}
            placeholder="Add context or a next step"
            data-testid={testIds.notes}
            data-od-id={`${idPrefix}-task-notes`}
          />
        </label>

        <div className="task-editor-pair">
          <label className="task-editor-field">
            <span>Scheduled date</span>
            <input name="scheduledDate" type="date" defaultValue={defaultScheduledDate} data-testid={testIds.scheduledDate} data-od-id={`${idPrefix}-scheduled-date`} />
          </label>
          <label className="task-editor-field">
            <span>Due date</span>
            <input name="dueDate" type="date" data-testid={testIds.dueDate} data-od-id={`${idPrefix}-due-date`} />
          </label>
        </div>

        <section className="task-editor-section" aria-labelledby={`${idPrefix}-people-title`} data-od-id={`${idPrefix}-people`}>
          <div className="task-editor-section-head">
            <div>
              <h3 id={`${idPrefix}-people-title`}>People</h3>
              <p>Assign one collaborator now or add more after creating the task.</p>
            </div>
          </div>
          <label className="task-editor-field">
            <span>Collaborator</span>
            <select name="collaboratorId" defaultValue="" data-testid={testIds.collaborator} data-od-id={`${idPrefix}-collaborator`}>
              <option value="">No collaborator</option>
              {members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
        </section>

        {titleError && <p className="task-editor-error" id={titleErrorId} role="alert" data-testid={testIds.error}>{titleError}</p>}

        <footer className="task-editor-footer">
          <button className="secondary-button" type="button" onClick={onCancel} data-testid={testIds.cancel} data-od-id={`${idPrefix}-cancel`}>Cancel</button>
          <button className="primary-button" type="submit" data-testid={testIds.submit} data-od-id={`${idPrefix}-create-task`}>Create task</button>
        </footer>
      </fieldset>
    </form>
  );
}
