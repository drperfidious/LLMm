import {NativeModules, Platform} from 'react-native';

import {
  CalendarCreateEventEngine,
  CalendarFindEventsEngine,
  ReminderCompleteEngine,
  ReminderCreateEngine,
  ReminderDeleteEngine,
  ReminderFindEngine,
} from '../AppleOrganizerEngines';

const native = {
  requestCalendarAccess: jest.fn(),
  requestReminderAccess: jest.fn(),
  findEvents: jest.fn(),
  createEvent: jest.fn(),
  findReminders: jest.fn(),
  createReminder: jest.fn(),
  completeReminder: jest.fn(),
  deleteReminder: jest.fn(),
};

describe('Apple organizer talent engines', () => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'ios',
    });
    (NativeModules as any).AppleCalendarModule = native;
    jest.resetAllMocks();
    native.requestCalendarAccess.mockResolvedValue({
      granted: true,
      status: 'fullAccess',
    });
    native.requestReminderAccess.mockResolvedValue({
      granted: true,
      status: 'fullAccess',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('searches calendar events through the native bridge', async () => {
    native.findEvents.mockResolvedValue([
      {
        identifier: 'event-1',
        title: 'Dentist',
        start: '2026-06-22T14:00:00Z',
        end: '2026-06-22T15:00:00Z',
        allDay: false,
        location: 'Main St',
        calendarTitle: 'Personal',
      },
    ]);

    const result = await new CalendarFindEventsEngine().execute({
      query: 'dentist',
      start: '2026-06-22T00:00:00Z',
      end: '2026-06-23T00:00:00Z',
      limit: 3,
    });

    expect(result.type).toBe('text');
    expect(native.requestCalendarAccess).toHaveBeenCalledTimes(1);
    expect(native.findEvents).toHaveBeenCalledWith(
      'dentist',
      '2026-06-22T00:00:00.000Z',
      '2026-06-23T00:00:00.000Z',
      3,
    );
    expect(result.summary).toContain('Dentist');
    expect(result.summary).toContain('event-1');
  });

  it('falls back to upcoming window when calendar search dates are malformed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T18:00:00Z'));
    native.findEvents.mockResolvedValue([]);

    const result = await new CalendarFindEventsEngine().execute({
      query: '',
      start: '2023-10-05T00:000000',
      end: 'current date and time',
      limit: 5,
    });

    expect(result.type).toBe('text');
    expect(native.findEvents).toHaveBeenCalledWith(
      '',
      '2026-06-21T18:00:00.000Z',
      '2026-07-05T18:00:00.000Z',
      10,
    );
    expect(result.summary).toContain('no events found');
  });

  it('handles broad class schedule requests about a month out', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-21T18:00:00Z'));
    native.findEvents.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        identifier: 'class-1',
        title: 'PROG1224 Lecture',
        start: '2026-07-21T14:00:00Z',
        end: '2026-07-21T17:00:00Z',
        allDay: false,
        calendarTitle: 'School',
      },
    ]);

    const result = await new CalendarFindEventsEngine().execute({
      query: 'my class schedule in a month',
      limit: 5,
    });

    expect(result.type).toBe('text');
    expect(native.findEvents).toHaveBeenNthCalledWith(
      1,
      'class',
      '2026-07-18T18:00:00.000Z',
      '2026-07-28T18:00:00.000Z',
      5,
    );
    expect(native.findEvents).toHaveBeenNthCalledWith(
      2,
      '',
      '2026-07-18T18:00:00.000Z',
      '2026-07-28T18:00:00.000Z',
      10,
    );
    expect(result.summary).toContain('no exact matches');
    expect(result.summary).toContain('PROG1224 Lecture');
  });

  it('deduplicates broad upcoming event results from multiple calendars', async () => {
    native.findEvents.mockResolvedValue([
      {
        identifier: 'a',
        title: 'National Holiday',
        start: '2026-06-22T04:00:00Z',
        end: '2026-06-23T03:59:59Z',
        allDay: true,
        calendarTitle: 'Calendar A',
      },
      {
        identifier: 'b',
        title: 'National Holiday',
        start: '2026-06-22T04:00:00Z',
        end: '2026-06-23T03:59:59Z',
        allDay: true,
        calendarTitle: 'Calendar B',
      },
      {
        identifier: 'c',
        title: 'Class',
        start: '2026-06-23T14:00:00Z',
        end: '2026-06-23T17:00:00Z',
        allDay: false,
        calendarTitle: 'School',
      },
    ]);

    const result = await new CalendarFindEventsEngine().execute({
      query: '',
      limit: 2,
    });

    expect(native.findEvents).toHaveBeenCalledWith(
      '',
      expect.any(String),
      expect.any(String),
      4,
    );
    expect(result.type).toBe('text');
    expect(result.summary.match(/National Holiday/g)).toHaveLength(1);
    expect(result.summary).toContain('Class');
  });

  it('requires explicit confirmation before creating a calendar event', async () => {
    const result = await new CalendarCreateEventEngine().execute({
      title: 'Class',
      start: '2026-06-22T14:00:00Z',
      end: '2026-06-22T15:00:00Z',
    });

    expect(result.type).toBe('error');
    expect(native.createEvent).not.toHaveBeenCalled();
  });

  it('creates a calendar event after confirmation', async () => {
    native.createEvent.mockResolvedValue({
      identifier: 'event-2',
      title: 'Class',
      start: '2026-06-22T14:00:00Z',
      end: '2026-06-22T15:00:00Z',
      allDay: false,
    });

    const result = await new CalendarCreateEventEngine().execute({
      title: 'Class',
      start: '2026-06-22T14:00:00Z',
      end: '2026-06-22T15:00:00Z',
      user_confirmed: true,
      notes: 'Bring laptop',
    });

    expect(result.type).toBe('text');
    expect(native.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Class',
        start: '2026-06-22T14:00:00.000Z',
        end: '2026-06-22T15:00:00.000Z',
        notes: 'Bring laptop',
      }),
    );
    expect(result.summary).toContain('event-2');
  });

  it('rejects invalid calendar create dates before native write', async () => {
    const result = await new CalendarCreateEventEngine().execute({
      title: 'Class',
      start: 'current date and time',
      end: 'later',
      user_confirmed: true,
    });

    expect(result.type).toBe('error');
    expect(native.createEvent).not.toHaveBeenCalled();
  });

  it('finds reminders through the native bridge', async () => {
    native.findReminders.mockResolvedValue([
      {
        identifier: 'rem-1',
        title: 'Submit assignment',
        completed: false,
        due: '2026-06-22T20:00:00Z',
      },
    ]);

    const result = await new ReminderFindEngine().execute({
      query: 'assignment',
      include_completed: false,
      limit: 4,
    });

    expect(result.type).toBe('text');
    expect(native.requestReminderAccess).toHaveBeenCalledTimes(1);
    expect(native.findReminders).toHaveBeenCalledWith('assignment', false, 4);
    expect(result.summary).toContain('Submit assignment');
  });

  it('requires explicit confirmation before creating or completing reminders', async () => {
    const create = await new ReminderCreateEngine().execute({
      title: 'Call Jade',
    });
    const complete = await new ReminderCompleteEngine().execute({
      identifier: 'rem-1',
    });
    const deletion = await new ReminderDeleteEngine().execute({
      identifier: 'rem-1',
    });

    expect(create.type).toBe('error');
    expect(complete.type).toBe('error');
    expect(deletion.type).toBe('error');
    expect(native.createReminder).not.toHaveBeenCalled();
    expect(native.completeReminder).not.toHaveBeenCalled();
    expect(native.deleteReminder).not.toHaveBeenCalled();
  });

  it('creates, completes, and deletes reminders after confirmation', async () => {
    native.createReminder.mockResolvedValue({
      identifier: 'rem-2',
      title: 'Call Jade',
      completed: false,
    });
    native.completeReminder.mockResolvedValue({
      identifier: 'rem-2',
      title: 'Call Jade',
      completed: true,
    });
    native.deleteReminder.mockResolvedValue({
      identifier: 'rem-2',
      title: 'Call Jade',
      completed: false,
      deleted: true,
    });

    const created = await new ReminderCreateEngine().execute({
      title: 'Call Jade',
      due: '2026-06-22T20:00:00Z',
      user_confirmed: true,
    });
    const completed = await new ReminderCompleteEngine().execute({
      identifier: 'rem-2',
      user_confirmed: true,
    });
    const deleted = await new ReminderDeleteEngine().execute({
      identifier: 'rem-2',
      user_confirmed: true,
    });

    expect(created.type).toBe('text');
    expect(completed.type).toBe('text');
    expect(deleted.type).toBe('text');
    expect(native.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Call Jade',
        due: '2026-06-22T20:00:00.000Z',
      }),
    );
    expect(native.completeReminder).toHaveBeenCalledWith('rem-2');
    expect(native.deleteReminder).toHaveBeenCalledWith('rem-2');
  });

  it('rejects malformed reminder due dates before native write', async () => {
    const result = await new ReminderCreateEngine().execute({
      title: 'Call Jade',
      due: 'tomorrow-ish',
      user_confirmed: true,
    });

    expect(result.type).toBe('error');
    expect(native.createReminder).not.toHaveBeenCalled();
  });

  it('documents confirmation requirements in write schemas', () => {
    expect(
      new CalendarCreateEventEngine().toToolDefinition().function.parameters
        .required,
    ).toContain('user_confirmed');
    expect(
      new ReminderCreateEngine().toToolDefinition().function.parameters
        .required,
    ).toContain('user_confirmed');
    expect(
      new ReminderCompleteEngine().toToolDefinition().function.parameters
        .required,
    ).toContain('user_confirmed');
    expect(
      new ReminderDeleteEngine().toToolDefinition().function.parameters
        .required,
    ).toContain('user_confirmed');
  });
});
