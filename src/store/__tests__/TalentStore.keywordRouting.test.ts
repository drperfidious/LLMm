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

  it('matches upcoming calendar reads without exposing calendar writes', () => {
    const matches = talentStore.getKeywordMatchedTalentNames(
      "What's coming next on my calendar?",
    );

    expect(matches).toContain('calendar_find_events');
    expect(matches).not.toContain('calendar_create_event');
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
