# LLMm

**Local-first iOS LLM workspace** — private chat, agent tools, documents, on-device benchmarking, and model tuning.

> Built on [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai) and heavily reworked for iOS.  
> Made by [Dr.Perfidious](https://github.com/drperfidious).

---

## What is LLMm?

LLMm runs large language models entirely on-device using [llama.rn](https://github.com/mybigday/llama.rn) and Apple Metal. Everything stays on your iPhone — no cloud, no telemetry, no subscriptions. On top of the base PocketPal runtime, LLMm adds a full **agent tool layer**, native iOS integrations, and a benchmarking harness for evaluating models on real hardware.

---

## Features

### 🤖 Agent Mode & Talent System

LLMm extends the base app with a structured **tool/talent** system that lets on-device models interact with your iPhone natively.

| Talent | What it does |
|--------|-------------|
| **Web Search** | Brave Search API integration with per-country and safe-search controls |
| **Workspace Files** | Read, write, search, list, and move files in a sandboxed on-device workspace. PDF text extraction via native PDFKit. |
| **Workspace Shell** | Run sandboxed shell commands from within the workspace |
| **Apple Calendar & Reminders** | Search, create, complete, and delete calendar events and reminders via EventKit |
| **Apple Clock** | Create and cancel AlarmKit-backed timers and alarms (iOS 26+) |
| **Mail Bridge** | Read and send email via a self-hosted HTTP mail bridge. Supports Gmail and IMAP/SMTP with SSL/STARTTLS |
| **Custom Instructions** | Per-agent tool definitions |

**Keyword routing** — agents automatically activate matching talents based on user message content (e.g. "check my email" routes to Mail Bridge, "set a timer" routes to Clock), without requiring the model to know which tools are available.

**Robust tool-call parsing** — the agent runner tolerates malformed JSON tool arguments from models, with multi-stage repair using JSON5 and control-character escaping. Duplicate tool calls are detected and short-circuited to prevent loops.

---

### 📱 Native iOS Integrations

New Swift/ObjC modules added on top of the base app:

- **`AppleCalendarModule`** — EventKit calendar + reminder bridge
- **`AppleClockModule`** — AlarmKit timer/alarm bridge (iOS 26+)
- **`NativeMailModule`** — Compose and send mail via `MFMailComposeViewController`
- **`PdfTextExtractor`** — Native PDFKit text extraction with configurable char limits

---

### ⚡ Metal & Model Tuning

- **Per-model settings** — each model keeps its own load profile (backend, context size, batch size, K/V cache type, flash attention). Changing settings for one model no longer overwrites another.
- **iOS Metal device selection** — treats `MTLDevice` names (e.g. "Apple A16 GPU") as stable "Metal" markers, applied consistently across Settings and profile loads.
- **Dynamic Metal batch tuning** — optional mode that raises low batch values on Metal loads for throughput. Off by default.
- **TurboQuant cache support** — custom `llama.rn` patch adds `Turbo2`/`Turbo3`/`Turbo4` KV cache types. Includes CPU `get-rows` coverage so turbo cache tensors don't abort on fallback paths.
- **Flash attention safety checks** — validates that flash attention + KV cache type combinations are safe before initiating a load.

---

### 🔢 Math Rendering

Chat output now renders LaTeX math without a WebView or MathJax runtime:

- Detects bare LaTeX commands (`\frac`, `\sqrt`, `\sum`, Greek letters, etc.) and display/inline math delimiters
- Applies Unicode symbol substitutions (α β γ Σ ∫ ⋯ etc.) and readable fraction/root formatting
- Skips math formatting inside code fences and inline code spans

---

### 📋 Other Improvements

- **Explore tab** — search overlay for the Pals/Agents hub with result rows and stale-guard debouncing
- **Documents screen** — workspace file browser with document previews
- **Donation / tips** — optional App Store in-app tips via StoreKit (`LLMmTips.storekit`)
- **Tool trace disclosure** — collapsible trace view for agent tool call chains in chat
- **Feedback screen** — in-app feedback form with email draft fallback
- **i18n** — full localization key coverage for all new features

---

## iOS Benchmarking

LLMm includes a benchmark harness for evaluating model performance on real iOS hardware.

See [`docs/testflight-alpha.md`](docs/testflight-alpha.md) for the full TestFlight build workflow.

**Quick archive:**
```sh
DEVELOPER_DIR=/path/to/Xcode-beta.app/Contents/Developer \
scripts/archive-ios-testflight-xcode27.sh
```

**With overrides:**
```sh
TEAM_ID=XXXXXXXXXX \
BUNDLE_ID=com.randyduquette.llmm \
MARKETING_VERSION=0.4.0 \
BUILD_NUMBER=2026062001 \
scripts/archive-ios-testflight-xcode27.sh
```

---

## Mail Bridge

The mail talent connects to a self-hosted **LLMm mail bridge** — a small HTTP server that wraps IMAP/SMTP/Gmail. The agent never connects directly to `imap.gmail.com` or the Gmail REST API; it only talks to the bridge URL you configure (e.g. `http://192.168.1.20:8787`).

Supported providers: **Gmail**, **IMAP+SMTP** (SSL / STARTTLS / plain), **custom bridge**.

---

## Building

Requires React Native + the iOS toolchain. Node ≥ 22.21.0 is needed for Yarn package scripts without `YARN_IGNORE_ENGINES=1`.

```sh
yarn install
yarn ios
```

For TestFlight / App Store Connect builds, use the archive script above.

---

## Based On

LLMm is a fork of [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai) by [@a-ghorbani](https://github.com/a-ghorbani), released under the [MIT License](LICENSE). The upstream project is unaffiliated with LLMm.

---

## License

MIT — see [LICENSE](LICENSE).
