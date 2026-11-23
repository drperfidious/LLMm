import {
  nativeAppleClock,
  type NativeClockItem,
} from '../apple/NativeAppleClock';

import type {TalentEngine, TalentResult, ToolDefinition} from './types';

const MAX_TIMER_SECONDS = 7 * 24 * 60 * 60;

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function boolArg(value: unknown): boolean {
  return value === true || value === 'true';
}

function numberArg(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDateArg(value: unknown): Date | undefined {
  const raw = stringArg(value);
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function missingArg(tool: string, name: string): TalentResult {
  return {
    type: 'error',
    summary: `${tool}: missing ${name}`,
    errorMessage: `${name} is required`,
  };
}

function confirmationError(tool: string): TalentResult {
  return {
    type: 'error',
    summary: `${tool}: confirmation required`,
    errorMessage:
      'This changes LLMm app-owned alarms/timers. Only call after the user explicitly requests the action, then set user_confirmed=true.',
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

function formatClockItem(item: NativeClockItem): string {
  const bits = [
    item.title || '(untitled)',
    item.kind,
    item.state ? `state: ${item.state}` : '',
    item.fireDate ? `fires: ${item.fireDate}` : '',
    item.durationSeconds
      ? `duration: ${Math.round(item.durationSeconds)}s`
      : '',
    `id: ${item.identifier}`,
  ].filter(Boolean);
  return `- ${bits.join(' | ')}`;
}

async function ensureClockAuthorization(
  tool: string,
): Promise<TalentResult | undefined> {
  const access = await nativeAppleClock.requestAuthorization();
  if (access.available === false || access.status === 'unsupported') {
    return {
      type: 'error',
      summary: `${tool}: AlarmKit unavailable`,
      errorMessage:
        'Clock talents require AlarmKit on iOS 26 or newer and can only manage LLMm app-owned alarms/timers.',
    };
  }
  if (access.granted === false || access.status === 'denied') {
    return {
      type: 'error',
      summary: `${tool}: clock access denied`,
      errorMessage:
        'Clock access is denied in Settings, so LLMm cannot schedule app-owned alarms or timers.',
    };
  }
  return undefined;
}

export class ClockListEngine implements TalentEngine {
  readonly name = 'clock_list';
  readonly recommendedContextTokens = 512;

  async execute(_args: Record<string, any> = {}): Promise<TalentResult> {
    try {
      const items = await nativeAppleClock.list();
      return {
        type: 'text',
        summary:
          items.length === 0
            ? 'clock_list: no LLMm timers or alarms found'
            : [
                `clock_list: found ${items.length} LLMm timer/alarm item(s)`,
                ...items.map(formatClockItem),
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
          'List LLMm app-owned timers and alarms. This does not list arbitrary alarms from the Apple Clock app.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    };
  }
}

export class ClockCreateTimerEngine implements TalentEngine {
  readonly name = 'clock_create_timer';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    if (!boolArg(args.user_confirmed)) {
      return confirmationError(this.name);
    }

    const durationSeconds = Math.floor(
      numberArg(args.duration_seconds ?? args.durationSeconds),
    );
    if (durationSeconds < 1) {
      return missingArg(this.name, 'duration_seconds');
    }
    if (durationSeconds > MAX_TIMER_SECONDS) {
      return {
        type: 'error',
        summary: `${this.name}: duration too large`,
        errorMessage: `duration_seconds must be ${MAX_TIMER_SECONDS} seconds or less.`,
      };
    }

    try {
      const authError = await ensureClockAuthorization(this.name);
      if (authError) {
        return authError;
      }
      const item = await nativeAppleClock.createTimer({
        title: stringArg(args.title) || 'LLMm timer',
        durationSeconds,
      });
      return {
        type: 'text',
        summary: `clock_create_timer: created\n${formatClockItem(item)}`,
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
          'Create an LLMm app-owned countdown timer through Apple AlarmKit. Use only when the user explicitly asks to set/start/create a timer.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Optional short title shown for the timer.',
            },
            duration_seconds: {
              type: 'number',
              description:
                'Timer duration in seconds. Convert clear durations like "5 minutes" to seconds.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only when the user explicitly asked to create/start this timer.',
            },
          },
          required: ['duration_seconds', 'user_confirmed'],
        },
      },
    };
  }
}

export class ClockCreateAlarmEngine implements TalentEngine {
  readonly name = 'clock_create_alarm';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    if (!boolArg(args.user_confirmed)) {
      return confirmationError(this.name);
    }

    const fireDate = parseDateArg(args.fire_date ?? args.fireDate);
    if (!fireDate) {
      return missingArg(this.name, 'valid ISO fire_date');
    }
    if (fireDate <= new Date()) {
      return {
        type: 'error',
        summary: `${this.name}: fire_date must be in the future`,
        errorMessage: 'fire_date must be in the future.',
      };
    }

    try {
      const authError = await ensureClockAuthorization(this.name);
      if (authError) {
        return authError;
      }
      const item = await nativeAppleClock.createAlarm({
        title: stringArg(args.title) || 'LLMm alarm',
        fireDate: fireDate.toISOString(),
      });
      return {
        type: 'text',
        summary: `clock_create_alarm: created\n${formatClockItem(item)}`,
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
          'Create an LLMm app-owned alarm through Apple AlarmKit. Use only when the user explicitly asks to set/create an alarm and the fire date/time is clear.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Optional short title shown for the alarm.',
            },
            fire_date: {
              type: 'string',
              description:
                'ISO future date/time when the alarm should fire. Ask a follow-up if the user did not provide enough date/time detail.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only when the user explicitly asked to create this alarm.',
            },
          },
          required: ['fire_date', 'user_confirmed'],
        },
      },
    };
  }
}

export class ClockCancelEngine implements TalentEngine {
  readonly name = 'clock_cancel';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    if (!boolArg(args.user_confirmed)) {
      return confirmationError(this.name);
    }

    const identifier = stringArg(args.identifier ?? args.id);
    if (!identifier) {
      return missingArg(this.name, 'identifier');
    }

    try {
      const result = await nativeAppleClock.cancel(identifier);
      return {
        type: 'text',
        summary: `clock_cancel: cancelled ${result.identifier}`,
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
          'Cancel/delete a scheduled LLMm app-owned timer or alarm. If no identifier is known, call clock_list first.',
        parameters: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description:
                'Identifier returned by clock_list or creation tools.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only when the user explicitly asked to cancel/remove this timer or alarm.',
            },
          },
          required: ['identifier', 'user_confirmed'],
        },
      },
    };
  }
}

export class ClockStopEngine implements TalentEngine {
  readonly name = 'clock_stop';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    if (!boolArg(args.user_confirmed)) {
      return confirmationError(this.name);
    }

    const identifier = stringArg(args.identifier ?? args.id);
    if (!identifier) {
      return missingArg(this.name, 'identifier');
    }

    try {
      const result = await nativeAppleClock.stop(identifier);
      return {
        type: 'text',
        summary: `clock_stop: stopped ${result.identifier}`,
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
          'Stop a currently firing LLMm app-owned timer or alarm. If no identifier is known, call clock_list first.',
        parameters: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description:
                'Identifier returned by clock_list or creation tools.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only when the user explicitly asked to stop/dismiss this timer or alarm.',
            },
          },
          required: ['identifier', 'user_confirmed'],
        },
      },
    };
  }
}
