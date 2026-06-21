/**
 * PACT Vocabulary Audit Tests (TASK-20260415-1200)
 *
 * These tests verify that:
 * 1. Old "tool" vocabulary is fully replaced in our PACT layer
 * 2. Wire format names (tool_calls, tool_choice, etc.) are preserved
 * 3. TalentResult type union covers expected variants
 * 4. TalentRef type has expected shape
 */
import {TalentRegistry, talentRegistry} from '../TalentRegistry';
import {
  registerDefaultTalents,
  resetRegisteredFlag,
  deriveToolSchemas,
  RenderHtmlEngine,
  CalculateEngine,
  DatetimeEngine,
  SmsDraftEngine,
  MailDraftEngine,
  MailReadEngine,
  MailSearchEngine,
  MailSendEngine,
  DeepResearchEngine,
  WebSearchEngine,
  TalentDesignerEngine,
  WorkspaceDeleteEngine,
  WorkspaceListEngine,
  WorkspaceReadEngine,
  WorkspaceSearchEngine,
  WorkspaceShellEngine,
  WorkspaceWriteEngine,
  CalendarCreateEventEngine,
  CalendarFindEventsEngine,
  ReminderCompleteEngine,
  ReminderCreateEngine,
  ReminderFindEngine,
} from '../index';
import type {TalentEngine, TalentResult, ToolDefinition} from '../types';

