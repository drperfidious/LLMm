import {RenderHtmlEngine} from './RenderHtmlEngine';
import {RenderHtmlTalentUI} from './RenderHtmlTalentUI';
import {CalculateEngine} from './CalculateEngine';
import {DatetimeEngine} from './DatetimeEngine';
import {SmsDraftEngine} from './SmsDraftEngine';
import {MailDraftEngine} from './MailDraftEngine';
import {
  MailReadEngine,
  MailSearchEngine,
  MailSendEngine,
} from './MailBridgeEngines';
import {WebSearchEngine} from './WebSearchEngine';
import {DeepResearchEngine} from './DeepResearchEngine';
import {TalentDesignerEngine} from './TalentDesignerEngine';
import {WorkspaceShellEngine} from './WorkspaceShellEngine';
import {WorkspaceShellTalentUI} from './WorkspaceShellTalentUI';
import {
  WorkspaceDeleteEngine,
  WorkspaceListEngine,
  WorkspaceReadEngine,
  WorkspaceSearchEngine,
  WorkspaceWriteEngine,
} from './WorkspaceFileEngines';
import {
  CalendarCreateEventEngine,
  CalendarFindEventsEngine,
  ReminderCompleteEngine,
  ReminderCreateEngine,
  ReminderFindEngine,
} from './AppleOrganizerEngines';
import {talentRegistry} from './TalentRegistry';
import {talentUIRegistry} from './TalentUIRegistry';
import type {ToolDefinition} from './types';

export {TalentRegistry, talentRegistry} from './TalentRegistry';
export {TalentUIRegistry, talentUIRegistry} from './TalentUIRegistry';
export type {TalentUI} from './TalentUIRegistry';
export {RenderHtmlEngine} from './RenderHtmlEngine';
export {RenderHtmlTalentUI} from './RenderHtmlTalentUI';
export {CalculateEngine} from './CalculateEngine';
export {DatetimeEngine} from './DatetimeEngine';
export {SmsDraftEngine} from './SmsDraftEngine';
export {MailDraftEngine} from './MailDraftEngine';
export {
  checkMailBridgeStatus,
  MailReadEngine,
  MailSearchEngine,
  MailSendEngine,
} from './MailBridgeEngines';
export {WebSearchEngine} from './WebSearchEngine';
export {DeepResearchEngine} from './DeepResearchEngine';
export {CustomInstructionTalentEngine} from './CustomInstructionTalentEngine';
export {TalentDesignerEngine} from './TalentDesignerEngine';
export {WorkspaceShellEngine} from './WorkspaceShellEngine';
export {WorkspaceShellTalentUI} from './WorkspaceShellTalentUI';
export {
  WorkspaceDeleteEngine,
  WorkspaceListEngine,
  WorkspaceReadEngine,
  WorkspaceSearchEngine,
  WorkspaceWriteEngine,
} from './WorkspaceFileEngines';
export {
  CalendarCreateEventEngine,
  CalendarFindEventsEngine,
  ReminderCompleteEngine,
  ReminderCreateEngine,
  ReminderFindEngine,
} from './AppleOrganizerEngines';
export * from './talentSecrets';
export type {TalentEngine, TalentResult, ToolDefinition} from './types';

let registered = false;

/**
 * Register the built-in talent engines and UI renderers. Idempotent — safe to
 * call from any app-init path.
 */
export function registerDefaultTalents(): void {
  if (registered) {
    return;
  }
  // Engines
  talentRegistry.register(new RenderHtmlEngine());
  talentRegistry.register(new CalculateEngine());
  talentRegistry.register(new DatetimeEngine());
  talentRegistry.register(new SmsDraftEngine());
  talentRegistry.register(new MailDraftEngine());
  talentRegistry.register(new MailSearchEngine());
  talentRegistry.register(new MailReadEngine());
  talentRegistry.register(new MailSendEngine());
  talentRegistry.register(new WebSearchEngine());
  talentRegistry.register(new DeepResearchEngine());
  talentRegistry.register(new TalentDesignerEngine());
  talentRegistry.register(new WorkspaceListEngine());
  talentRegistry.register(new WorkspaceReadEngine());
  talentRegistry.register(new WorkspaceWriteEngine());
  talentRegistry.register(new WorkspaceDeleteEngine());
  talentRegistry.register(new WorkspaceSearchEngine());
  talentRegistry.register(new WorkspaceShellEngine());
  talentRegistry.register(new CalendarFindEventsEngine());
  talentRegistry.register(new CalendarCreateEventEngine());
  talentRegistry.register(new ReminderFindEngine());
  talentRegistry.register(new ReminderCreateEngine());
  talentRegistry.register(new ReminderCompleteEngine());
  // UIs
  talentUIRegistry.register(new RenderHtmlTalentUI());
  talentUIRegistry.register(new WorkspaceShellTalentUI());
  registered = true;
}

/**
 * Derive OpenAI-format tool schemas from registered engines.
 *
 * When `talentNames` is provided, only engines matching those names are
 * included — this ensures a Pal's completionSettings.tools matches its
 * pact.talents (the single source of truth for what the Pal advertises
 * to the model and what the dispatch loop will accept).
 *
 * Calls registerDefaultTalents() internally (idempotent).
 */
export function deriveToolSchemas(talentNames?: string[]): ToolDefinition[] {
  registerDefaultTalents();
  const engines = talentRegistry.getAll();
  if (!talentNames) {
    return engines.map(engine => engine.toToolDefinition());
  }
  const wanted = new Set(talentNames);
  return engines
    .filter(engine => wanted.has(engine.name))
    .map(engine => engine.toToolDefinition());
}

/**
 * Test helper: reset the `registered` guard so `registerDefaultTalents()` will
 * re-register engines after a `talentRegistry.reset()` call in test teardown.
 */
export function resetRegisteredFlag(): void {
  registered = false;
}
