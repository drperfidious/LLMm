import {Platform} from 'react-native';
import {getBackendDevicesInfo} from 'llama.rn';

import {getDeviceOptions, isIOSMetalDeviceName} from '../deviceSelection';

describe('deviceSelection', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      get: () => originalOS,
      configurable: true,
    });
    jest.clearAllMocks();
  });

  it('recognizes concrete iOS Metal GPU names', () => {
    expect(isIOSMetalDeviceName('Metal')).toBe(true);
    expect(isIOSMetalDeviceName('Apple A16 GPU')).toBe(true);
    expect(isIOSMetalDeviceName('Apple A15 GPU')).toBe(true);
    expect(isIOSMetalDeviceName('CPU')).toBe(false);
  });

  it('offers a stable Metal selection marker on iOS', async () => {
    Object.defineProperty(Platform, 'OS', {
      get: () => 'ios',
      configurable: true,
    });
    (getBackendDevicesInfo as jest.Mock).mockResolvedValueOnce([]);

    const options = await getDeviceOptions();
    const metal = options.find(option => option.id === 'gpu');

    expect(options.map(option => option.id)).toEqual(['auto', 'gpu', 'cpu']);
    expect(metal?.label).toBe('Metal');
    expect(metal?.devices).toEqual(['Metal']);
    expect(metal?.n_gpu_layers).toBe(99);
    expect(metal?.no_gpu_devices).toBe(false);
  });
});
