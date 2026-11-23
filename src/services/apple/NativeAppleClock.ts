import {NativeModules, Platform} from 'react-native';

export type NativeClockAccessStatus =
  | 'notDetermined'
  | 'denied'
  | 'authorized'
  | 'unsupported'
  | 'unknown';

export type NativeClockAccess = {
  available: boolean;
  status: NativeClockAccessStatus;
  granted?: boolean;
};

export type NativeClockItem = {
  identifier: string;
  title: string;
  kind: 'timer' | 'alarm' | string;
  state: string;
  fireDate?: string;
  durationSeconds?: number;
  postAlertSeconds?: number;
  hour?: number;
  minute?: number;
  repeats?: string;
};

export type NativeCreateTimerArgs = {
  title?: string;
  durationSeconds: number;
};

export type NativeCreateAlarmArgs = {
  title?: string;
  fireDate: string;
};

type NativeAppleClockModule = {
  getAuthorizationStatus(): Promise<NativeClockAccess>;
  requestAuthorization(): Promise<NativeClockAccess>;
  list(): Promise<NativeClockItem[]>;
  createTimer(args: NativeCreateTimerArgs): Promise<NativeClockItem>;
  createAlarm(args: NativeCreateAlarmArgs): Promise<NativeClockItem>;
  cancel(identifier: string): Promise<{identifier: string; cancelled: boolean}>;
  stop(identifier: string): Promise<{identifier: string; stopped: boolean}>;
};

function getModule(): NativeAppleClockModule {
  const module = NativeModules.AppleClockModule as
    | NativeAppleClockModule
    | undefined;
  if (Platform.OS !== 'ios' || !module) {
    throw new Error('Apple clock talents are available on iOS 26+ only.');
  }
  return module;
}

export const nativeAppleClock = {
  getAuthorizationStatus(): Promise<NativeClockAccess> {
    return getModule().getAuthorizationStatus();
  },

  requestAuthorization(): Promise<NativeClockAccess> {
    return getModule().requestAuthorization();
  },

  list(): Promise<NativeClockItem[]> {
    return getModule().list();
  },

  createTimer(args: NativeCreateTimerArgs): Promise<NativeClockItem> {
    return getModule().createTimer(args);
  },

  createAlarm(args: NativeCreateAlarmArgs): Promise<NativeClockItem> {
    return getModule().createAlarm(args);
  },

  cancel(
    identifier: string,
  ): Promise<{identifier: string; cancelled: boolean}> {
    return getModule().cancel(identifier);
  },

  stop(identifier: string): Promise<{identifier: string; stopped: boolean}> {
    return getModule().stop(identifier);
  },
};