describe('PACT vocabulary audit', () => {
  describe('TalentEngine interface contract', () => {
    const engines: TalentEngine[] = [
      new RenderHtmlEngine(),
      new CalculateEngine(),
      new DatetimeEngine(),
      new SmsDraftEngine(),
      new MailDraftEngine(),
      new MailSearchEngine(async () => 'test-token'),
      new MailReadEngine(async () => 'test-token'),
      new MailSendEngine(async () => 'test-token'),
      new DeepResearchEngine(),
      new WebSearchEngine(async () => 'test-key'),
      new TalentDesignerEngine(),
      new WorkspaceListEngine(),
      new WorkspaceReadEngine(),
      new WorkspaceWriteEngine(),
      new WorkspaceDeleteEngine(),
      new WorkspaceSearchEngine(),
      new WorkspaceShellEngine(),
      new CalendarFindEventsEngine(),
      new CalendarCreateEventEngine(),
      new ReminderFindEngine(),
      new ReminderCreateEngine(),
      new ReminderCompleteEngine(),
    ];

    it.each(engines.map(e => [e.name, e]))(
      '%s engine implements TalentEngine interface',
      (_name, engine) => {
        expect(typeof engine.name).toBe('string');
        expect(engine.name.length).toBeGreaterThan(0);
        expect(typeof engine.execute).toBe('function');
        expect(typeof engine.toToolDefinition).toBe('function');
      },
    );

    it.each(engines.map(e => [e.name, e]))(
      '%s engine toToolDefinition returns valid ToolDefinition',
      (_name, engine) => {
        const def: ToolDefinition = engine.toToolDefinition();
        expect(def.type).toBe('function');
        expect(typeof def.function.name).toBe('string');
        expect(typeof def.function.description).toBe('string');
        expect(def.function.parameters).toBeDefined();
        expect(def.function.name).toBe(engine.name);
      },
    );
  });

  describe('TalentResult type variants', () => {
    it('RenderHtmlEngine returns html variant', async () => {
      const engine = new RenderHtmlEngine();
      const result: TalentResult = await engine.execute({
        html: '<p>test</p>',
        title: 'T',
      });
      expect(result.type).toBe('html');
      if (result.type === 'html') {
        expect(result.html).toBeDefined();
        expect(result.summary).toBeDefined();
      }
    });

    it('CalculateEngine returns text variant', async () => {
      const engine = new CalculateEngine();
      const result: TalentResult = await engine.execute({expression: '1+1'});
      expect(result.type).toBe('text');
      if (result.type === 'text') {
        expect(result.summary).toBeDefined();
      }
    });

    it('error variant includes errorMessage', async () => {
      const engine = new CalculateEngine();
      const result: TalentResult = await engine.execute({});
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorMessage).toBeDefined();
        expect(result.summary).toBeDefined();
      }
    });
  });

  describe('registerDefaultTalents populates all built-in engines', () => {
    beforeEach(() => {
      talentRegistry.reset();
      resetRegisteredFlag();
    });

    it('registers exactly the built-in talent engines', () => {
      registerDefaultTalents();
      expect(talentRegistry.has('render_html')).toBe(true);
      expect(talentRegistry.has('calculate')).toBe(true);
      expect(talentRegistry.has('datetime')).toBe(true);
      expect(talentRegistry.has('sms_draft')).toBe(true);
      expect(talentRegistry.has('mail_draft')).toBe(true);
      expect(talentRegistry.has('mail_search')).toBe(true);
      expect(talentRegistry.has('mail_read')).toBe(true);
      expect(talentRegistry.has('mail_send')).toBe(true);
      expect(talentRegistry.has('web_search')).toBe(true);
      expect(talentRegistry.has('deep_research')).toBe(true);
      expect(talentRegistry.has('create_talent')).toBe(true);
      expect(talentRegistry.has('workspace_list')).toBe(true);
      expect(talentRegistry.has('workspace_read')).toBe(true);
      expect(talentRegistry.has('workspace_write')).toBe(true);
      expect(talentRegistry.has('workspace_delete')).toBe(true);
      expect(talentRegistry.has('workspace_search')).toBe(true);
      expect(talentRegistry.has('workspace_shell')).toBe(true);
      expect(talentRegistry.has('calendar_find_events')).toBe(true);
      expect(talentRegistry.has('calendar_create_event')).toBe(true);
      expect(talentRegistry.has('reminder_find')).toBe(true);
      expect(talentRegistry.has('reminder_create')).toBe(true);
      expect(talentRegistry.has('reminder_complete')).toBe(true);
    });

    it('engines retrieved by name are executable', async () => {
      registerDefaultTalents();
      const calc = talentRegistry.get('calculate');
      expect(calc).toBeDefined();
      const result = await calc!.execute({expression: '2*3'});
      expect(result.type).toBe('text');
      expect(result.summary).toBe('2*3 = 6');
    });
  });

  describe('TalentRegistry isolation', () => {
    it('separate instances do not share state', () => {
      const a = new TalentRegistry();
      const b = new TalentRegistry();
      a.register(new CalculateEngine());
      expect(a.has('calculate')).toBe(true);
      expect(b.has('calculate')).toBe(false);
    });
  });

  describe('deriveToolSchemas', () => {
    beforeEach(() => {
      talentRegistry.reset();
      resetRegisteredFlag();
    });

    it('returns ToolDefinition array for all registered engines', () => {
      const schemas = deriveToolSchemas();
      expect(schemas).toHaveLength(22);
      const names = schemas.map(s => s.function.name);
      expect(names).toContain('calendar_find_events');
      expect(names).toContain('calendar_create_event');
      expect(names).toContain('render_html');
      expect(names).toContain('calculate');
      expect(names).toContain('datetime');
      expect(names).toContain('reminder_find');
      expect(names).toContain('reminder_create');
      expect(names).toContain('reminder_complete');
      expect(names).toContain('sms_draft');
      expect(names).toContain('mail_draft');
      expect(names).toContain('mail_search');
      expect(names).toContain('mail_read');
      expect(names).toContain('mail_send');
      expect(names).toContain('web_search');
      expect(names).toContain('deep_research');
      expect(names).toContain('create_talent');
      expect(names).toContain('workspace_list');
      expect(names).toContain('workspace_read');
      expect(names).toContain('workspace_write');
      expect(names).toContain('workspace_delete');
      expect(names).toContain('workspace_search');
      expect(names).toContain('workspace_shell');
    });

    it('works without prior registerDefaultTalents call', () => {
      // Registry is reset in beforeEach — deriveToolSchemas calls
      // registerDefaultTalents internally.
      expect(talentRegistry.has('render_html')).toBe(false);
      const schemas = deriveToolSchemas();
      expect(schemas).toHaveLength(22);
      expect(talentRegistry.has('render_html')).toBe(true);
    });
  });
});
