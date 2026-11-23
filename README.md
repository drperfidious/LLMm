# LLMm

**On-device iOS LLM app with TurboQuant KV cache compression.**

LLMm is an iOS app for running large language models locally using Apple Metal. Its main contribution is a port of **TurboQuant** — a WHT-rotation + PolarQuant KV cache compression scheme — directly into the llama.rn/llama.cpp stack that powers on-device inference on iPhone and Mac.

> Built on [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai) and heavily reworked.  
> Made by [Dr.Perfidious](https://github.com/drperfidious).

---

## TurboQuant KV Cache

The KV cache is the main memory bottleneck for long-context inference on device. TurboQuant compresses it using:

1. **Walsh-Hadamard Transform (WHT)** rotation — spreads energy across all 128 head-dimension channels before quantization, eliminating outliers that would otherwise require wide quantization bins.
2. **PolarQuant centroid quantization** — assigns each rotated value to the nearest optimal centroid for the target bit width.
3. **QJL residual** (1-bit Johnson-Lindenstrauss sign quantization of the residual) for the full TurboQuant formulation.

Three precision levels are available as `type_k` / `type_v` options in llama.cpp:

| Cache type | Bits/val | Compression vs f16 | Notes |
|------------|----------|--------------------|-------|
| `turbo2`   | ~2 bit   | ~6.4×              | Aggressive; quality-sensitive models need asymmetric config |
| `turbo3`   | ~3 bit   | ~4.9×              | Best compression/quality tradeoff for most models |
| `turbo4`   | ~4 bit   | ~3.8×              | Near-lossless for most models tested |

### Benchmark Results (Apple M5 Max, Metal)

**Qwen 3.5 35B-A3B MoE (Q8_0 weights):**

| type_k | type_v | Prompt tok/s | Gen tok/s | KV compression |
|--------|--------|-------------|-----------|----------------|
| q8_0   | q8_0   | **225.4**   | **85.0**  | 2.0×           |
| q4_0   | q4_0   | 221.5       | 84.5      | 4.0×           |
| turbo4 | turbo4 | 7.1         | 2.4       | 3.8×           |
| turbo3 | turbo3 | 4.2         | 2.4       | **4.9×**       |

**Qwen 2.5 7B Q4_K_M (quality-sensitive model, asymmetric K/V):**

| type_k | type_v | PPL   | vs q8_0 baseline | V compression |
|--------|--------|-------|-----------------|---------------|
| q8_0   | q8_0   | 6.58  | —               | 1.0×          |
| q8_0   | turbo4 | 6.64  | +1.0%           | 2.0×          |
| q8_0   | turbo3 | 6.71  | +2.0%           | 2.3×          |
| q8_0   | turbo2 | 6.91  | +5.1%           | 3.2×          |

**phi-4 Q8_0:**

| type_k | type_v | PPL  | vs baseline |
|--------|--------|------|-------------|
| q8_0   | turbo4 | 4.70 | +0.3%       |
| q8_0   | turbo3 | 4.74 | +1.1%       |
| q8_0   | turbo2 | 4.84 | +3.1%       |
| turbo4 | turbo4 | 4.77 | +1.7%       |
| turbo3 | turbo3 | 4.89 | +4.2%       |

**Key finding — K precision dominates quality.** The attention mechanism computes `softmax(Q·K^T)·V`. Errors in K shift attention routing and cascade through softmax; errors in V only affect the weighted sum proportionally. This means:
- `q8_0` K + `turbo3` V = PPL 6.71 (+2.0%) — rescued
- `turbo3` K + `q8_0` V = PPL 3556 — catastrophic

This is why asymmetric K/V configs (high-precision K, turbo V) are the practical operating point for quality-sensitive or aggressively weight-quantized models.

**Speed regression note:** The current Metal implementation performs a full 128×128 matrix-vector multiply (WHT rotation) per 4–16 element chunk — O(d²) per block. The optimization path is: threadgroup memory caching → fast Walsh-Hadamard (O(d log d)) → fused flash attention kernel with integrated dequantize.

---

## Implementation

### llama.rn patch (`patches/llama.rn+0.12.4.patch`)

The core TurboQuant work lives in a patch against llama.rn 0.12.4. It adds:

- **New GGML types:** `LM_GGML_TYPE_TURBO2_0`, `TURBO3_0`, `TURBO4_0` — block structs, `static_assert` size checks, `from_float` and `vec_dot` function tables
- **New op:** `LM_GGML_OP_TURBO_WHT` — the Walsh-Hadamard Transform rotation op, registered in `ggml-backend-meta.cpp` with scalar-only split policy
- **New source file:** `ggml-turbo-quant.c` — quantization kernels for all three levels, registered in both Android CMake and iOS Xcode build files
- **`ggml-common.h`:** `block_q2_0` and all three TurboQuant block struct definitions with size assertions
- **CPU `get-rows` coverage:** Turbo2/3/4 `get-rows` paths in the CPU backend so turbo cache tensors don't abort on fallback paths during benchmarks
- **`q2_0` base type:** `QK2_0 = 128`, `QI2_0`, `QR2_0` constants; `block_q2_0` struct as the foundation for TurboQuant's 2-bit level

This patch is applied by `patch-package` via the `patches/` directory. It is not in upstream llama.rn or llama.cpp.

### App-level integration (`src/`)

- **`src/utils/flashAttnCompatibility.ts`** — `isTurboCacheType()`, `isTurboCachePairSafe()`: validates that flash attention and K/V cache type combinations are safe before initiating a model load. Prevents crashes from illegal Turbo+FlashAttn pairings.
- **`src/utils/iosMetalPolicy.ts`** — treats `MTLDevice` names (e.g. "Apple A16 GPU") as stable "Metal" markers rather than hardware-specific strings. Metal backend selection, Dynamic Metal batch tuning, and per-device fallback policy.
- **`src/store/ModelStore.ts`** — per-model settings with Turbo KV cache type persistence. Each model keeps its own load profile (backend, context, batch, K/V cache type, flash attention). The Metal marker is stripped before native init so llama.cpp auto-selects the real Metal device.

---

## Asymmetric K/V Discovery

During Metal flash attention kernel work in March 2026, a missing kernel instantiation bug was found that caused NaN outputs for `q8_0`-K + `turbo4`-V configs. Investigation revealed it as the key to practical TurboQuant deployment:

The asymmetric implementation initially only added turbo×turbo kernel instantiations. When `q8_0`-K + `turbo4`-V was requested, the pipeline name was constructed correctly but no matching kernel existed. The dispatch fell back to an undefined path that happened to produce correct results for `turbo3`-V (lucky fallback) and NaN for `turbo4`-V.

**Fix:** Added 240 new Metal kernel instantiations (90 non-vec + 60 vec for turbo×turbo, plus 90 non-vec + 60 vec for q8_0×turbo in both directions), covering all head dimensions. Pipeline names were migrated to `k{type}_v{type}` format to avoid underscore ambiguity in type names like `q4_0`.

This work is tracked in the `research/turboquant_plus/` directory alongside perplexity results, benchmark scripts, and the full investigation writeup.

---

## iOS App Features

LLMm is a usable app, not just a benchmark harness. On top of the TurboQuant-enabled inference stack:

- **Agent mode** with native iOS tool integrations: Calendar, Reminders, AlarmKit timers (iOS 26+), Mail bridge (Gmail / IMAP+SMTP), on-device workspace files, PDF text extraction, web search (Brave API)
- **Keyword routing** — agents activate matching tools based on message content without requiring the model to know the tool registry
- **Math rendering** — LaTeX math in chat output rendered as Unicode without WebView/MathJax
- **Per-model settings** — each model keeps its own backend, context, batch, K/V cache, and flash attention profile
- **TestFlight build workflow** — archive + upload script for Xcode 27, see [`docs/testflight-alpha.md`](docs/testflight-alpha.md)
- **In-app tips** via StoreKit (optional)

---

## Related Research

The `research/` directory (not in this repo) contains:

- **`llama-cpp-turboquant/`** — a full fork of llama.cpp (`feature/turboquant-kv-cache`) with 262+ fork commits, CUDA kernels (turbo2/3/4, warp-cooperative dequant, fused mul_mat_vec), HIP/ROCm support, Metal TQ3-rotated mul_mm, Vulkan KV cache pipelines, and an upstream catch-up merge log
- **`turboquant_plus/`** — the Python research prototype: PolarQuant codebook construction, QJL implementation, benchmark scripts, perplexity validation against paper bounds, and the asymmetric K/V investigation writeup

---

## Building

```sh
yarn install
yarn ios
```

Requires Node ≥ 22.21.0 for Yarn package scripts. The TurboQuant patch is applied automatically by `patch-package` on `yarn install`.

For TestFlight builds:

```sh
DEVELOPER_DIR=/path/to/Xcode-beta.app/Contents/Developer \
TEAM_ID=XXXXXXXXXX \
BUNDLE_ID=com.randyduquette.llmm \
scripts/archive-ios-testflight-xcode27.sh
```

---

## Based On

- [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai) by [@a-ghorbani](https://github.com/a-ghorbani) — MIT
- [llama.rn](https://github.com/mybigday/llama.rn) — the React Native llama.cpp bridge
- TurboQuant algorithm: [_TurboQuant: Optimal Rotated Quantization for KV Cache_](https://arxiv.org/abs/2501.06750) (Yao et al., 2025)

---

## License

MIT — see [LICENSE](LICENSE).
