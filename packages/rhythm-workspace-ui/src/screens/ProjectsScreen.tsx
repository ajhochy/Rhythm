// PENDING PRODUCTION EXTRACTION (issue #4 remaining scope): placeholder view wired to the
// real ProjectsGateway contract (roster + derived step-completion only), not yet ported to
// feature parity with apps/web/src/pages/projects (templates, milestones, step editing).
import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmProject } from '../domain/types';

function completionPercent(project: RhythmProject): number {
  if (project.steps.length === 0) return 0;
  const done = project.steps.filter((step) => step.status === 'done').length;
  return Math.round((done / project.steps.length) * 100);
}

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
            <span> · {completionPercent(project)}%</span>
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
