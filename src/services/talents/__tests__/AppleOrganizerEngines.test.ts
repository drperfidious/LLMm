import {NativeModules, Platform} from 'react-native';

import {
  CalendarCreateEventEngine,
  CalendarFindEventsEngine,
  ReminderCompleteEngine,
  ReminderCreateEngine,
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

    expect(create.type).toBe('error');
    expect(complete.type).toBe('error');
    expect(native.createReminder).not.toHaveBeenCalled();
    expect(native.completeReminder).not.toHaveBeenCalled();
  });

  it('creates and completes reminders after confirmation', async () => {
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

    const created = await new ReminderCreateEngine().execute({
      title: 'Call Jade',
      due: '2026-06-22T20:00:00Z',
      user_confirmed: true,
    });
    const completed = await new ReminderCompleteEngine().execute({
      identifier: 'rem-2',
      user_confirmed: true,
    });

    expect(created.type).toBe('text');
    expect(completed.type).toBe('text');
    expect(native.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Call Jade',
        due: '2026-06-22T20:00:00.000Z',
      }),
    );
    expect(native.completeReminder).toHaveBeenCalledWith('rem-2');
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
  });
});
