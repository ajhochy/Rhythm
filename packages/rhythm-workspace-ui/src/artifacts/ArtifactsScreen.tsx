import { useEffect, useState } from 'react';
import { ScreenRoot } from '../screens/ScreenRoot';
import type { ArtifactsGateway, RhythmArtifact } from './types';

export interface ArtifactsScreenProps {
  /** Deliberately optional and separate from RhythmDomainGateway — a host must pass this
   * explicitly to unlock the screen. See src/artifacts/types.ts. */
  artifactsGateway?: ArtifactsGateway;
}

export function ArtifactsScreen({ artifactsGateway }: ArtifactsScreenProps) {
  const [items, setItems] = useState<RhythmArtifact[]>([]);

  useEffect(() => {
    if (!artifactsGateway) return;
    let cancelled = false;
    void artifactsGateway.list().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [artifactsGateway]);

  return (
    <ScreenRoot
      screenName="Artifacts"
      testId="rhythm-artifacts-screen"
      extraDataAttributes={{ 'data-rhythm-artifacts-state': artifactsGateway ? 'unlocked' : 'locked' }}
    >
      <h1>Artifacts</h1>
      {artifactsGateway ? (
        <ul data-testid="rhythm-artifacts-list">
          {items.map((artifact) => (
            <li key={artifact.id} data-testid={`rhythm-artifact-row-${artifact.id}`}>
              {artifact.title}
            </li>
          ))}
        </ul>
      ) : (
        <p role="status">Artifacts are locked until the host explicitly grants this security gate.</p>
      )}
    </ScreenRoot>
  );
}
