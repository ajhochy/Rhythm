export interface GoogleCalendarPreferences {
  selectedCalendarIds: string[];
}

export const defaultGoogleCalendarPreferences: GoogleCalendarPreferences = {
  selectedCalendarIds: [],
};

export interface GoogleCalendarOption {
  id: string;
  name: string;
  isPrimary: boolean;
  isSelected: boolean;
}
