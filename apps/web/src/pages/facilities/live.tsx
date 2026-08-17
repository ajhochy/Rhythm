import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { useGateway } from '../../gateway/context';
import {
  FacilitiesGatewayError,
  type Facility,
  type Reservation,
  type RecurrenceType,
} from '../../gateway/facilities';
import './styles.css';

function boundedMessage(error: unknown): string {
  // Never surface raw response bodies, bearer tokens, stack traces, or paths — the gateway's
  // own error text is already a bounded, generic label (apps/web/src/gateway/facilities.ts:46).
  if (error instanceof FacilitiesGatewayError) return error.message;
  return 'Facilities service unavailable';
}

// Reservation.id is a persisted number (apps/api_server/src/models/facility.ts:4), parsed
// straight from the deep link rather than kept as an opaque route string.
function reservationIdFromRoute(route: string): number | null {
  const match = route.match(/^\/facilities\/reservations\/([^/]+)$/);
  if (!match) return null;
  const id = Number(decodeURIComponent(match[1]));
  return Number.isFinite(id) ? id : null;
}

const recurrenceTypes: RecurrenceType[] = ['weekly', 'biweekly', 'monthly', 'custom'];

export function LiveFacilitiesPage({ route }: { route: string }) {
  // apps/web/src/gateway/index.ts:98 — every domain shares the one bearer from the signed-in
  // session; Facilities must not build its own gateway from a build-time/test-only env value.
  const gateway = useGateway().domains.facilities!;

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState<number | null>(null);
  const [selectedReservationId] = useState<number | null>(() => reservationIdFromRoute(route));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [facilityDialogOpen, setFacilityDialogOpen] = useState(false);
  const [facilityName, setFacilityName] = useState('');
  const [facilityBuilding, setFacilityBuilding] = useState('');
  const [facilityError, setFacilityError] = useState('');

  const [reservationDialogOpen, setReservationDialogOpen] = useState(false);
  const [reservationTitle, setReservationTitle] = useState('');
  const [reservationRequester, setReservationRequester] = useState('');
  const [reservationStart, setReservationStart] = useState('');
  const [reservationEnd, setReservationEnd] = useState('');
  const [reservationError, setReservationError] = useState('');

  const [seriesDialogOpen, setSeriesDialogOpen] = useState(false);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesRequester, setSeriesRequester] = useState('');
  const [seriesRecurrence, setSeriesRecurrence] = useState<RecurrenceType>('weekly');
  const [seriesStartDate, setSeriesStartDate] = useState('');
  const [seriesStartTime, setSeriesStartTime] = useState('');
  const [seriesEndTime, setSeriesEndTime] = useState('');
  const [seriesError, setSeriesError] = useState('');

  const [automationPreview, setAutomationPreview] = useState<unknown>(null);
  const [automationError, setAutomationError] = useState('');

  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) ?? null;
  const facilityReservations = useMemo(
    () => reservations.filter((reservation) => !selectedFacilityId || reservation.facilityId === selectedFacilityId),
    [reservations, selectedFacilityId],
  );

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [loadedFacilities, loadedReservations] = await Promise.all([gateway.facilities(), gateway.reservations()]);
      setFacilities(loadedFacilities);
      setReservations(loadedReservations);
      const deepLinkedFacilityId = selectedReservationId != null ? loadedReservations.find((reservation) => reservation.id === selectedReservationId)?.facilityId : undefined;
      setSelectedFacilityId((current) => current ?? deepLinkedFacilityId ?? loadedFacilities[0]?.id ?? null);
    } catch (error) {
      setLoadError(boundedMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [gateway]);

  const openFacilityDialog = () => {
    setFacilityName('');
    setFacilityBuilding('');
    setFacilityError('');
    setFacilityDialogOpen(true);
  };

  const submitFacility = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = facilityName.trim();
    if (!name) { setFacilityError('Enter a facility name.'); return; }
    try {
      // CreateFacilityInput — apps/web/src/gateway/facilities.ts:15, matching
      // apps/api_server/src/models/facility.ts create fields.
      const created = await gateway.createFacility({ name, building: facilityBuilding.trim() || null });
      setFacilities((current) => [...current, created]);
      setSelectedFacilityId(created.id);
      setFacilityDialogOpen(false);
    } catch (error) {
      setFacilityError(boundedMessage(error));
    }
  };

  const deleteFacility = async (facility: Facility) => {
    try {
      await gateway.deleteFacility(facility.id);
      setFacilities((current) => current.filter((item) => item.id !== facility.id));
      setReservations((current) => current.filter((item) => item.facilityId !== facility.id));
      setSelectedFacilityId((current) => current === facility.id ? null : current);
    } catch (error) {
      setLoadError(boundedMessage(error));
    }
  };

  const openReservationDialog = () => {
    setReservationTitle('');
    setReservationRequester('');
    setReservationStart('');
    setReservationEnd('');
    setReservationError('');
    setReservationDialogOpen(true);
  };

  const submitReservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFacilityId) return;
    const title = reservationTitle.trim();
    const requesterName = reservationRequester.trim();
    if (!title || !requesterName || !reservationStart || !reservationEnd) { setReservationError('Title, requester, start, and end are required.'); return; }
    try {
      // Request DTO uses snake_case — apps/api_server/src/models/facility.ts:85-105,
      // surfaced by CreateReservationInput (apps/web/src/gateway/facilities.ts:17).
      const created = await gateway.createReservation(selectedFacilityId, {
        title,
        requester_name: requesterName,
        start_time: reservationStart,
        end_time: reservationEnd,
      });
      const reservation = 'reservations' in created ? created.reservations[0] : created;
      if (reservation) setReservations((current) => [...current, reservation]);
      setReservationDialogOpen(false);
    } catch (error) {
      setReservationError(boundedMessage(error));
    }
  };

  const deleteReservation = async (reservation: Reservation) => {
    try {
      await gateway.deleteReservation(reservation.facilityId, reservation.id);
      setReservations((current) => current.filter((item) => item.id !== reservation.id));
    } catch (error) {
      setLoadError(boundedMessage(error));
    }
  };

  const openSeriesDialog = () => {
    setSeriesTitle('');
    setSeriesRequester('');
    setSeriesRecurrence('weekly');
    setSeriesStartDate('');
    setSeriesStartTime('');
    setSeriesEndTime('');
    setSeriesError('');
    setSeriesDialogOpen(true);
  };

  const submitSeries = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFacilityId) return;
    const title = seriesTitle.trim();
    const requesterName = seriesRequester.trim();
    if (!title || !requesterName || !seriesStartDate || !seriesStartTime || !seriesEndTime) { setSeriesError('Title, requester, start date, and start/end time are required.'); return; }
    try {
      // recurrence_type is weekly|biweekly|monthly|custom — apps/api_server/src/models/facility.ts:172-185,
      // via CreateReservationSeriesInput (apps/web/src/gateway/facilities.ts:19).
      const result = await gateway.createReservationSeries(selectedFacilityId, {
        facility_id: selectedFacilityId,
        title,
        requester_name: requesterName,
        recurrence_type: seriesRecurrence,
        start_time: seriesStartTime,
        end_time: seriesEndTime,
        start_date: seriesStartDate,
      });
      setReservations((current) => [...current, ...result.createdReservations]);
      setSeriesDialogOpen(false);
    } catch (error) {
      setSeriesError(boundedMessage(error));
    }
  };

  const previewAutomation = async () => {
    setAutomationError('');
    try {
      setAutomationPreview(await gateway.previewAutomationReservations(selectedFacilityId ? { facilityId: selectedFacilityId } : undefined));
    } catch (error) {
      setAutomationError(boundedMessage(error));
    }
  };

  const clearAutomation = async () => {
    setAutomationError('');
    try {
      await gateway.deleteAutomationReservations(selectedFacilityId ? { facilityId: selectedFacilityId } : undefined);
      setAutomationPreview(null);
      await load();
    } catch (error) {
      setAutomationError(boundedMessage(error));
    }
  };

  return (
    <section className="page-shell pg-facilities" aria-labelledby="facilities-title" data-testid="page-facilities" {...(selectedReservationId != null ? { 'data-selected-stable-id': selectedReservationId } : {})}>
      <header className="facilities-page-header">
        <div><span className="eyebrow">Rhythm workspace</span><h1 id="facilities-title">Facilities</h1></div>
        <div>
          <button className="secondary-button" type="button" onClick={openFacilityDialog} data-testid="facilities-add-room">Add facility</button>
          <button className="primary-button" type="button" onClick={openReservationDialog} disabled={!selectedFacilityId} data-testid="facilities-reserve-space">Reserve space</button>
        </div>
      </header>

      {loadError && <p role="alert" data-testid="facilities-live-error">{loadError}</p>}

      {loading ? <p role="status" data-testid="page-state-loading">Loading facilities…</p> : (
        <div className="facilities-workspace">
          <ul className="facilities-room-list" role="list" data-testid="facilities-room-list">
            {facilities.map((facility) => (
              <li key={facility.id} className="facilities-room-card">
                <button type="button" aria-pressed={selectedFacilityId === facility.id} onClick={() => setSelectedFacilityId(facility.id)} data-testid={`facilities-room-${facility.id}`}>
                  <strong>{facility.name}</strong>
                  {facility.building && <small>{facility.building}</small>}
                </button>
                <button type="button" onClick={() => void deleteFacility(facility)} data-testid={`facilities-room-delete-${facility.id}`}>Delete</button>
              </li>
            ))}
            {facilities.length === 0 && <li data-testid="facilities-empty">No facilities yet.</li>}
          </ul>

          <section aria-label="Reservations" data-testid="facilities-reservations-panel">
            <header>
              <h2>{selectedFacility ? selectedFacility.name : 'All reservations'}</h2>
              <button className="secondary-button" type="button" onClick={openSeriesDialog} disabled={!selectedFacilityId} data-testid="facilities-add-series">Recurring series</button>
              <button className="secondary-button" type="button" onClick={() => void previewAutomation()} data-testid="facilities-automation-preview">Preview automation reservations</button>
              {automationPreview !== null && <button className="secondary-button" type="button" onClick={() => void clearAutomation()} data-testid="facilities-automation-clear">Remove automation reservations</button>}
            </header>
            {automationError && <p role="alert" data-testid="facilities-automation-error">{automationError}</p>}
            <ul role="list" data-testid="facilities-reservation-list">
              {facilityReservations.map((reservation) => (
                <li key={reservation.id} data-testid={`facilities-reservation-${reservation.id}`}>
                  <strong>{reservation.title}</strong>
                  <span>{reservation.requesterName}</span>
                  <time dateTime={reservation.startTime}>{reservation.startTime}</time>–<time dateTime={reservation.endTime}>{reservation.endTime}</time>
                  {reservation.isConflicted && <span role="status" data-testid={`facilities-reservation-conflict-${reservation.id}`}>Conflict{reservation.conflictReason ? `: ${reservation.conflictReason}` : ''}</span>}
                  <button type="button" onClick={() => void deleteReservation(reservation)} data-testid={`facilities-reservation-delete-${reservation.id}`}>Delete</button>
                </li>
              ))}
              {facilityReservations.length === 0 && <li data-testid="facilities-reservations-empty">No reservations.</li>}
            </ul>
          </section>
        </div>
      )}

      <FocusDialog open={facilityDialogOpen} onClose={() => setFacilityDialogOpen(false)} title="Add facility" testId="facilities-room-dialog">
        <form onSubmit={(event) => void submitFacility(event)}>
          <label>Name<input data-autofocus value={facilityName} onChange={(event) => setFacilityName(event.target.value)} data-testid="facilities-room-name" /></label>
          <label>Building<input value={facilityBuilding} onChange={(event) => setFacilityBuilding(event.target.value)} data-testid="facilities-room-building" /></label>
          {facilityError && <p role="alert" data-testid="facilities-room-error">{facilityError}</p>}
          <div className="dialog-actions"><button type="button" onClick={() => setFacilityDialogOpen(false)}>Cancel</button><button type="submit" data-testid="facilities-room-save">Save</button></div>
        </form>
      </FocusDialog>

      <FocusDialog open={reservationDialogOpen} onClose={() => setReservationDialogOpen(false)} title="Reserve space" testId="facilities-reservation-dialog">
        <form onSubmit={(event) => void submitReservation(event)}>
          <label>Title<input data-autofocus value={reservationTitle} onChange={(event) => setReservationTitle(event.target.value)} data-testid="facilities-reservation-title" /></label>
          <label>Requester<input value={reservationRequester} onChange={(event) => setReservationRequester(event.target.value)} data-testid="facilities-reservation-requester" /></label>
          <label>Start<input type="datetime-local" value={reservationStart} onChange={(event) => setReservationStart(event.target.value)} data-testid="facilities-reservation-start" /></label>
          <label>End<input type="datetime-local" value={reservationEnd} onChange={(event) => setReservationEnd(event.target.value)} data-testid="facilities-reservation-end" /></label>
          {reservationError && <p role="alert" data-testid="facilities-reservation-error">{reservationError}</p>}
          <div className="dialog-actions"><button type="button" onClick={() => setReservationDialogOpen(false)}>Cancel</button><button type="submit" data-testid="facilities-reservation-save">Save</button></div>
        </form>
      </FocusDialog>

      <FocusDialog open={seriesDialogOpen} onClose={() => setSeriesDialogOpen(false)} title="Recurring series" testId="facilities-series-dialog">
        <form onSubmit={(event) => void submitSeries(event)}>
          <label>Title<input data-autofocus value={seriesTitle} onChange={(event) => setSeriesTitle(event.target.value)} data-testid="facilities-series-title" /></label>
          <label>Requester<input value={seriesRequester} onChange={(event) => setSeriesRequester(event.target.value)} data-testid="facilities-series-requester" /></label>
          <label>Recurrence<select value={seriesRecurrence} onChange={(event) => setSeriesRecurrence(event.target.value as RecurrenceType)} data-testid="facilities-series-recurrence">{recurrenceTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label>Start date<input type="date" value={seriesStartDate} onChange={(event) => setSeriesStartDate(event.target.value)} data-testid="facilities-series-start-date" /></label>
          <label>Start time<input type="time" value={seriesStartTime} onChange={(event) => setSeriesStartTime(event.target.value)} data-testid="facilities-series-start-time" /></label>
          <label>End time<input type="time" value={seriesEndTime} onChange={(event) => setSeriesEndTime(event.target.value)} data-testid="facilities-series-end-time" /></label>
          {seriesError && <p role="alert" data-testid="facilities-series-error">{seriesError}</p>}
          <div className="dialog-actions"><button type="button" onClick={() => setSeriesDialogOpen(false)}>Cancel</button><button type="submit" data-testid="facilities-series-save">Save</button></div>
        </form>
      </FocusDialog>
    </section>
  );
}
