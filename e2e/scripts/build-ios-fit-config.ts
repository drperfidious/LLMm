/**
 * Generate an iOS model-fit bench-config.json for BenchmarkRunnerScreen.
 *
 * Defaults target iPhone 14 Pro Max (iPhone15,3 / A16 / 6 GiB seed) and
 * run mmap-backed loading by default. Set IOS_FIT_USE_MMAP=true,false only
 * for explicit boundary/stress sweeps.
 *
 *   IOS_FIT_TIER=smoke|ladder|max       default ladder
 *   IOS_FIT_MODELS=qwen3.5-2b,phi-4-mini
 *   IOS_FIT_QUANTS=q4_0,q6_k
 *   IOS_FIT_BACKENDS=cpu,gpu            default gpu
 *   IOS_FIT_CPU_REFERENCES=default|id:quant,...
 *   IOS_FIT_USE_MMAP=true,false         optional no-mmap stress sweep
 *   IOS_FIT_CACHE_K=f16,q8_0            optional cache K sweep
 *   IOS_FIT_CACHE_V=f16,turbo4          optional cache V sweep
 *   IOS_FIT_BASE_CACHE_K=q8_0           default q8_0
 *   IOS_FIT_BASE_CACHE_V=turbo4         default turbo4
 *   IOS_FIT_FLASH_ATTN_TYPE=on          default on
 *   IOS_FIT_N_CTX=4096                  default 4096
 *   IOS_FIT_QUALITY=0                   disables completion quality tasks
 *
 *   --out <path>     output JSON path (default: e2e/debug-output/ios-fit-bench-config.json)
 */

import * as fs from 'fs';
import * as path from 'path';

import {buildIosFitConfig} from '../fixtures/ios-fit-models';

const DEFAULT_OUT = path.join(
  __dirname,
  '..',
  'debug-output',
  'ios-fit-bench-config.json',
);

interface Args {
  out: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {out: DEFAULT_OUT};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      out.out = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    } else {
      console.error(`Unknown arg: ${arg}`);
      printHelpAndExit(1);
    }
  }
  return out;
}

function printHelpAndExit(code = 0): never {
  console.log(`
Usage: yarn build:ios-fit-config [--out <path>]

Environment:
  IOS_FIT_TIER=smoke|ladder|max
  IOS_FIT_MODELS=id1,id2
  IOS_FIT_QUANTS=q4_0,q6_k
  IOS_FIT_BACKENDS=cpu,gpu
  IOS_FIT_CPU_REFERENCES=default
  IOS_FIT_USE_MMAP=true,false      optional no-mmap stress sweep
  IOS_FIT_CACHE_K=f16,q8_0
  IOS_FIT_CACHE_V=turbo4,turbo3,turbo2
  IOS_FIT_BASE_CACHE_K=q8_0
  IOS_FIT_BASE_CACHE_V=turbo4
  IOS_FIT_FLASH_ATTN_TYPE=on
  IOS_FIT_N_CTX=4096
  IOS_FIT_QUALITY=0

Output:
  ${DEFAULT_OUT}
`);
  process.exit(code);
}

function summarize(cfg: ReturnType<typeof buildIosFitConfig>) {
  const axes = (cfg as {settings_axes?: Array<{values: unknown[]}>})
    .settings_axes;
  const axesProduct =
    axes && axes.length > 0
      ? axes.reduce((acc, axis) => acc * axis.values.length, 1)
      : 1;
  const baseCells = cfg.models.reduce((sum, model) => {
    const backends = model.backends ?? cfg.backends;
    return sum + model.quants.length * backends.length;
  }, 0);
  const qualityTasks = cfg.quality_tasks?.length ?? 0;
  console.error(`suite=${cfg.suite.id}`);
  console.error(`target=${cfg.suite.target_device.label}`);
  console.error(
    `models=${cfg.models.length}, default_backends=${cfg.backends.join(
      '+',
    )}, cells=${baseCells * axesProduct}, quality_tasks=${qualityTasks}`,
  );
  for (const model of cfg.models) {
    const backends = model.backends ? ` [${model.backends.join('+')}]` : '';
    console.error(
      `  ${model.id}${backends}: ${model.quants.map(q => q.quant).join(',')}`,
    );
  }
  if (axes && axes.length > 0) {
    console.error(`settings_axes=${axes.length}`);
    for (const axis of axes as Array<{name: string; values: unknown[]}>) {
      console.error(`  ${axis.name}=${axis.values.join(',')}`);
    }
  }
}

export function buildScreenConfig() {
  return buildIosFitConfig();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = buildScreenConfig();

  if (cfg.models.length === 0 || cfg.backends.length === 0) {
    console.error('Error: filters produced an empty iOS fit matrix.');
    process.exit(1);
  }

  summarize(cfg);
  fs.mkdirSync(path.dirname(args.out), {recursive: true});
  fs.writeFileSync(args.out, JSON.stringify(cfg, null, 2));
  console.error(`wrote ${args.out}`);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}
