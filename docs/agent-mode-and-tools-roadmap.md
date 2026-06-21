# Agent Mode and Tool Roadmap

## 0.3.2 to 0.4.0 Release Slice

### 0.3.2 Stability

- Fix model-tab load-profile numeric fields so users can clear and replace values without the old value immediately snapping back.
- Keep Agent-mode bottom controls compact enough for iPhone-width layouts.
- Improve chat Markdown rendering for common inline and display math syntax.
- Keep the voice reply control available when needed, but make it icon-only in Agent mode so it does not cover thinking/tool controls.

### 0.4.0 Tool Surface

- Documents tab:
  - import, create, edit, delete, and cache app-library documents on disk
  - clone selected document text into the active chat
  - expose agent tools for listing, reading, writing, adding, and removing app-library files
- Sandboxed project shell:
  - no arbitrary iOS process execution
  - provide app-container file commands such as list, read, write, append, move, delete, search, and export
  - make the working directory explicit per project/library folder
- Mail talents:
  - IMAP read/search support through user-provided server settings
  - SMTP or draft-only send path depending on account support and user confirmation
  - keychain-backed secrets, never hard-coded credentials
- Calendar talent:
  - EventKit-backed event search/create/update with explicit permissions and confirmation for writes
- Deep research loop:
  - web search, source fetch, note extraction, synthesis, and citation tracking as an Agent-mode workflow
- Native Apple control surface research:
  - App Intents/Siri Shortcuts for launching chats, asking selected agents, and running approved talents
  - keep SMS/app-control work behind public iOS APIs only; no private API dependency

### Business Model Exploration

- Ads:
  - only consider low-intrusion placements such as model-load screens or restrained banners
  - include a remove-ads purchase if ads ship
- Paid unlock:
  - evaluate a simple flat price in the $0.99 to $4.99 range before introducing recurring complexity

### Cleanup Track

- Continue converting remaining PocketPal/Pal naming to LLMm/Agent terminology.
- Preserve upstream attribution where appropriate while making app-facing copy clearly LLMm-owned.

## Mode Contract

LLMm now has two explicit chat execution modes:

- Chat mode: plain model completion. Tool schemas, tool-choice hints, intent-injection hints, native tool-call execution, and text-wrapped fallback tool-call parsing are disabled.
- Agent mode: safe default tools (`calculate`, `datetime`, `web_search`) are available even without an active agent. Additional side-effect tools come from the active agent pact. The runner can execute native `tool_calls` and strict text-wrapped tool-call JSON, with allow-list validation and repeated-call guards.

Default mode is Chat. Agent mode is an explicit opt-in because future tools can have side effects.

## iOS-Native Tool Candidates

### Calendar and Reminders

Best first native side-effect tools.

- Framework: EventKit.
- Public scope: create, view, and edit calendar and reminder data.
- Access model: explicit permission prompts through `EKEventStore`, including write-only calendar access, full calendar access, and full reminders access.
- Required plist strings:
  - `NSCalendarsWriteOnlyAccessUsageDescription`
  - `NSCalendarsFullAccessUsageDescription`
  - `NSRemindersFullAccessUsageDescription`
- Recommended tools:
  - `calendar_create_event`
  - `calendar_find_events`
  - `calendar_update_event`
  - `reminder_create`
  - `reminder_find`
  - `reminder_complete`
- Safety policy:
  - write actions require Agent mode
  - first implementation should ask for confirmation before save/modify/delete
  - read tools should summarize only the fields needed for the user request

Sources: Apple EventKit, EKEventStore, EKEvent, EKReminder docs.

### Mail and Messages

Do not plan for full iOS Mail or Messages read/write through a normal app.

- `MailKit` is macOS-only in Apple docs.
- `MessageUI` on iOS supports presenting a compose UI for the user to edit/send mail; it does not give an app a mailbox reader.
- Recommended safe tool:
  - `mail_draft`: opens native compose UI with user-approved recipients, subject, and body.
  - `sms_draft`: opens native Messages UI with user-approved recipients and body.
- Implemented safe tools:
  - `mail_draft`: opens a `mailto:` compose draft through the OS.
  - `sms_draft`: opens a Messages compose draft through the OS.
- Not feasible as normal iOS app tools:
  - inbox search
  - Messages history search
  - read arbitrary Mail messages
  - read arbitrary SMS/iMessage conversations
  - silent send
  - mailbox automation

Sources: Apple MailKit and MessageUI/MFMailComposeViewController docs.

### Web Search

Good Agent-mode candidate, but not a native Apple capability.

- Direct API route: `web_search` calls Brave Search API over HTTPS using the Brave key saved on-device from the Talents screen.
- MCP route: implement a small MCP client in the app, or more realistically call a remote/local bridge that speaks MCP and exposes Brave tools over HTTP.
- iOS constraint: stdio MCP servers and arbitrary local subprocesses are not a fit on iOS; HTTP/SSE or Streamable HTTP style transports are the practical path.
- Recommended tools:
  - `web_search` (implemented)
  - `web_fetch`
  - `web_search_news`
- Safety policy:
  - never send private calendar/reminder/mail content to web search unless the user explicitly asks
  - include citations in tool output so the model can cite sources

Sources: Brave Search API, Brave Search MCP Server, MCP specification.

### Shell and Local System Actions

Do not plan for arbitrary shell execution on iOS.

- Apple `Process` is documented for macOS and Mac Catalyst, not iOS.
- iOS apps operate inside an app sandbox. Use app-scoped APIs instead:
  - `FileManager` for app container files and security-scoped user-picked documents
  - Keychain for secrets
  - Talents screen for runtime tool configuration
  - BackgroundTasks for scheduled app-maintenance work within system limits
  - URLSession for network calls
- Recommended tools:
  - `files_list_workspace`
  - `files_read_note`
  - `files_write_note`
  - `settings_get`
  - `benchmark_export_report`
- Not feasible:
  - `/bin/sh`
  - arbitrary process spawn
  - reading other apps' private containers
  - background daemon behavior

Sources: Apple Foundation Process, FileManager, BackgroundTasks, Keychain docs.

## Implementation Order

1. Keep Chat/Agent mode explicit and visible.
2. Add an Agent tools registry screen or sheet showing enabled tools for the active agent.
3. Build EventKit calendar/reminder talents with permission status display and write confirmation.
4. Add `web_fetch` or source-detail expansion after Brave-backed `web_search`.
5. Add a remote MCP bridge adapter after direct native talents are stable.
6. Avoid Mail inbox and shell tools unless Apple exposes a new public iOS API or we target macOS separately.
