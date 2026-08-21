import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmFacilityRequest } from '../domain/types';

export function FacilitiesScreen() {
  const { facilities } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmFacilityRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    void facilities.list().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [facilities]);

  return (
    <ScreenRoot screenName="Facilities" testId="rhythm-facilities-screen">
      <h1>Facilities</h1>
      <ul data-testid="rhythm-facilities-list">
        {items.map((request) => (
          <li key={request.id} data-testid={`rhythm-facility-row-${request.id}`}>
            <span>{request.roomName}</span>
            <span> · requested for {request.requestedFor}</span>
            <span> · {request.status}</span>
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
