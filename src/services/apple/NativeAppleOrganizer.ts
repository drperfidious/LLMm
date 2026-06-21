import {NativeModules, Platform} from 'react-native';

export type NativeAccessStatus =
  | 'notDetermined'
  | 'restricted'
  | 'denied'
  | 'authorized'
  | 'writeOnly'
  | 'fullAccess'
  | 'unknown';

export type NativeOrganizerAccess = {
  calendar: NativeAccessStatus;
  reminders: NativeAccessStatus;
};

export type NativeCalendarEvent = {
  identifier: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  calendarTitle?: string;
};

export type NativeReminder = {
  identifier: string;
  title: string;
  completed: boolean;
  due?: string;
  notes?: string;
  priority?: number;
  calendarTitle?: string;
};

export type NativeCreateEventArgs = {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  calendarTitle?: string;
};

export type NativeCreateReminderArgs = {
  title: string;
  notes?: string;
  due?: string;
  priority?: number;
  calendarTitle?: string;
};

type NativeAppleOrganizerModule = {
  getAuthorizationStatus(): Promise<NativeOrganizerAccess>;
  requestCalendarAccess(): Promise<{granted: boolean; status: NativeAccessStatus}>;
  requestReminderAccess(): Promise<{granted: boolean; status: NativeAccessStatus}>;
  findEvents(
    query: string,
    startISO: string,
    endISO: string,
    limit: number,
  ): Promise<NativeCalendarEvent[]>;
  createEvent(args: NativeCreateEventArgs): Promise<NativeCalendarEvent>;
  findReminders(
    query: string,
    includeCompleted: boolean,
    limit: number,
  ): Promise<NativeReminder[]>;
  createReminder(args: NativeCreateReminderArgs): Promise<NativeReminder>;
  completeReminder(identifier: string): Promise<NativeReminder>;
};

function getModule(): NativeAppleOrganizerModule {
  const module = NativeModules.AppleCalendarModule as
    | NativeAppleOrganizerModule
    | undefined;
  if (Platform.OS !== 'ios' || !module) {
    throw new Error('Apple calendar/reminder talents are available on iOS only.');
  }
  return module;
}

export const nativeAppleOrganizer = {
  getAuthorizationStatus(): Promise<NativeOrganizerAccess> {
    return getModule().getAuthorizationStatus();
  },

  requestCalendarAccess(): Promise<{
    granted: boolean;
    status: NativeAccessStatus;
  }> {
    return getModule().requestCalendarAccess();
  },

  requestReminderAccess(): Promise<{
    granted: boolean;
    status: NativeAccessStatus;
  }> {
    return getModule().requestReminderAccess();
  },

  findEvents(
    query: string,
    startISO: string,
    endISO: string,
    limit: number,
  ): Promise<NativeCalendarEvent[]> {
    return getModule().findEvents(query, startISO, endISO, limit);
  },

  createEvent(args: NativeCreateEventArgs): Promise<NativeCalendarEvent> {
    return getModule().createEvent(args);
  },

  findReminders(
    query: string,
    includeCompleted: boolean,
    limit: number,
  ): Promise<NativeReminder[]> {
    return getModule().findReminders(query, includeCompleted, limit);
  },

  createReminder(args: NativeCreateReminderArgs): Promise<NativeReminder> {
    return getModule().createReminder(args);
  },

  completeReminder(identifier: string): Promise<NativeReminder> {
    return getModule().completeReminder(identifier);
  },
};
