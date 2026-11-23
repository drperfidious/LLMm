# LLMm Release Notes

## 0.4.0 TestFlight Candidate

Date: 2026-06-22

Status: ready for device install and App Store Connect upload.

### Customer Changelog

- Improved per-model settings so each model can keep its own load profile.
- Improved iOS Metal setup and backend reporting for faster, clearer model loads.
- Added an opt-in Dynamic Metal batch tuning switch for users who want LLMm to raise low batch values on Metal loads.
- Improved chat Markdown rendering, especially math equations in model replies.
- Kept code blocks and shell text safer while formatting Markdown and math.
- Improved email reading so snippets come from decoded message text instead of raw MIME/base64 chunks.
- Added broader email wording support, including plural "emails", so agent mode routes common mailbox requests correctly.
- Added iOS 26+ clock talents for LLMm-owned timers and alarms, plus clearer reminder creation/removal workflow.
- Hardened Turbo KV benchmark/model loading so Turbo2/Turbo3/Turbo4 cache tensors do not abort when a CPU fallback path reads them.
- Added more regression coverage around model profiles, Metal settings, and Markdown/math rendering.

### Completed In This Candidate

- [x] Fixed offloaded per-model profile saves. Changing K/V cache, context, batch, backend, or similar settings from the Models tab no longer gets overwritten by stale global settings when the model is not loaded.
- [x] Made active-model reload behavior stricter. If a saved start profile changes while the model is already loaded, the next load path can detect that the active context no longer matches the profile.
- [x] Improved iOS Metal device selection. Settings now treats iOS Metal as the GPU backend correctly and applies CPU/Metal backend choices consistently.
- [x] Added native backend snapshots after local model init so diagnostics can show requested backend, effective backend, GPU flag, device list, and init settings.
- [x] Added optional Dynamic Metal batch tuning. It is off by default and preserves user batch values unless explicitly enabled.
- [x] Relaxed overly broad iOS Metal fallback behavior so successful Metal loads are not permanently held back by stale failure records.
- [x] Improved chat and document Markdown math formatting. Bare LaTeX lines, display math, inline math, fractions, roots, Greek symbols, common operators, and superscripts now render as readable text instead of raw TeX.
- [x] Improved native mail parsing for multipart, base64, quoted-printable, text/plain, and HTML bodies so search snippets are human-readable.
- [x] Added plural email keywords and mailbox intent hints for search/read/send flows.
- [x] Added AlarmKit-backed tools for app-owned timers and alarms on iOS 26+, with routing hints that explain the app-owned limitation.
- [x] Improved reminder creation guidance, malformed due-date rejection, and reminder deletion support.
- [x] Added Turbo2/Turbo3/Turbo4 CPU get-rows coverage in the llama.rn patch to avoid native aborts during aggressive benchmark cells.
- [x] Added regression tests for offloaded model profile persistence, inactive model settings saves, iOS Metal selection/snapshots, dynamic batch tuning, and Markdown math rendering.

### Final Test Focus

- Save a model profile while the model is offloaded, then load it and confirm Settings shows the saved values.
- Switch between CPU and Metal in Settings and confirm the selected backend sticks.
- Load a known Metal-friendly model and confirm effective backend/reporting looks sane.
- Ask for math-heavy output and confirm equations are readable in chat.
- Try a Markdown/code-heavy answer and confirm code blocks are not altered by math formatting.
- Search/read recent emails and confirm snippets are readable.
- Create a reminder with a clear due time, remove it, and verify ambiguous dates trigger a follow-up instead of a malformed tool call.
- On iOS 26+, create a short LLMm timer/alarm and confirm the AlarmKit permission prompt and app-owned clock item behavior.
- Run a short benchmark smoke pass and watch for crashes or stale progress.

### Known Follow-Ups

- This release uses lightweight native math formatting, not a full TeX layout engine. It is meant to make model replies readable without adding a heavy WebView or MathJax runtime per equation.
- Some third-party dependency warnings remain during native builds; they are noisy but not blocking this candidate.
