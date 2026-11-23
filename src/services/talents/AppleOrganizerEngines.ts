import {
  nativeAppleOrganizer,
  type NativeCalendarEvent,
  type NativeReminder,
} from '../apple/NativeAppleOrganizer';

import type {TalentEngine, TalentResult, ToolDefinition} from './types';

const DEFAULT_EVENT_WINDOW_DAYS = 14;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function expandedFetchLimit(limit: number): number {
  return Math.min(MAX_LIMIT, Math.max(limit, limit * 2));
}

function parseDateArg(value: unknown): Date | undefined {
  const raw = stringArg(value);
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function collectCalendarDateHint(args: Record<string, any>): string {
  return [
    args.start,
    args.startISO,
    args.end,
    args.endISO,
    args.when,
    args.date,
    args.date_hint,
    args.dateHint,
    args.range,
    args.timeframe,
    args.period,
    args.query,
  ]
    .map(stringArg)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function eventWindowFromHint(hint: string, now: Date) {
  if (!hint) {
    return undefined;
  }

  if (/\b(in|around)\s+(a|one|1)\s+months?\b/.test(hint)) {
    const start = new Date(now.getTime() + 27 * DAY_MS);
    return {
      start,
      end: new Date(start.getTime() + 10 * DAY_MS),
    };
  }

  if (
    /\b(within|over|for|during)\s+(the\s+)?(next|coming)\s+months?\b/.test(
      hint,
    ) ||
    /\b(next|coming)\s+months?\b/.test(hint) ||
    /\b(next|coming)\s+(30|31)\s+days?\b/.test(hint)
  ) {
    return {
      start: now,
      end: new Date(now.getTime() + 45 * DAY_MS),
    };
  }

  return undefined;
}

function normalizeCalendarQuery(rawQuery: unknown): string {
  const raw = stringArg(rawQuery);
  if (!raw) {
    return '';
  }

  return raw
    .replace(
      /\b(in|within|over|for|during|around)\s+(the\s+)?(next|coming|a|one|1)?\s*(month|months|week|weeks|day|days)\b/gi,
      ' ',
    )
    .replace(/\b(next|coming)\s+(month|months|week|weeks|day|days)\b/gi, ' ')
    .replace(
      /\b(calendar|schedule|timetable|events?|meetings?|appointments?|agenda|upcoming|what'?s next|whats next|coming next)\b/gi,
      ' ',
    )
    .replace(
      /\b(my|me|i|the|a|an|please|show|find|list|tell|tell me|what|which|do|have|am|is|are|on)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function isoArg(value: unknown, fallback: Date): string {
  return (parseDateArg(value) ?? fallback).toISOString();
}

function requiredIsoArg(value: unknown): string | undefined {
  return parseDateArg(value)?.toISOString();
}

function optionalIsoArg(value: unknown): string | undefined {
  return parseDateArg(value)?.toISOString();
}

function findEventWindow(args: Record<string, any>): {
  start: string;
  end: string;
} {
  const defaultStart = new Date();
  const hintedWindow = eventWindowFromHint(
    collectCalendarDateHint(args),
    defaultStart,
  );
  const startDate =
    parseDateArg(args.start ?? args.startISO) ??
    hintedWindow?.start ??
    defaultStart;
  const defaultEnd = new Date(
    startDate.getTime() + DEFAULT_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const rawEnd = parseDateArg(args.end ?? args.endISO);
  const endDate =
    !rawEnd || rawEnd <= startDate ? (hintedWindow?.end ?? defaultEnd) : rawEnd;
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
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

function dedupeEvents(
  events: NativeCalendarEvent[],
  limit: number,
): NativeCalendarEvent[] {
  const seen = new Set<string>();
  const unique: NativeCalendarEvent[] = [];
  for (const event of events) {
    const key = [
      event.title.trim().toLowerCase(),
      event.start,
      event.end,
      event.location?.trim().toLowerCase() ?? '',
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(event);
    if (unique.length >= limit) {
      break;
    }
  }
  return unique;
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
    const requestedQuery = stringArg(args.query);
    const query = normalizeCalendarQuery(requestedQuery);
    const {start, end} = findEventWindow(args);
    const limit = limitArg(args.limit);

    try {
      await nativeAppleOrganizer.requestCalendarAccess();
      let events: NativeCalendarEvent[] = dedupeEvents(
        await nativeAppleOrganizer.findEvents(
          query,
          start,
          end,
          query ? limit : expandedFetchLimit(limit),
        ),
        limit,
      );
      let usedBroadFallback = false;
      if (events.length === 0 && query) {
        const fallbackEvents = dedupeEvents(
          await nativeAppleOrganizer.findEvents(
            '',
            start,
            end,
            expandedFetchLimit(limit),
          ),
          limit,
        );
        if (fallbackEvents.length > 0) {
          events = fallbackEvents;
          usedBroadFallback = true;
        }
      }
      return {
        type: 'text',
        summary:
          events.length === 0
            ? `calendar_find_events: no events found from ${start} to ${end}`
            : [
                usedBroadFallback
                  ? `calendar_find_events: no exact matches for "${requestedQuery}", showing ${events.length} event(s) in the requested window`
                  : `calendar_find_events: found ${events.length} event(s)`,
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
          'Search the user’s Apple Calendar events on-device after permission. Use this for schedule questions; omit query to list upcoming events. For ordinary upcoming-calendar requests, omit start and end instead of guessing dates; LLMm defaults to now through about two weeks out.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Optional text to match in title, notes, or location. For broad schedule/class questions, prefer omitting query unless the user names a specific class, person, place, or event title.',
            },
            date_hint: {
              type: 'string',
              description:
                'Optional natural-language date hint such as "in a month" or "next month" when exact ISO dates are uncertain.',
            },
            start: {
              type: 'string',
              description:
                'Optional ISO start date/time. Omit for upcoming events; do not use natural-language values.',
            },
            end: {
              type: 'string',
              description:
                'Optional ISO end date/time. Omit for upcoming events; do not use natural-language values.',
            },
            startISO: {
              type: 'string',
              description:
                'Alias for start. Optional ISO date/time only; omit when unsure.',
            },
            endISO: {
              type: 'string',
              description:
                'Alias for end. Optional ISO date/time only; omit when unsure.',
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
    const start = requiredIsoArg(args.start ?? args.startISO);
    const end = requiredIsoArg(args.end ?? args.endISO);
    if (!title) {
      return missingArg(this.name, 'title');
    }
    if (!start) {
      return missingArg(this.name, 'valid ISO start');
    }
    if (!end) {
      return missingArg(this.name, 'valid ISO end');
    }

    try {
      await nativeAppleOrganizer.requestCalendarAccess();
      const event = await nativeAppleOrganizer.createEvent({
        title,
        start,
        end,
        allDay: boolArg(args.all_day ?? args.allDay),
        location: stringArg(args.location) || undefined,
        notes: stringArg(args.notes) || undefined,
        calendarTitle:
          stringArg(args.calendar_title ?? args.calendarTitle) || undefined,
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
            all_day: {
              type: 'boolean',
              description: 'Whether the event is all-day.',
            },
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
    const rawDue = args.due ?? args.due_date ?? args.dueDate;
    const due = optionalIsoArg(rawDue);
    if (stringArg(rawDue) && !due) {
      return missingArg(this.name, 'valid ISO due date/time');
    }

    try {
      await nativeAppleOrganizer.requestReminderAccess();
      const reminder = await nativeAppleOrganizer.createReminder({
        title,
        notes: stringArg(args.notes) || undefined,
        due,
        priority:
          args.priority === undefined ? undefined : Number(args.priority) || 0,
        calendarTitle:
          stringArg(args.list_title ?? args.listTitle ?? args.calendar_title) ||
          undefined,
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
          'Create an Apple Reminder on-device. Use a short title, optional notes, and an ISO due date only when the user supplied an unambiguous date/time. Only call after the user explicitly asks to create/save the reminder; set user_confirmed=true to acknowledge that confirmation.',
        parameters: {
          type: 'object',
          properties: {
            title: {type: 'string', description: 'Reminder title.'},
            notes: {type: 'string', description: 'Optional reminder notes.'},
            due: {
              type: 'string',
              description:
                'Optional ISO due date/time. Convert clear relative times like "tomorrow at 8" to ISO; ask a follow-up if the date/time is ambiguous.',
            },
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

export class ReminderDeleteEngine implements TalentEngine {
  readonly name = 'reminder_delete';

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
      const reminder = await nativeAppleOrganizer.deleteReminder(identifier);
      return {
        type: 'text',
        summary: `reminder_delete: deleted\n${formatReminder(reminder)}`,
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
          'Delete an Apple Reminder on-device. If the user has not provided a reminder identifier, call reminder_find first and then ask/confirm which reminder to delete.',
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
                'Must be true only when the user explicitly asked to delete/remove this reminder.',
            },
          },
          required: ['identifier', 'user_confirmed'],
        },
      },
    };
  }
}
