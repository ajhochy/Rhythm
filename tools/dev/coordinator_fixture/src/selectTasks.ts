export type Task = { id: string; status: 'open' | 'done'; title: string };

// Deliberately unfiltered starting point for the approved worker task.
export function selectTasks(tasks: readonly Task[], _status?: 'open' | 'done'): readonly Task[] {
  return tasks;
}
