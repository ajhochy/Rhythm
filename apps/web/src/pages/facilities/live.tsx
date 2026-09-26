import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FocusDialog } from '../../components/FocusDialog';
import { Timestamp } from '../../components/Timestamp';
import { wallClockInstant } from '../../timestamps';
import { ListInspector, useSelectedId, type ListInspectorItem } from '../../components/ListInspector';
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

function facilityIdFromRoute(route: string): number | null {
  const match = route.match(/^\/facilities\/rooms\/([^/]+)$/);
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

function compactReservationRange(startValue: string, endValue: string): string {
  const start = wallClockInstant(startValue);
  const end = wallClockInstant(endValue);
  if (!start || !end) return 'Time unavailable';
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const startDate = date.format(start);
  const endDate = date.format(end);
  const startTime = time.format(start);
  const endTime = time.format(end);
  const startPeriod = startTime.match(/ (AM|PM)$/)?.[1];
  const endPeriod = endTime.match(/ (AM|PM)$/)?.[1];
  const compactStartTime = startPeriod === endPeriod ? startTime.replace(/ (AM|PM)$/, '') : startTime;
  return startDate === endDate
    ? `${startDate}, ${compactStartTime}–${endTime}`
    : `${startDate}, ${startTime}–${endDate}, ${endTime}`;
}

function roomSubtitle(facility: Facility, reservationCount: number): string {
  if (facility.description) return facility.description;
  if (facility.location) return facility.location;
  if (facility.capacity != null) return `Capacity ${facility.capacity}`;
  return `${reservationCount} reservation${reservationCount === 1 ? '' : 's'}`;
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
  const [selectedItemId, setSelectedItemId] = useSelectedId('facilityItemId');
  const selectedFacilityRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
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

  const routeReservationId = reservationIdFromRoute(route);
  const routeFacilityId = facilityIdFromRoute(route);
  const requestedItemId = routeReservationId !== null ? `facilities-reservation-${routeReservationId}` : routeFacilityId !== null ? `facilities-room-${routeFacilityId}` : null;
  const effectiveSelectedItemId = selectedItemId ?? requestedItemId ?? (facilities[0] ? `facilities-room-${facilities[0].id}` : reservations[0] ? `facilities-reservation-${reservations[0].id}` : null);
  const selectedReservationId = effectiveSelectedItemId?.startsWith('facilities-reservation-') ? Number(effectiveSelectedItemId.slice('facilities-reservation-'.length)) : null;
  const selectedRoomId = effectiveSelectedItemId?.startsWith('facilities-room-') ? Number(effectiveSelectedItemId.slice('facilities-room-'.length)) : null;
  const selectedReservation = Number.isFinite(selectedReservationId) ? reservations.find((reservation) => reservation.id === selectedReservationId) ?? null : null;
  const selectedFacilityId = Number.isFinite(selectedRoomId) ? selectedRoomId : selectedReservation?.facilityId ?? null;
  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) ?? null;
  selectedFacilityRef.current = selectedFacilityId;
  const facilityReservations = useMemo(
    () => reservations.filter((reservation) => !selectedFacilityId || reservation.facilityId === selectedFacilityId),
    [reservations, selectedFacilityId],
  );

  useEffect(() => {
    if (selectedItemId === null && effectiveSelectedItemId !== null) setSelectedItemId(effectiveSelectedItemId);
  }, [effectiveSelectedItemId, selectedItemId, setSelectedItemId]);

  const load = async () => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const filters = { ...(rangeStart ? { start: rangeStart } : {}), ...(rangeEnd ? { end: rangeEnd } : {}), ...(buildingFilter ? { building: buildingFilter } : {}) };
      const [loadedFacilities, loadedReservations, loadedGroups] = await Promise.all([gateway.facilities(), gateway.reservations(filters), gateway.reservationGroups(filters)]);
      const loadedSeries = (await Promise.all(loadedFacilities.map((facility) => gateway.reservationSeries(facility.id).catch(() => [])))).flat();
      if (generation === loadGenerationRef.current) {
        setFacilities(loadedFacilities);
        setReservations(loadedReservations);
        setGroups(loadedGroups);
        setSeries(loadedSeries);
      }
    } catch (error) {
      if (generation === loadGenerationRef.current) setLoadError(boundedMessage(error));
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [gateway, rangeStart, rangeEnd, buildingFilter]);

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
      loadGenerationRef.current += 1;
      setLoading(false);
      setFacilities((current) => editingFacility ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setSelectedItemId(`facilities-room-${saved.id}`);
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
        loadGenerationRef.current += 1;
        setLoading(false);
        setFacilities((current) => current.filter((item) => item.id !== deleteTarget.facility.id));
        setReservations((current) => current.filter((item) => item.facilityId !== deleteTarget.facility.id));
      } else if (deleteTarget.kind === 'reservation') {
        await gateway.deleteReservation(deleteTarget.reservation.facilityId, deleteTarget.reservation.id);
        loadGenerationRef.current += 1;
        setLoading(false);
        setReservations((current) => current.filter((item) => item.id !== deleteTarget.reservation.id));
      } else if (deleteTarget.kind === 'series') {
        await gateway.deleteReservationSeries(deleteTarget.series.facilityId, deleteTarget.series.id);
        loadGenerationRef.current += 1;
        setLoading(false);
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
      const savedReservations = 'reservations' in created ? created.reservations : [created];
      loadGenerationRef.current += 1;
      setLoading(false);
      setReservations((current) => {
        if (editingReservation) {
          const saved = savedReservations[0];
          return saved ? current.map((item) => item.id === saved.id ? saved : item) : current;
        }
        const merged = new Map(current.map((item) => [item.id, item]));
        savedReservations.forEach((item) => merged.set(item.id, item));
        return [...merged.values()];
      });
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
      loadGenerationRef.current += 1;
      setLoading(false);
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

  const buildingNames = [...new Set(facilities.map((facility) => facility.building ?? 'Unassigned'))];
  const inspectorGroups = [
    ...buildingNames.map((building) => ({ id: `building-${building.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label: building })),
    { id: 'reservations', label: selectedFacility ? `${selectedFacility.name} reservations` : 'Reservations' },
  ];
  const inspectorItems: ListInspectorItem[] = [
    ...facilities.map((facility) => ({
      id: `facilities-room-${facility.id}`,
      title: facility.name,
      subtitle: roomSubtitle(facility, reservations.filter((reservation) => reservation.facilityId === facility.id).length),
      meta: facility.building ?? 'Unassigned',
      group: `building-${(facility.building ?? 'Unassigned').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    })),
    ...facilityReservations.map((reservation) => ({
      id: `facilities-reservation-${reservation.id}`,
      title: reservation.title,
      subtitle: compactReservationRange(reservation.startTime, reservation.endTime),
      meta: reservation.requesterName,
      badge: reservation.isConflicted ? 'Conflict' : reservation.seriesId ? 'Series' : reservation.groupId ? 'Linked' : undefined,
      group: 'reservations',
    })),
  ];

  return (
    <section className="page-shell pg-facilities" aria-labelledby="facilities-title" data-testid="page-facilities" {...(selectedReservationId != null ? { 'data-selected-stable-id': selectedReservationId } : {})}>
      <header className="facilities-page-header facilities-header">
        <div className="facilities-heading"><h1 id="facilities-title">Facilities</h1><p>Rooms, schedules, and reservations</p></div>
      </header>

      {!canManage && <div className="facilities-readonly" id="facilities-live-readonly" role="status"><strong>Read-only Facilities</strong><span>Inspection remains available for this account.</span></div>}

      <ListInspector
        className="facilities-list-inspector facilities-live-inspector"
        label="Facilities and reservations"
        items={inspectorItems}
        groups={inspectorGroups}
        selectedId={effectiveSelectedItemId}
        onSelect={(id) => { setSelectedItemId(id); setAutomationPreview(null); }}
        loading={loading}
        error={loadError ? <span data-testid="facilities-live-error">{loadError}</span> : undefined}
        searchable
        searchPlaceholder="Search rooms and reservations"
        toolbar={<div className="facilities-list-toolbar">
          <fieldset className="facilities-rail-filters">
            <legend>Reservation range</legend>
            <label>Start<input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} data-testid="facilities-range-start" /></label>
            <label>End<input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} data-testid="facilities-range-end" /></label>
            <label className="facilities-building-filter">Building<select value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)} data-testid="facilities-building-filter"><option value="">All buildings</option>{[...new Set(facilities.map((facility) => facility.building).filter(Boolean))].map((building) => <option key={building!} value={building!}>{building}</option>)}</select></label>
          </fieldset>
          <fieldset className="facilities-list-actions" disabled={!canManage} aria-describedby={!canManage ? 'facilities-live-readonly' : undefined}>
            <legend className="sr-only">Facilities creation actions</legend>
            <button className="secondary-button compact" type="button" onClick={openFacilityDialog} data-testid="facilities-add-room">Add facility</button>
            <button className="primary-button compact" type="button" onClick={openReservationDialog} disabled={!selectedFacilityId} data-testid="facilities-reserve-space">Reserve space</button>
          </fieldset>
        </div>}
        listFooter={<span className="facilities-list-count">{facilities.length} rooms · {facilityReservations.length} reservations</span>}
        emptyState={<div className="facilities-local-empty" data-testid="facilities-empty"><h3>No facilities yet</h3><p>Add a facility to begin managing room reservations.</p></div>}
        inspector={(item) => {
          if (!item) return <div className="facilities-inspector-empty"><span>Select a room or reservation</span><p>Choose an item to inspect its details and available actions.</p></div>;
          if (item.id.startsWith('facilities-reservation-')) {
            const reservation = reservations.find((entry) => `facilities-reservation-${entry.id}` === item.id);
            if (!reservation) return null;
            const facility = facilities.find((entry) => entry.id === reservation.facilityId);
            const group = reservation.groupId ? groups.find((entry) => entry.group.id === reservation.groupId) : null;
            const reservationSeries = reservation.seriesId ? series.find((entry) => entry.id === reservation.seriesId) : null;
            return <section className="facilities-detail-sheet" aria-label="Reservations" data-testid="facilities-reservations-panel">
              <div className="facilities-detail-heading"><div><span>{reservation.seriesId ? 'Recurring series' : reservation.groupId ? 'Multi-room group' : 'Reservation'}</span><p>{facility?.name ?? 'Unknown facility'} · {reservation.requesterName}</p></div><div className="facilities-detail-actions"><button className="secondary-button" type="button" disabled={!canManage} onClick={() => editReservation(reservation)} data-testid={`facilities-reservation-edit-${reservation.id}`}>Edit reservation</button><button className="text-danger-button" type="button" disabled={!canManage} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'reservation', reservation }); }} data-testid={`facilities-reservation-delete-${reservation.id}`}>Delete reservation</button></div></div>
              <dl className="facilities-detail-grid"><div><dt>Room</dt><dd>{facility?.name ?? 'Unknown facility'}</dd></div><div><dt>Requester</dt><dd>{reservation.requesterName}</dd></div><div><dt>Starts</dt><dd><Timestamp value={wallClockInstant(reservation.startTime)?.toISOString()} /></dd></div><div><dt>Ends</dt><dd><Timestamp value={wallClockInstant(reservation.endTime)?.toISOString()} /></dd></div><div className="span-all"><dt>Notes</dt><dd>{reservation.notes ?? 'No setup notes'}</dd></div></dl>
              {reservation.isConflicted && <p className="facilities-form-alert" role="status" data-testid={`facilities-reservation-conflict-${reservation.id}`}>Conflict{reservation.conflictReason ? `: ${reservation.conflictReason}` : ''}</p>}
              {group && <section className="facilities-related-section" aria-label="Multi-room reservation group"><h3>Multi-room group</h3><p>{group.facilities.map((entry) => entry.name).join(', ')}{group.conflictCount ? ` · ${group.conflictCount} conflicts` : ' · no conflicts'}</p></section>}
              {reservationSeries && <section className="facilities-related-section" aria-label="Recurring reservation series"><h3>Recurring series</h3><p>{reservationSeries.recurrenceType} · starts {reservationSeries.startDate}</p><button className="text-danger-button" type="button" disabled={!canManage} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'series', series: reservationSeries }); }} data-testid={`facilities-series-delete-${reservationSeries.id}`}>Delete entire series</button></section>}
            </section>;
          }
          const facility = facilities.find((entry) => `facilities-room-${entry.id}` === item.id);
          if (!facility) return null;
          const roomGroups = groups.filter((entry) => entry.facilities.some((groupFacility) => groupFacility.id === facility.id));
          const roomSeries = series.filter((entry) => entry.facilityId === facility.id);
          const roomReservations = reservations.filter((entry) => entry.facilityId === facility.id);
          return <section className="facilities-detail-sheet" data-testid="facilities-room-detail">
            <div className="facilities-detail-heading"><div><span>{facility.building ?? 'Unassigned'}</span><p>{roomSubtitle(facility, roomReservations.length)}</p></div><div className="facilities-detail-actions"><button className="primary-button compact" type="button" disabled={!canManage} onClick={openReservationDialog} data-testid="facilities-room-reserve">Reserve this room</button><button className="secondary-button compact" type="button" disabled={!canManage} onClick={() => editFacility(facility)} data-testid={`facilities-room-edit-${facility.id}`}>Edit facility</button><button className="secondary-button compact" type="button" disabled={!canManage} onClick={openSeriesDialog} data-testid="facilities-add-series">Recurring series</button><button className="secondary-button compact" type="button" onClick={() => void previewAutomation()} data-testid="facilities-automation-preview">Preview automation reservations</button>{automationPreview !== null && <button className="secondary-button compact" type="button" onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'automation', preview: automationPreview }); }} disabled={automationPreview.total === 0 || !canManage} data-testid="facilities-automation-clear">Remove automation reservations</button>}<button className="text-danger-button" type="button" disabled={!canManage} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'facility', facility }); }} data-testid={`facilities-room-delete-${facility.id}`}>Delete facility</button></div></div>
            <dl className="facilities-detail-grid"><div><dt>Building</dt><dd>{facility.building ?? 'Unassigned'}</dd></div><div><dt>Capacity</dt><dd>{facility.capacity ?? 'Not set'}</dd></div><div><dt>Reservations</dt><dd>{roomReservations.length}</dd></div><div><dt>Availability</dt><dd>{roomReservations.some((reservation) => reservation.isConflicted) ? 'Review conflicts below' : 'No reported conflicts'}</dd></div></dl>
            {automationError && <p role="alert" data-testid="facilities-automation-error">{automationError}</p>}
            {automationPreview && <section className="facilities-automation-preview" aria-label="Automation cleanup preview" data-testid="facilities-automation-preview-result"><div><span>Reservations in scope</span><strong>{automationPreview.total}</strong></div><div><p>{automationPreview.total} automation reservation{automationPreview.total === 1 ? '' : 's'}</p>{automationPreview.byFacility.map((entry) => <p key={entry.facilityId}>{entry.facilityName}: {entry.count}</p>)}</div></section>}
            <section className="facilities-related-section" aria-label="Upcoming reservations"><h3>Upcoming reservations</h3>{roomReservations.length ? roomReservations.map((reservation) => <button type="button" key={reservation.id} onClick={() => setSelectedItemId(`facilities-reservation-${reservation.id}`)}><strong>{reservation.title}</strong><span><Timestamp value={wallClockInstant(reservation.startTime)?.toISOString()} /></span></button>) : <p data-testid="facilities-reservations-empty">No reservations.</p>}</section>
            {roomGroups.length > 0 && <section className="facilities-related-section" aria-label="Multi-room reservation groups"><h3>Multi-room groups</h3>{roomGroups.map((group) => <p key={group.group.id}><strong>{group.group.title}</strong> · {group.facilities.map((entry) => entry.name).join(', ')}{group.conflictCount ? ` · ${group.conflictCount} conflicts` : ''}</p>)}</section>}
            {roomSeries.length > 0 && <section className="facilities-related-section" aria-label="Recurring reservation series"><h3>Recurring series</h3>{roomSeries.map((entry) => <div className="facilities-related-row" key={entry.id}><p><strong>{entry.title}</strong> · {entry.recurrenceType}</p><button type="button" className="text-danger-button" disabled={!canManage} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'series', series: entry }); }} data-testid={`facilities-series-delete-${entry.id}`}>Delete entire series</button></div>)}</section>}
          </section>;
        }}
      />

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
