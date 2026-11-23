import {NativeModules, Platform} from 'react-native';

import {
  ClockCancelEngine,
  ClockCreateAlarmEngine,
  ClockCreateTimerEngine,
  ClockListEngine,
  ClockStopEngine,
} from '../AppleClockEngines';

const native = {
  getAuthorizationStatus: jest.fn(),
  requestAuthorization: jest.fn(),
  list: jest.fn(),
  createTimer: jest.fn(),
  createAlarm: jest.fn(),
  cancel: jest.fn(),
  stop: jest.fn(),
};

describe('Apple clock talent engines', () => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'ios',
    });
    (NativeModules as any).AppleClockModule = native;
    jest.resetAllMocks();
    native.requestAuthorization.mockResolvedValue({
      available: true,
      status: 'authorized',
      granted: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists LLMm timers and alarms through the native bridge', async () => {
    native.list.mockResolvedValue([
      {
        identifier: 'alarm-1',
        title: 'Class',
        kind: 'alarm',
        state: 'scheduled',
        fireDate: '2026-06-22T20:00:00Z',
      },
    ]);

    const result = await new ClockListEngine().execute({});

    expect(result.type).toBe('text');
    expect(native.list).toHaveBeenCalledTimes(1);
    expect(result.summary).toContain('Class');
    expect(result.summary).toContain('alarm-1');
  });

  it('requires explicit confirmation before creating or cancelling clock items', async () => {
    const timer = await new ClockCreateTimerEngine().execute({
      duration_seconds: 300,
    });
    const alarm = await new ClockCreateAlarmEngine().execute({
      fire_date: '2026-06-22T20:00:00Z',
    });
    const cancel = await new ClockCancelEngine().execute({
      identifier: 'alarm-1',
    });
    const stop = await new ClockStopEngine().execute({
      identifier: 'alarm-1',
    });

    expect(timer.type).toBe('error');
    expect(alarm.type).toBe('error');
    expect(cancel.type).toBe('error');
    expect(stop.type).toBe('error');
    expect(native.createTimer).not.toHaveBeenCalled();
    expect(native.createAlarm).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
  });

  it('creates a timer after confirmation', async () => {
    native.createTimer.mockResolvedValue({
      identifier: 'timer-1',
      title: 'Tea',
      kind: 'timer',
      state: 'countdown',
      durationSeconds: 180,
    });

    const result = await new ClockCreateTimerEngine().execute({
      title: 'Tea',
      duration_seconds: 180,
      user_confirmed: true,
    });

    expect(result.type).toBe('text');
    expect(native.requestAuthorization).toHaveBeenCalledTimes(1);
    expect(native.createTimer).toHaveBeenCalledWith({
      title: 'Tea',
      durationSeconds: 180,
    });
    expect(result.summary).toContain('timer-1');
  });

  it('creates an alarm with an ISO future fire date after confirmation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-22T10:00:00Z'));
    native.createAlarm.mockResolvedValue({
      identifier: 'alarm-2',
      title: 'Wake up',
      kind: 'alarm',
      state: 'scheduled',
      fireDate: '2026-06-23T11:00:00Z',
    });

    const result = await new ClockCreateAlarmEngine().execute({
      title: 'Wake up',
      fire_date: '2026-06-23T11:00:00Z',
      user_confirmed: true,
    });

    expect(result.type).toBe('text');
    expect(native.createAlarm).toHaveBeenCalledWith({
      title: 'Wake up',
      fireDate: '2026-06-23T11:00:00.000Z',
    });
    expect(result.summary).toContain('alarm-2');
  });

  it('rejects ambiguous alarm dates before native write', async () => {
    const result = await new ClockCreateAlarmEngine().execute({
      fire_date: 'tomorrow morning',
      user_confirmed: true,
    });

    expect(result.type).toBe('error');
    expect(native.createAlarm).not.toHaveBeenCalled();
  });

  it('cancels and stops by identifier after confirmation', async () => {
    native.cancel.mockResolvedValue({identifier: 'alarm-1', cancelled: true});
    native.stop.mockResolvedValue({identifier: 'alarm-1', stopped: true});

    const cancel = await new ClockCancelEngine().execute({
      identifier: 'alarm-1',
      user_confirmed: true,
    });
    const stop = await new ClockStopEngine().execute({
      identifier: 'alarm-1',
      user_confirmed: true,
    });

    expect(cancel.type).toBe('text');
    expect(stop.type).toBe('text');
    expect(native.cancel).toHaveBeenCalledWith('alarm-1');
    expect(native.stop).toHaveBeenCalledWith('alarm-1');
  });
});
