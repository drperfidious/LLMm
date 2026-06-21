import {
  nativeAppleOrganizer,
  type NativeCalendarEvent,
  type NativeReminder,
} from '../apple/NativeAppleOrganizer';

import type {TalentEngine, TalentResult, ToolDefinition} from './types';

const DEFAULT_EVENT_WINDOW_DAYS = 14;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boolArg(value: unknown): boolean {
  return value === true || value === 'true';
}

function limitArg(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function isoArg(value: unknown, fallback: Date): string {
  const raw = stringArg(value);
  if (!raw) {
    return fallback.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : raw;
}

function optionalIsoArg(value: unknown): string | undefined {
  const raw = stringArg(value);
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : raw;
}

function confirmationError(tool: string): TalentResult {
  return {
    type: 'error',
    summary: `${tool}: confirmation required`,
    errorMessage:
      'This write changes Apple Calendar/Reminders. Ask the user for explicit confirmation, then call the tool with user_confirmed=true.',
  };
}

function missingArg(tool: string, name: string): TalentResult {
  return {
    type: 'error',
    summary: `${tool}: missing ${name}`,
    errorMessage: `${name} is required`,
  };
}

function nativeError(tool: string, error: unknown): TalentResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    type: 'error',
    summary: `${tool}: ${message}`,
    errorMessage: message,
  };
}

function formatEvent(event: NativeCalendarEvent): string {
  const bits = [
    event.title,
    `${event.start} to ${event.end}`,
    event.location ? `location: ${event.location}` : '',
    event.calendarTitle ? `calendar: ${event.calendarTitle}` : '',
    `id: ${event.identifier}`,
  ].filter(Boolean);
  return `- ${bits.join(' | ')}`;
}

function formatReminder(reminder: NativeReminder): string {
  const bits = [
    reminder.title,
    reminder.due ? `due: ${reminder.due}` : '',
    reminder.completed ? 'completed' : 'open',
    reminder.calendarTitle ? `list: ${reminder.calendarTitle}` : '',
    `id: ${reminder.identifier}`,
  ].filter(Boolean);
  return `- ${bits.join(' | ')}`;
}

export class CalendarFindEventsEngine implements TalentEngine {
  readonly name = 'calendar_find_events';
  readonly recommendedContextTokens = 512;

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const query = stringArg(args.query);
    const start = isoArg(args.start ?? args.startISO, new Date());
    const end = isoArg(
      args.end ?? args.endISO,
      new Date(Date.now() + DEFAULT_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    );
    const limit = limitArg(args.limit);

    try {
      await nativeAppleOrganizer.requestCalendarAccess();
      const events = await nativeAppleOrganizer.findEvents(
        query,
        start,
        end,
        limit,
      );
      return {
        type: 'text',
        summary:
          events.length === 0
            ? `calendar_find_events: no events found from ${start} to ${end}`
            : [
                `calendar_find_events: found ${events.length} event(s)`,
                ...events.map(formatEvent),
              ].join('\n'),
      };
    } catch (error) {
      return nativeError(this.name, error);
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Search the user’s Apple Calendar events on-device after permission. Use this for schedule questions; omit query to list upcoming events.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional text to match in title, notes, or location.',
            },
            start: {
              type: 'string',
              description: 'ISO start date/time. Defaults to now.',
            },
            end: {
              type: 'string',
              description: 'ISO end date/time. Defaults to about two weeks out.',
            },
            limit: {
              type: 'number',
              description: `Maximum events to return, 1-${MAX_LIMIT}.`,
            },
          },
        },
      },
    };
  }
}

export class CalendarCreateEventEngine implements TalentEngine {
  readonly name = 'calendar_create_event';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    if (!boolArg(args.user_confirmed)) {
      return confirmationError(this.name);
    }

    const title = stringArg(args.title);
    const start = stringArg(args.start);
    const end = stringArg(args.end);
    if (!title) {
      return missingArg(this.name, 'title');
    }
    if (!start) {
      return missingArg(this.name, 'start');
    }
    if (!end) {
      return missingArg(this.name, 'end');
    }

