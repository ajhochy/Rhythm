import { useState } from "react";
import { Plus, Users, Calendar, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { motion } from "framer-motion";
import { useFacilities, useFacilityReservations, useCreateReservation } from "@/hooks/useApi";

interface Facility {
  id: number;
  name: string;
  description?: string;
  capacity: number;
  location?: string;
}

interface Reservation {
  id: number;
  facilityId: number;
  title: string;
  reservedBy: string;
  startTime: string;
  endTime: string;
  notes?: string;
}

interface ReserveDialogProps {
  facility: Facility;
  open: boolean;
  onClose: () => void;
}

function ReserveDialog({ facility, open, onClose }: ReserveDialogProps) {
  const createReservation = useCreateReservation();
  const [title, setTitle] = useState("");
  const [reservedBy, setReservedBy] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createReservation.mutate(
      { facilityId: facility.id, title, reservedBy, startTime, endTime, notes: notes || undefined },
      {
        onSuccess: () => {
          setTitle("");
          setReservedBy("");
          setStartTime("");
          setEndTime("");
          setNotes("");
          onClose();
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reserve {facility.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
            <Input
              placeholder="e.g. Staff Meeting"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Reserved By</label>
            <Input
              placeholder="Your name"
              value={reservedBy}
              onChange={(e) => setReservedBy(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Start Time</label>
              <Input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">End Time</label>
              <Input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label>
            <Input
              placeholder="Any additional details"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={createReservation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createReservation.isPending}>
              {createReservation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Reserve
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface FacilityCardProps {
  facility: Facility;
}

function FacilityCard({ facility }: FacilityCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: reservations = [], isLoading } = useFacilityReservations(facility.id);

  function formatTime(iso: string) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  return (
    <>
      <Card className="shadow-sm border-border/60 hover:shadow-md transition-shadow">
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">{facility.name}</h3>
              {facility.location && (
                <p className="text-[11px] text-muted-foreground mt-0.5">{facility.location}</p>
              )}
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>Capacity: {facility.capacity}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge
                className={`text-[10px] font-medium border-0 shrink-0 ${
                  reservations.length === 0
                    ? "bg-success/10 text-success"
                    : "bg-accent text-accent-foreground"
                }`}
              >
                {isLoading ? "..." : reservations.length === 0 ? "Available" : `${reservations.length} booked`}
              </Badge>
              <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => setDialogOpen(true)}>
                Reserve
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Loading reservations…</span>
            </div>
          ) : reservations.length > 0 ? (
            <div className="space-y-2">
              {(reservations as Reservation[]).map((res) => (
                <div key={res.id} className="flex items-start gap-2 p-2 rounded-lg bg-secondary/50">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{res.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatTime(res.startTime)} – {formatTime(res.endTime)} · {res.reservedBy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No upcoming reservations</p>
          )}
        </CardContent>
      </Card>

      <ReserveDialog facility={facility} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}

interface TopReserveDialogProps {
  facilities: Facility[];
  open: boolean;
  onClose: () => void;
}

function TopReserveDialog({ facilities, open, onClose }: TopReserveDialogProps) {
  const createReservation = useCreateReservation();
  const [facilityId, setFacilityId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [reservedBy, setReservedBy] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (facilityId === "") return;
    createReservation.mutate(
      { facilityId: facilityId as number, title, reservedBy, startTime, endTime, notes: notes || undefined },
      {
        onSuccess: () => {
          setFacilityId("");
          setTitle("");
          setReservedBy("");
          setStartTime("");
          setEndTime("");
          setNotes("");
          onClose();
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reserve a Space</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 mt-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Facility</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value === "" ? "" : Number(e.target.value))}
              required
            >
              <option value="">Select a facility…</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} (cap. {f.capacity})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
            <Input
              placeholder="e.g. Staff Meeting"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Reserved By</label>
            <Input
              placeholder="Your name"
              value={reservedBy}
              onChange={(e) => setReservedBy(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Start Time</label>
              <Input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">End Time</label>
              <Input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label>
            <Input
              placeholder="Any additional details"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={createReservation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createReservation.isPending}>
              {createReservation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Reserve
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Facilities() {
  const { data: facilities, isLoading, isError } = useFacilities();
  const [topDialogOpen, setTopDialogOpen] = useState(false);

  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <PageHeader title="Facilities" description="View and reserve church spaces.">
        <Button size="sm" onClick={() => setTopDialogOpen(true)} disabled={!facilities?.length}>
          <Plus className="h-4 w-4 mr-1.5" /> Reserve Space
        </Button>
      </PageHeader>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading facilities…</span>
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive py-4">Failed to load facilities. Is the API server running?</p>
      )}

      {facilities && (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            {(facilities as Facility[]).map((facility) => (
              <FacilityCard key={facility.id} facility={facility} />
            ))}
          </div>

          <TopReserveDialog
            facilities={facilities as Facility[]}
            open={topDialogOpen}
            onClose={() => setTopDialogOpen(false)}
          />
        </>
      )}
    </motion.div>
  );
}
