# iOS Fit Benchmark Suite

This private suite extends `BenchmarkRunnerScreen` from raw throughput into a
model-fit ladder:

1. load each model/quant/backend/settings cell,
2. run `ctx.bench()` for prompt and generation speed,
3. run quality tasks for JSON formatting, tool-call emission, reasoning, and
   long-context sentinel recall,
4. record runtime device profile and per-cell memory samples,
5. summarize baseline promotions from the resulting report.

## Target Seed

The first profile is `iphone-14-pro-max`:

- machine: `iPhone15,3`
- chip: A16 Bionic
- expected RAM seed: 6 GiB

Apple publishes the A16 CPU/GPU/Neural Engine specs, but not RAM. The 6 GiB
value is only a config seed; every report records live `DeviceInfo.getTotalMemory()`
and native `os_proc_available_memory()` values from the device.

## Generate Config

When no `bench-config.json` exists on-device, the app now generates an
`ios-fit-dynamic-ladder` config in the benchmark storage directory. The dynamic
builder uses:

- bundled iOS device rules as a cold-start floor,
- the current best candidate,
- `benchmark-device-fit-profile.json` from previous measured runs,
- `benchmark-candidate-catalog.json` from prior Hugging Face discovery,
- a live Hugging Face GGUF refresh when network is available.

Generated dynamic configs are marked with `suite.candidate_discovery` and are
refreshed on the next run. A hand-pushed `bench-config.json` without that marker
is treated as a manual override and is not replaced.

From the repo root:

```sh
yarn build:ios-fit-config
```

Default output:

```text
e2e/debug-output/ios-fit-bench-config.json
```

Useful knobs:

```sh
IOS_FIT_TIER=smoke|ladder|max
IOS_FIT_MODELS=qwen3.5-2b,phi-4-mini
IOS_FIT_QUANTS=q4_0,q6_k
IOS_FIT_BACKENDS=cpu,gpu
IOS_FIT_CPU_REFERENCES=default
IOS_FIT_USE_MMAP=true,false
IOS_FIT_CACHE_V=turbo4,turbo3,turbo2
IOS_FIT_BASE_CACHE_K=q8_0
IOS_FIT_BASE_CACHE_V=turbo4
IOS_FIT_FLASH_ATTN_TYPE=on
IOS_FIT_N_CTX=4096
IOS_FIT_QUALITY=0
```

The default tier is `ladder`, backend is `gpu` (iOS Metal), and mmap-backed
loading is used for the full ladder. The default cache baseline is Metal
TurboQuant with `cache_type_k=q8_0`, `cache_type_v=turbo4`, and
`flash_attn_type=on`, then the settings axis runs the V-cache ladder
`turbo4 -> turbo3 -> turbo2` so the report can promote the best TurboQuant
profile per model instead of assuming the conservative setting wins. Set
`IOS_FIT_CACHE_V=turbo4` to force a single conservative V-cache profile. Set
`IOS_FIT_USE_MMAP=true,false` only for an explicit boundary/stress sweep;
no-mmap generally increases peak RAM and is not useful to duplicate across
every model that already fits cleanly.

CPU rows are opt-in. Set `IOS_FIT_CPU_REFERENCES=default` to append two small
CPU-only reference cells (`qwen3.5-0.8b:q4_0` and `smollm3-3b:q4_k_m`), set a
custom comma-separated `id:quant` list, or set `IOS_FIT_BACKENDS=cpu,gpu` when
every ladder cell should run on both CPU and Metal. CPU rows set
`no_gpu_devices=true` on iOS so they stay a real CPU baseline even when Metal
mapped-buffer logs are present.

The in-app runner keeps a compact `benchmark-result-cache.json` beside the
reports. It caches deterministic quality failures by model, quant, backend,
settings fingerprint, and quality-task signature, then records later repeats as
`status:"skipped"` rows instead of re-running a model that already failed the
same reasoning/format/tool/context tests.

It also keeps `benchmark-device-fit-profile.json`. This is an empirical fit
profile keyed by model file/backend/settings and records load/quality status,
peak memory, speed, file size, mmap, context, and TurboQuant cache settings.
Future dynamic ladders use this measured profile to include known-good models,
avoid repeated hard-fail configs, and treat density-specialized models like
Bonsai by observed footprint instead of parameter count alone.

## Summarize Report

After pulling a `benchmark-report-*.json`:

```sh
yarn summarize:ios-fit-report --input /path/to/benchmark-report.json
```

Rows are baseline-eligible only when the model loads, the speed bench completes,
and all quality tasks pass. The summary reports best overall score, max fit in
ladder order, and each promotion where a later row beats the current baseline.

Quality is also reported as capability tiers so smaller models are not treated
as useless just because they miss the strict all-pass baseline gate:

- `fit`: model loaded, benchmarked, and returned speed metrics.
- `chat-capable`: passed the arithmetic reasoning task.
- `format-capable`: passed strict JSON formatting.
- `agent-capable`: emitted the requested structured tool call.
- `long-context-capable`: recalled long-context sentinel values.
- `baseline-eligible`: passed every configured quality task.
