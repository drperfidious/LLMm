import {NativeModules, Platform} from 'react-native';

export type NativeMailResponse = {
  ok?: boolean;
  provider?: string;
  capabilities?: string[];
  folders?: string[];
  accountEmail?: string;
  message?: Record<string, any>;
  messages?: Record<string, any>[];
  results?: Record<string, any>[];
  id?: string;
  messageId?: string;
  summary?: string;
};

type NativeMailModule = {
  check(args: Record<string, any>): Promise<NativeMailResponse>;
  search(args: Record<string, any>): Promise<NativeMailResponse>;
  read(args: Record<string, any>): Promise<NativeMailResponse>;
  send(args: Record<string, any>): Promise<NativeMailResponse>;
};

function getNativeMailModule(): NativeMailModule {
  const module = NativeModules.NativeMailModule as NativeMailModule | undefined;
  if (Platform.OS !== 'ios' || !module) {
    throw new Error(
      'Direct mail is available on iOS builds with NativeMailModule only.',
    );
  }
  return module;
}

export const nativeMailClient = {
  check(args: Record<string, any>): Promise<NativeMailResponse> {
    return getNativeMailModule().check(args);
  },

  search(args: Record<string, any>): Promise<NativeMailResponse> {
    return getNativeMailModule().search(args);
  },

  read(args: Record<string, any>): Promise<NativeMailResponse> {
    return getNativeMailModule().read(args);
  },

  send(args: Record<string, any>): Promise<NativeMailResponse> {
    return getNativeMailModule().send(args);
  },
};
