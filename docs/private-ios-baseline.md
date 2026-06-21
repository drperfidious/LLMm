# Private iOS Baseline

Date: 2026-06-18

Upstream repository: https://github.com/a-ghorbani/pocketpal-ai

Baseline commit: `aae5fb18a694008d31e053237fff2e4d46180717`

Local refs:

- Clean upstream branch: `baseline/upstream-main-20260618`
- Clean upstream tag: `baseline-upstream-main-20260618`
- Working private branch: `private/ios-baseline`

## Toolchain Snapshot

- macOS: 27.0 (`26A5353q`)
- Xcode: 26.1.1 (`17B100`)
- Simulator runtime: iOS 26.1 available
- Project Node requirement: `>=22.21.0`
- Local project Node used for checks: `~/.local/share/codex-runtimes/node-v22.21.0-darwin-arm64/bin/node`
- Yarn: `1.22.22` via Corepack
- Ruby exposed by shell: system Ruby `2.6.10`
- Project Ruby requirement: `3.2.3`

## Baseline Commands

Use the pinned local Node runtime unless a shell version manager already exposes Node `22.21.0` or newer:

```sh
export PATH="$HOME/.local/share/codex-runtimes/node-v22.21.0-darwin-arm64/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
```

Root dependency install:

```sh
corepack yarn install --frozen-lockfile
```

The first install attempt hit a transient DNS failure while `llama.rn` downloaded native artifacts from `release-assets.githubusercontent.com`; retrying completed successfully.

## Baseline Check Results

Passing:

- `corepack yarn typecheck`
- `corepack yarn lint`
  - 0 errors
  - 4 upstream warnings:
    - `src/components/SidebarContent/SidebarContent.tsx`: three `react/no-unstable-nested-components`
    - `src/utils/index.ts`: one deprecated React Native deep import warning
- `corepack yarn l10n:validate`
- `corepack yarn verify:fonts`
- `cd e2e && BENCH_TIER=smoke corepack yarn build:bench-config`
  - Generated smoke matrix: 3 models, CPU+GPU backends, 18 cells

Jest behavioral result:

- `corepack yarn test --runInBand --coverage=false --silent`
  - 233 test suites passed
  - 3486 tests passed, 2 skipped
  - 298 snapshots passed
  - Command exits 1 because Jest leaves async work/open handles after completion.

Jest coverage run:

- `corepack yarn test --runInBand`
  - Same suite/test pass count
  - Coverage summary: statements 75.48%, branches 70.26%, functions 71.44%, lines 75.58%
  - Command exits 1 for the same post-run open-handle behavior.

E2E harness:

- `cd e2e && corepack yarn install --frozen-lockfile` passes.
- `cd e2e && corepack yarn typecheck` currently fails on upstream TypeScript config/debt:
  - `rootDir` is `e2e`, but benchmark helpers import files under `../src`.
  - `pages/SettingsPage.ts` references `Selectors.serverConfig`, while the current selector tree exposes `serverDetails`.
  - `specs/memory-profile.spec.ts` expects `metal_allocated` on the memory snapshot type.

## Existing Benchmark Surface

The repo already has an E2E-only benchmark runner:

- App screen: `src/__automation__/screens/BenchmarkRunnerScreen.tsx`
- Deep link: `pocketpal://e2e/benchmark`
- Android config push/pull helpers: `e2e/helpers/bench-runner.ts`
- Matrix fixtures: `e2e/fixtures/benchmark-models.ts`
- Compare/merge scripts:
  - `e2e/scripts/benchmark-compare.ts`
  - `e2e/scripts/merge-bench-reports.ts`
  - `e2e/scripts/build-bench-config.ts`

The current committed benchmark matrix is Android-oriented. It measures prompt processing and token generation through the in-app `llama.rn` runner using bench params `{pp: 512, tg: 128, pl: 1, nr: 3}`. The next iOS work should extend this existing automation boundary rather than creating a second harness.

## iOS Signing Baseline

Current upstream Xcode project values are not ready for this machine's private Apple developer profile:

- Bundle identifier: `ai.pocketpal`
- Development team: `MYXGXY23Y6`
- Signing style for app target: manual
- Provisioning profiles:
  - `match Development ai.pocketpal`
  - `match AppStore ai.pocketpal`

Local signing/device discovery:

- Valid code-signing identity found: `Apple Development: Randy Duquette (RG9DG7WNDC)`
- Local provisioning profiles found under `~/Library/MobileDevice/Provisioning Profiles`: 0
- `devicectl` sees `x3n0s the Undying`, an iPhone 14 Pro Max, but its state is `unavailable`.

For a private device build, create a private branch that changes the app bundle identifier and development team to values owned by the target Apple developer account. Keep the clean upstream baseline branch/tag untouched.

## Next Branches

Suggested branch split:

- `private/ios-signing`: bundle id, development team, provisioning, first simulator/device build.
- `private/ios-bench-harness`: iOS benchmark config push/pull, benchmark report capture, model/task matrix expansion.
- `private/model-quality-suite`: pass/fail tasks for tool calling, formatting, reasoning, and context-load behavior.
- `private/agentic-backend-loop`: harden the backend agent loop, tool-call parsing, dynamic tool execution dispatch, and prompt/init injection before treating a model as generally useful.
- `private/turboquant-metal-research`: prototype CUDA-style turboquant ideas through the iOS/Metal-compatible layer after the baseline model is established.

For later Odysseus integration, keep it as a bridge/research path rather than a baseline dependency: local endpoint calls can target the existing OpenAI-style `/v1/chat/completions` shape when comparing on-device behavior against the local stack.

## Agentic Backend Loop

Do not let the TurboQuant/Metal path crowd out the agent layer. A faster model
is only valuable if the runtime can reliably identify intended actions, execute
tools, and feed results back into follow-up reasoning without fragile prompt
coupling.

Existing surface:

- `src/services/agent/AgentRunner.ts`: multi-turn loop, streaming token bridge,
  normalized tool-call ids, injected talent lookup, tool response replay.
- `src/services/agent/triggerMarkers.ts`: grammar-trigger marker cache from
  llama.rn formatted chat output.
- `src/services/talents/*`: registered executable tools/Talents and schemas.
- `src/__automation__/qualityTasks.ts`: benchmark tasks for formatting,
  tool-call emission, reasoning, and context recall.

Required next work:

1. Add a resilient tool-call parser layer that can recover calls from structured
   `tool_calls`, streamed partial tool-call chunks, common JSON-in-text forms,
   and model-family sentinels without executing ambiguous text accidentally.
2. Add a dynamic dispatch policy that validates tool name, schema, argument
   shape, user/Pal allow-list, and execution result before adding tool output
   to the next turn.
3. Add keyword/intent based init injection so prompts that imply calculator,
   date/time, render/html, code/data, or benchmark-analysis work can receive
   the right tool schemas and system hints without globally bloating every
   context.
4. Add loop guards: max turns, repeated-call detection, same-tool retry caps,
   malformed-argument repair attempts, and clear terminal errors.
5. Feed these checks into the benchmark matrix: tool execution should be scored
   on parsed call validity, argument correctness, execution success, follow-up
   answer quality, latency, and failure mode.

This work should run after the first clean iOS model baseline and before using
TurboQuant gains as a product-quality claim. TurboQuant can make weak agent
behavior faster, but it will not make weak parsing or dispatch correct.
