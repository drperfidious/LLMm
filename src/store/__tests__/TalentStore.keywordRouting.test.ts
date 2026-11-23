import {talentStore} from '../TalentStore';

describe('TalentStore keyword routing', () => {
  beforeEach(() => {
    talentStore.talentSettings = {};
    talentStore.customTalents = [];
  });

  afterEach(() => {
    talentStore.talentSettings = {};
    talentStore.customTalents = [];
  });

  it('matches workspace authoring requests without exposing delete', () => {
    const matches = talentStore.getKeywordMatchedTalentNames(
      'Make a .md in cwd with basic python syntax quick reference information',
    );

    expect(matches).toEqual(
      expect.arrayContaining(['workspace_write', 'workspace_shell']),
    );
    expect(matches).not.toContain('workspace_delete');
  });

  it('routes empty folder cleanup to the dedicated prune tool', () => {
    const matches = talentStore.getKeywordMatchedTalentNames(
      'Remove all empty subdirectories, ls them first to find them',
    );

    expect(matches).toContain('workspace_list');
    expect(matches).toContain('workspace_prune_empty_dirs');
  });

  it('matches upcoming calendar reads without exposing calendar writes', () => {
    const matches = talentStore.getKeywordMatchedTalentNames(
      "What's coming next on my calendar?",
    );

    expect(matches).toContain('calendar_find_events');
    expect(matches).not.toContain('calendar_create_event');
  });

  it('routes class schedule requests to calendar instead of web search', () => {
    const matches = talentStore.getKeywordMatchedTalentNames(
      'Can you check my class schedule in a month?',
    );

    expect(matches).toContain('calendar_find_events');
    expect(matches).not.toContain('web_search');
  });

  it('routes plural email requests to mailbox search', () => {
    const matches = talentStore.getKeywordMatchedTalentNames(
      'Can you read my emails from this morning?',
    );

    expect(matches).toContain('mail_search');
  });

  it('routes reminder creation and deletion to the right reminder tools', () => {
    expect(
      talentStore.getKeywordMatchedTalentNames(
        'Remind me to submit the assignment tomorrow at 8',
      ),
    ).toContain('reminder_create');
    expect(
      talentStore.getKeywordMatchedTalentNames(
        'Remove the assignment reminder',
      ),
    ).toContain('reminder_delete');
  });

  it('routes clock creation without also exposing clock listing', () => {
    const timerMatches = talentStore.getKeywordMatchedTalentNames(
      'Set a timer for five minutes',
    );
    const alarmMatches = talentStore.getKeywordMatchedTalentNames(
      'Set an alarm for tomorrow at 7',
    );

    expect(timerMatches).toContain('clock_create_timer');
    expect(timerMatches).not.toContain('clock_list');
    expect(alarmMatches).toContain('clock_create_alarm');
    expect(alarmMatches).not.toContain('clock_list');
  });

  it('does not match alphanumeric keywords inside unrelated words', () => {
    expect(
      talentStore.getKeywordMatchedTalentNames('This prevents crashes.'),
    ).not.toContain('calendar_find_events');
  });

  it('respects disabled talents during keyword routing', () => {
    talentStore.setTalentEnabled('workspace_write', false);

    const matches = talentStore.getKeywordMatchedTalentNames(
      'Create a file named notes.md in cwd',
    );

    expect(matches).not.toContain('workspace_write');
    expect(matches).toContain('workspace_shell');
  });

  it('routes custom talents by explicit keywords even when not agent default', () => {
    const talent = talentStore.addCustomTalent({
      title: 'Citation Builder',
      description: 'Create citation packs from source notes.',
      instructions: 'Return MLA and APA citation drafts for the supplied text.',
      keywords: ['citation pack', 'source citation'],
      source: 'custom',
    });
    talentStore.setTalentAgentDefault(talent.name, false);

    const matches = talentStore.getKeywordMatchedTalentNames(
      'Make a citation pack for this article.',
    );
    const schemas = talentStore.deriveCustomToolSchemas([talent.name]);

    expect(talentStore.getDefaultAgentTalentNames()).not.toContain(talent.name);
    expect(matches).toContain(talent.name);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].function.name).toBe(talent.name);
    expect(schemas[0].function.description).toContain('MLA and APA');
  });

  it('adds fallback route keywords for custom talents without keywords', () => {
    const talent = talentStore.addCustomTalent({
      title: 'Citation Builder',
      instructions: 'Return citation drafts for the supplied text.',
      source: 'agent',
    });

    expect(talent.keywords).toEqual(
      expect.arrayContaining([
        'Citation Builder',
        'citation builder',
        'citation_builder',
      ]),
    );
    expect(
      talentStore.getKeywordMatchedTalentNames('Use citation builder here.'),
    ).toContain(talent.name);
  });
});
