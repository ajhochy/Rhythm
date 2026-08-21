import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmProject } from '../domain/types';

export function ProjectsScreen() {
  const { projects } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmProject[]>([]);

  useEffect(() => {
    let cancelled = false;
    void projects.list().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  return (
    <ScreenRoot screenName="Projects" testId="rhythm-projects-screen">
      <h1>Projects</h1>
      <ul data-testid="rhythm-projects-list">
        {items.map((project) => (
          <li key={project.id} data-testid={`rhythm-project-row-${project.id}`}>
            <span>{project.name}</span>
            <span> · {project.status.replace('_', ' ')}</span>
            <span> · {project.progressPercent}%</span>
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
