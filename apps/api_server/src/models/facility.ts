export interface Facility {
  id: number;
  name: string;
  description: string | null;
  capacity: number | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFacilityDto {
  name: string;
  description?: string | null;
  capacity?: number | null;
  location?: string | null;
}

export interface UpdateFacilityDto {
  name?: string;
  description?: string | null;
  capacity?: number | null;
  location?: string | null;
}

export interface Reservation {
  id: number;
  facilityId: number;
  title: string;
  reservedBy: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  createdAt: string;
}

export interface CreateReservationDto {
  title: string;
  reserved_by: string;
  start_time: string;
  end_time: string;
  notes?: string | null;
}