    try {
      await nativeAppleOrganizer.requestCalendarAccess();
      const event = await nativeAppleOrganizer.createEvent({
        title,
        start: isoArg(start, new Date()),
        end: isoArg(end, new Date()),
        allDay: boolArg(args.all_day ?? args.allDay),
        location: stringArg(args.location) || undefined,
        notes: stringArg(args.notes) || undefined,
        calendarTitle: stringArg(args.calendar_title ?? args.calendarTitle) || undefined,
      });
      return {
        type: 'text',
        summary: `calendar_create_event: created\n${formatEvent(event)}`,
      };
    } catch (error) {
      return nativeError(this.name, error);
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Create an Apple Calendar event on-device. Only call after the user explicitly asks to create/save the event; set user_confirmed=true to acknowledge that confirmation.',
        parameters: {
          type: 'object',
          properties: {
            title: {type: 'string', description: 'Event title.'},
            start: {type: 'string', description: 'ISO start date/time.'},
            end: {type: 'string', description: 'ISO end date/time.'},
            all_day: {type: 'boolean', description: 'Whether the event is all-day.'},
            location: {type: 'string', description: 'Optional event location.'},
            notes: {type: 'string', description: 'Optional event notes.'},
            calendar_title: {
              type: 'string',
              description:
                'Optional target calendar title. Defaults to the system default calendar.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only when the user explicitly asked to save/create this event.',
            },
          },
          required: ['title', 'start', 'end', 'user_confirmed'],
        },
      },
    };
  }
}

export class ReminderFindEngine implements TalentEngine {
  readonly name = 'reminder_find';
  readonly recommendedContextTokens = 512;

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const query = stringArg(args.query);
    const includeCompleted = boolArg(args.include_completed);
    const limit = limitArg(args.limit);

    try {
      await nativeAppleOrganizer.requestReminderAccess();
      const reminders = await nativeAppleOrganizer.findReminders(
        query,
        includeCompleted,
        limit,
      );
      return {
        type: 'text',
        summary:
          reminders.length === 0
            ? 'reminder_find: no reminders found'
            : [
                `reminder_find: found ${reminders.length} reminder(s)`,
                ...reminders.map(formatReminder),
              ].join('\n'),
      };
    } catch (error) {
      return nativeError(this.name, error);
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Search Apple Reminders on-device after permission. Use include_completed only when the user asks for completed reminders.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional text to match in title or notes.',
            },
            include_completed: {
              type: 'boolean',
              description: 'Whether to include completed reminders.',
            },
            limit: {
              type: 'number',
              description: `Maximum reminders to return, 1-${MAX_LIMIT}.`,
            },
          },
        },
      },
    };
  }
}

export class ReminderCreateEngine implements TalentEngine {
  readonly name = 'reminder_create';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    if (!boolArg(args.user_confirmed)) {
      return confirmationError(this.name);
    }

    const title = stringArg(args.title);
    if (!title) {
      return missingArg(this.name, 'title');
    }

    try {
      await nativeAppleOrganizer.requestReminderAccess();
      const reminder = await nativeAppleOrganizer.createReminder({
        title,
        notes: stringArg(args.notes) || undefined,
        due: optionalIsoArg(args.due ?? args.due_date ?? args.dueDate),
        priority:
          args.priority === undefined ? undefined : Number(args.priority) || 0,
        calendarTitle: stringArg(args.list_title ?? args.calendar_title) || undefined,
      });
      return {
        type: 'text',
        summary: `reminder_create: created\n${formatReminder(reminder)}`,
      };
    } catch (error) {
      return nativeError(this.name, error);
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Create an Apple Reminder on-device. Only call after the user explicitly asks to create/save the reminder; set user_confirmed=true to acknowledge that confirmation.',
        parameters: {
          type: 'object',
          properties: {
            title: {type: 'string', description: 'Reminder title.'},
            notes: {type: 'string', description: 'Optional reminder notes.'},
            due: {type: 'string', description: 'Optional ISO due date/time.'},
            priority: {
              type: 'number',
              description: 'Optional Apple Reminders priority from 0 to 9.',
            },
            list_title: {
              type: 'string',
              description:
                'Optional reminders list title. Defaults to the system default list.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only when the user explicitly asked to save/create this reminder.',
            },
          },
          required: ['title', 'user_confirmed'],
        },
      },
    };
  }
}

export class ReminderCompleteEngine implements TalentEngine {
  readonly name = 'reminder_complete';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    if (!boolArg(args.user_confirmed)) {
      return confirmationError(this.name);
    }

    const identifier = stringArg(args.identifier ?? args.id);
    if (!identifier) {
      return missingArg(this.name, 'identifier');
    }

    try {
      await nativeAppleOrganizer.requestReminderAccess();
      const reminder = await nativeAppleOrganizer.completeReminder(identifier);
      return {
        type: 'text',
        summary: `reminder_complete: completed\n${formatReminder(reminder)}`,
      };
    } catch (error) {
      return nativeError(this.name, error);
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Mark an Apple Reminder complete on-device. Only call after explicit user confirmation.',
        parameters: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description:
                'Reminder identifier returned by reminder_find or reminder_create.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only when the user explicitly asked to complete this reminder.',
            },
          },
          required: ['identifier', 'user_confirmed'],
        },
      },
    };
  }
}
