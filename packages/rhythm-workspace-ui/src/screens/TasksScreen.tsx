import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmTask } from '../domain/types';

export function TasksScreen() {
  const { tasks } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmTask[]>([]);

  useEffect(() => {
    let cancelled = false;
    void tasks.list().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [tasks]);

  const toggleDone = async (task: RhythmTask) => {
    const updated = await tasks.setStatus(task.id, task.status === 'done' ? 'open' : 'done');
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  return (
    <ScreenRoot screenName="Tasks" testId="rhythm-tasks-screen">
      <h1>Tasks</h1>
      <p>{items.length} {items.length === 1 ? 'task' : 'tasks'}</p>
      <ul data-testid="rhythm-tasks-list">
        {items.map((task) => (
          <li key={task.id} data-testid={`rhythm-task-row-${task.id}`}>
            <label>
              <input
                type="checkbox"
                checked={task.status === 'done'}
                onChange={() => void toggleDone(task)}
                data-testid={`rhythm-task-complete-${task.id}`}
              />
              <span>{task.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
