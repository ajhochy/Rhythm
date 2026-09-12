import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { useGateway } from '../../gateway/context';
import { useAuthUser } from '../../gateway/auth';
import {
  FacilitiesGatewayError,
  type Facility,
  type Reservation,
  type RecurrenceType,
  type ReservationGroupOverview,
  type ReservationSeries,
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

type AutomationPreview = { total: number; byFacility: Array<{ facilityId: number; facilityName: string; count: number }> };
type ScopedAutomationPreview = AutomationPreview & { facilityId: number | null; facilityName: string };
type DeleteTarget =
  | { kind: 'facility'; facility: Facility }
  | { kind: 'reservation'; reservation: Reservation }
  | { kind: 'series'; series: ReservationSeries }
  | { kind: 'automation'; preview: ScopedAutomationPreview };

function isAutomationPreview(value: unknown): value is AutomationPreview {
  if (!value || typeof value !== 'object') return false;
  const preview = value as Partial<AutomationPreview>;
  return Number.isFinite(preview.total) && Array.isArray(preview.byFacility)
    && preview.byFacility.every((item) => Number.isFinite(item.facilityId) && typeof item.facilityName === 'string' && Number.isFinite(item.count));
}

export function LiveFacilitiesPage({ route }: { route: string }) {
  // apps/web/src/gateway/index.ts:98 — every domain shares the one bearer from the signed-in
  // session; Facilities must not build its own gateway from a build-time/test-only env value.
  const gateway = useGateway().domains.facilities!;
  const auth = useAuthUser();
  const canManage = !auth || auth.user.role === 'admin' || auth.user.isFacilitiesManager === true;

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [groups, setGroups] = useState<ReservationGroupOverview[]>([]);
  const [series, setSeries] = useState<ReservationSeries[]>([]);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [buildingFilter, setBuildingFilter] = useState('');
  const [selectedFacilityId, setSelectedFacilityId] = useState<number | null>(null);
  const selectedFacilityRef = useRef<number | null>(null);
  const [selectedReservationId] = useState<number | null>(() => reservationIdFromRoute(route));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [facilityDialogOpen, setFacilityDialogOpen] = useState(false);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [facilityName, setFacilityName] = useState('');
  const [facilityBuilding, setFacilityBuilding] = useState('');
  const [facilityError, setFacilityError] = useState('');

  const [reservationDialogOpen, setReservationDialogOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [reservationTitle, setReservationTitle] = useState('');
  const [reservationRequester, setReservationRequester] = useState('');
  const [reservationStart, setReservationStart] = useState('');
  const [reservationEnd, setReservationEnd] = useState('');
  const [reservationNotes, setReservationNotes] = useState('');
  const [reservationFacilityIds, setReservationFacilityIds] = useState<number[]>([]);
  const [reservationError, setReservationError] = useState('');

  const [seriesDialogOpen, setSeriesDialogOpen] = useState(false);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesRequester, setSeriesRequester] = useState('');
  const [seriesRecurrence, setSeriesRecurrence] = useState<RecurrenceType>('weekly');
  const [seriesStartDate, setSeriesStartDate] = useState('');
  const [seriesStartTime, setSeriesStartTime] = useState('');
  const [seriesEndTime, setSeriesEndTime] = useState('');
  const [seriesError, setSeriesError] = useState('');

  const [automationPreview, setAutomationPreview] = useState<ScopedAutomationPreview | null>(null);
  const [automationError, setAutomationError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletePending, setDeletePending] = useState(false);

  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) ?? null;
  const facilityReservations = useMemo(
    () => reservations.filter((reservation) => !selectedFacilityId || reservation.facilityId === selectedFacilityId),
    [reservations, selectedFacilityId],
  );

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const filters = { ...(rangeStart ? { start: rangeStart } : {}), ...(rangeEnd ? { end: rangeEnd } : {}), ...(buildingFilter ? { building: buildingFilter } : {}) };
      const [loadedFacilities, loadedReservations, loadedGroups] = await Promise.all([gateway.facilities(), gateway.reservations(filters), gateway.reservationGroups(filters)]);
      setFacilities(loadedFacilities);
      setReservations(loadedReservations);
      setGroups(loadedGroups);
      const deepLinkedFacilityId = selectedReservationId != null ? loadedReservations.find((reservation) => reservation.id === selectedReservationId)?.facilityId : undefined;
      setSelectedFacilityId((current) => {
        const next = current ?? deepLinkedFacilityId ?? loadedFacilities[0]?.id ?? null;
        selectedFacilityRef.current = next;
        return next;
      });
    } catch (error) {
      setLoadError(boundedMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [gateway, rangeStart, rangeEnd, buildingFilter]);
  useEffect(() => {
    if (!selectedFacilityId) { setSeries([]); return; }
    void gateway.reservationSeries(selectedFacilityId).then(setSeries).catch(() => setSeries([]));
  }, [gateway, selectedFacilityId]);

  const openFacilityDialog = () => {
    setEditingFacility(null);
    setFacilityName('');
    setFacilityBuilding('');
    setFacilityError('');
    setFacilityDialogOpen(true);
  };
  const editFacility = (facility: Facility) => { setEditingFacility(facility); setFacilityName(facility.name); setFacilityBuilding(facility.building ?? ''); setFacilityError(''); setFacilityDialogOpen(true); };

  const submitFacility = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = facilityName.trim();
    if (!name) { setFacilityError('Enter a facility name.'); return; }
    try {
      // CreateFacilityInput — apps/web/src/gateway/facilities.ts:15, matching
      // apps/api_server/src/models/facility.ts create fields.
      const saved = editingFacility
        ? await gateway.updateFacility(editingFacility.id, { name, building: facilityBuilding.trim() || null })
        : await gateway.createFacility({ name, building: facilityBuilding.trim() || null });
      setFacilities((current) => editingFacility ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      selectedFacilityRef.current = saved.id;
      setSelectedFacilityId(saved.id);
      setFacilityDialogOpen(false);
    } catch (error) {
      setFacilityError(boundedMessage(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deletePending) return;
    if (deleteTarget.kind === 'automation'
      && (automationPreview !== deleteTarget.preview || selectedFacilityId !== deleteTarget.preview.facilityId)) {
      setDeleteTarget(null);
      setAutomationPreview(null);
      setAutomationError('The cleanup scope changed. Preview it again before removing reservations.');
      return;
    }
    setDeletePending(true);
    setDeleteError('');
    try {
      if (deleteTarget.kind === 'facility') {
        await gateway.deleteFacility(deleteTarget.facility.id);
        setFacilities((current) => current.filter((item) => item.id !== deleteTarget.facility.id));
        setReservations((current) => current.filter((item) => item.facilityId !== deleteTarget.facility.id));
        setSelectedFacilityId((current) => {
          const next = current === deleteTarget.facility.id ? null : current;
          selectedFacilityRef.current = next;
          return next;
        });
      } else if (deleteTarget.kind === 'reservation') {
        await gateway.deleteReservation(deleteTarget.reservation.facilityId, deleteTarget.reservation.id);
        setReservations((current) => current.filter((item) => item.id !== deleteTarget.reservation.id));
      } else if (deleteTarget.kind === 'series') {
        await gateway.deleteReservationSeries(deleteTarget.series.facilityId, deleteTarget.series.id);
        setSeries((current) => current.filter((item) => item.id !== deleteTarget.series.id));
        setReservations((current) => current.filter((item) => item.seriesId !== deleteTarget.series.id));
      } else {
        await gateway.deleteAutomationReservations(deleteTarget.preview.facilityId ? { facilityId: deleteTarget.preview.facilityId } : undefined);
        setAutomationPreview(null);
        await load();
      }
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(boundedMessage(error));
    } finally {
      setDeletePending(false);
    }
  };

  const openReservationDialog = () => {
    setEditingReservation(null);
    setReservationTitle('');
    setReservationRequester('');
    setReservationStart('');
    setReservationEnd('');
    setReservationNotes('');
    setReservationFacilityIds(selectedFacilityId ? [selectedFacilityId] : []);
    setReservationError('');
    setReservationDialogOpen(true);
  };
  const editReservation = (reservation: Reservation) => { setEditingReservation(reservation); setReservationTitle(reservation.title); setReservationRequester(reservation.requesterName); setReservationStart(reservation.startTime.slice(0, 16)); setReservationEnd(reservation.endTime.slice(0, 16)); setReservationNotes(reservation.notes ?? ''); setReservationFacilityIds([reservation.facilityId]); setReservationError(''); setReservationDialogOpen(true); };

  const submitReservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFacilityId) return;
    const title = reservationTitle.trim();
    const requesterName = reservationRequester.trim();
    if (!title || !requesterName || !reservationStart || !reservationEnd) { setReservationError('Title, requester, start, and end are required.'); return; }
    try {
      // Request DTO uses snake_case — apps/api_server/src/models/facility.ts:85-105,
      // surfaced by CreateReservationInput (apps/web/src/gateway/facilities.ts:17).
      const input = {
        title,
        requester_name: requesterName,
        start_time: reservationStart,
        end_time: reservationEnd,
        notes: reservationNotes.trim() || null,
        facility_ids: reservationFacilityIds.length > 1 ? reservationFacilityIds : null,
      };
      const created = editingReservation
        ? await gateway.updateReservation(editingReservation.facilityId, editingReservation.id, input)
        : await gateway.createReservation(selectedFacilityId, input);
      const reservation = 'reservations' in created ? created.reservations[0] : created;
      if (reservation) setReservations((current) => editingReservation ? current.map((item) => item.id === reservation.id ? reservation : item) : [...current, reservation]);
      if ('conflicts' in created && created.conflicts.length) {
        setReservationError(`${created.conflicts.length} requested room${created.conflicts.length === 1 ? '' : 's'} conflicted and were not reserved.`);
      } else setReservationDialogOpen(false);
    } catch (error) {
      setReservationError(boundedMessage(error));
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
    const facilityId = selectedFacilityId;
    const facilityName = selectedFacility?.name ?? 'all facilities';
    try {
      const preview = await gateway.previewAutomationReservations(facilityId ? { facilityId } : undefined);
      if (!isAutomationPreview(preview)) throw new FacilitiesGatewayError(0, 'Automation preview unavailable');
      if (selectedFacilityRef.current === facilityId) setAutomationPreview({ ...preview, facilityId, facilityName });
    } catch (error) {
      setAutomationError(boundedMessage(error));
    }
  };

  return (
    <section className="page-shell pg-facilities" aria-labelledby="facilities-title" data-testid="page-facilities" {...(selectedReservationId != null ? { 'data-selected-stable-id': selectedReservationId } : {})}>
      <header className="facilities-page-header">
        <div><span className="eyebrow">Rhythm workspace</span><h1 id="facilities-title">Facilities</h1></div>
        <div>
          <button className="secondary-button" type="button" onClick={openFacilityDialog} disabled={!canManage} data-testid="facilities-add-room">Add facility</button>
          <button className="primary-button" type="button" onClick={openReservationDialog} disabled={!selectedFacilityId || !canManage} data-testid="facilities-reserve-space">Reserve space</button>
        </div>
      </header>

      {loadError && <p role="alert" data-testid="facilities-live-error">{loadError}</p>}
      {!canManage && <p role="status">Facilities are read-only for this account.</p>}
      <fieldset className="facilities-filters"><legend>Reservation range</legend><label>Start<input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label><label>End<input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label><label>Building<select value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)}><option value="">All buildings</option>{[...new Set(facilities.map((facility) => facility.building).filter(Boolean))].map((building) => <option key={building!} value={building!}>{building}</option>)}</select></label></fieldset>

      {loading ? <p role="status" data-testid="page-state-loading">Loading facilities…</p> : (
        <div className="facilities-workspace">
          <ul className="facilities-room-list" role="list" data-testid="facilities-room-list">
            {facilities.map((facility) => (
              <li key={facility.id} className="facilities-room-card">
                <button type="button" aria-pressed={selectedFacilityId === facility.id} onClick={() => { selectedFacilityRef.current = facility.id; setSelectedFacilityId(facility.id); setAutomationPreview(null); }} data-testid={`facilities-room-${facility.id}`}>
                  <strong>{facility.name}</strong>
                  {facility.building && <small>{facility.building}</small>}
                </button>
                <button type="button" disabled={!canManage} onClick={() => editFacility(facility)} data-testid={`facilities-room-edit-${facility.id}`}>Edit</button>
                <button type="button" disabled={!canManage} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'facility', facility }); }} data-testid={`facilities-room-delete-${facility.id}`}>Delete</button>
              </li>
            ))}
            {facilities.length === 0 && <li data-testid="facilities-empty">No facilities yet.</li>}
          </ul>

          <section aria-label="Reservations" data-testid="facilities-reservations-panel">
            <header>
              <h2>{selectedFacility ? selectedFacility.name : 'All reservations'}</h2>
              <button className="secondary-button" type="button" onClick={openSeriesDialog} disabled={!selectedFacilityId || !canManage} data-testid="facilities-add-series">Recurring series</button>
              <button className="secondary-button" type="button" onClick={() => void previewAutomation()} data-testid="facilities-automation-preview">Preview automation reservations</button>
              {automationPreview !== null && <button className="secondary-button" type="button" onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'automation', preview: automationPreview }); }} disabled={automationPreview.total === 0} data-testid="facilities-automation-clear">Remove automation reservations</button>}
            </header>
            {automationError && <p role="alert" data-testid="facilities-automation-error">{automationError}</p>}
            {automationPreview && <section aria-label="Automation cleanup preview" data-testid="facilities-automation-preview-result"><strong>{automationPreview.total} automation reservation{automationPreview.total === 1 ? '' : 's'}</strong><ul>{automationPreview.byFacility.map((item) => <li key={item.facilityId}>{item.facilityName}: {item.count}</li>)}</ul></section>}
            <ul role="list" data-testid="facilities-reservation-list">
              {facilityReservations.map((reservation) => (
                <li key={reservation.id} data-testid={`facilities-reservation-${reservation.id}`}>
                  <strong>{reservation.title}</strong>
                  <span>{reservation.requesterName}</span>
                  <time dateTime={reservation.startTime}>{reservation.startTime}</time>–<time dateTime={reservation.endTime}>{reservation.endTime}</time>
                  {reservation.isConflicted && <span role="status" data-testid={`facilities-reservation-conflict-${reservation.id}`}>Conflict{reservation.conflictReason ? `: ${reservation.conflictReason}` : ''}</span>}
                  <button type="button" disabled={!canManage} onClick={() => editReservation(reservation)} data-testid={`facilities-reservation-edit-${reservation.id}`}>Edit</button>
                  <button type="button" disabled={!canManage} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'reservation', reservation }); }} data-testid={`facilities-reservation-delete-${reservation.id}`}>Delete</button>
                </li>
              ))}
              {facilityReservations.length === 0 && <li data-testid="facilities-reservations-empty">No reservations.</li>}
            </ul>
            {groups.length > 0 && <section aria-label="Multi-room reservation groups"><h3>Multi-room groups</h3><ul>{groups.map((group) => <li key={group.group.id}><strong>{group.group.title}</strong> · {group.facilities.map((facility) => facility.name).join(', ')}{group.conflictCount ? ` · ${group.conflictCount} conflicts` : ''}</li>)}</ul></section>}
            {series.length > 0 && <section aria-label="Recurring reservation series"><h3>Recurring series</h3><ul>{series.map((item) => <li key={item.id}><strong>{item.title}</strong> · {item.recurrenceType}<button type="button" disabled={!canManage} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'series', series: item }); }} data-testid={`facilities-series-delete-${item.id}`}>Delete entire series</button></li>)}</ul></section>}
          </section>
        </div>
      )}

      <FocusDialog open={facilityDialogOpen} onClose={() => setFacilityDialogOpen(false)} title={editingFacility ? 'Edit facility' : 'Add facility'} testId="facilities-room-dialog">
        <form onSubmit={(event) => void submitFacility(event)}>
          <label>Name<input data-autofocus value={facilityName} onChange={(event) => setFacilityName(event.target.value)} data-testid="facilities-room-name" /></label>
          <label>Building<input value={facilityBuilding} onChange={(event) => setFacilityBuilding(event.target.value)} data-testid="facilities-room-building" /></label>
          {facilityError && <p role="alert" data-testid="facilities-room-error">{facilityError}</p>}
          <div className="dialog-actions"><button type="button" onClick={() => setFacilityDialogOpen(false)}>Cancel</button><button type="submit" data-testid="facilities-room-save">Save</button></div>
        </form>
      </FocusDialog>

      <FocusDialog open={reservationDialogOpen} onClose={() => setReservationDialogOpen(false)} title={editingReservation ? 'Edit reservation' : 'Reserve space'} testId="facilities-reservation-dialog">
        <form onSubmit={(event) => void submitReservation(event)}>
          <label>Title<input data-autofocus value={reservationTitle} onChange={(event) => setReservationTitle(event.target.value)} data-testid="facilities-reservation-title" /></label>
          <label>Requester<input value={reservationRequester} onChange={(event) => setReservationRequester(event.target.value)} data-testid="facilities-reservation-requester" /></label>
          <label>Start<input type="datetime-local" value={reservationStart} onChange={(event) => setReservationStart(event.target.value)} data-testid="facilities-reservation-start" /></label>
          <label>End<input type="datetime-local" value={reservationEnd} onChange={(event) => setReservationEnd(event.target.value)} data-testid="facilities-reservation-end" /></label>
          <label>Notes<textarea value={reservationNotes} onChange={(event) => setReservationNotes(event.target.value)} data-testid="facilities-reservation-notes" /></label>
          {!editingReservation && <fieldset><legend>Rooms</legend>{facilities.map((facility) => <label key={facility.id}><input type="checkbox" checked={reservationFacilityIds.includes(facility.id)} onChange={(event) => setReservationFacilityIds((current) => event.target.checked ? [...new Set([...current, facility.id])] : current.filter((id) => id !== facility.id))} />{facility.name}</label>)}</fieldset>}
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

      <FocusDialog open={deleteTarget !== null} onClose={() => { if (!deletePending) setDeleteTarget(null); }} title={deleteTarget?.kind === 'automation' ? 'Remove automation reservations?' : deleteTarget?.kind === 'facility' ? 'Delete facility?' : deleteTarget?.kind === 'series' ? 'Delete recurring series?' : 'Delete reservation?'} testId="facilities-delete-dialog">
        {deleteTarget?.kind === 'facility' && <p>Delete {deleteTarget.facility.name} and its reservations?</p>}
        {deleteTarget?.kind === 'reservation' && <p>Delete {deleteTarget.reservation.title} from {facilities.find((item) => item.id === deleteTarget.reservation.facilityId)?.name ?? 'this facility'}?</p>}
        {deleteTarget?.kind === 'series' && <p>Delete the entire {deleteTarget.series.title} series and all of its generated reservations?</p>}
        {deleteTarget?.kind === 'automation' && <><p>Remove {deleteTarget.preview.total} automation reservation{deleteTarget.preview.total === 1 ? '' : 's'} from {deleteTarget.preview.facilityName}?</p><ul>{deleteTarget.preview.byFacility.map((item) => <li key={item.facilityId}>{item.facilityName}: {item.count}</li>)}</ul></>}
        {deleteError && <p role="alert" data-testid="facilities-delete-error">{deleteError}</p>}
        <div className="dialog-actions"><button type="button" onClick={() => setDeleteTarget(null)} disabled={deletePending} data-testid="facilities-delete-cancel">Cancel</button><button type="button" onClick={() => void confirmDelete()} disabled={deletePending} data-testid="facilities-delete-confirm">{deletePending ? 'Deleting…' : 'Delete'}</button></div>
      </FocusDialog>
    </section>
  );
}
