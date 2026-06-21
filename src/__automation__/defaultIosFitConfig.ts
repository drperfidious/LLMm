import type {BenchConfig} from './screens/BenchmarkRunnerScreen';
import {buildStaticIosFitConfig} from './iosFitDiscovery';

export function buildDefaultIosFitConfig(): BenchConfig {
  return buildStaticIosFitConfig().config;
}
