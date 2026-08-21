// PENDING PRODUCTION EXTRACTION (issue #4 remaining scope): placeholder view wired to the
// real FacilitiesGateway contract (room roster only), not yet ported to feature parity with
// apps/web/src/pages/facilities (reservation calendar, create/edit, conflict handling).
import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmFacility } from '../domain/types';

export function FacilitiesScreen() {
  const { facilities } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmFacility[]>([]);

  useEffect(() => {
    let cancelled = false;
    void facilities.facilities().then((loaded) => {
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
        {items.map((facility) => (
          <li key={facility.id} data-testid={`rhythm-facility-row-${facility.id}`}>
            <span>{facility.name}</span>
            {facility.building && <span> · {facility.building}</span>}
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
