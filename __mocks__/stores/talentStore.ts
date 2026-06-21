import type {ToolDefinition} from '../../src/services/talents/types';

export const mockTalentStore = {
  getDefaultAgentTalentNames: jest.fn(() => [
    'calculate',
    'datetime',
    'web_search',
    'deep_research',
  ]),
  resolveAllowedAgentTalentNames: jest.fn((palTalentNames: string[] = []) =>
    Array.from(
      new Set([
        'calculate',
        'datetime',
        'web_search',
        'deep_research',
        ...palTalentNames,
      ]),
    ),
  ),
  deriveCustomToolSchemas: jest.fn((_talentNames?: string[]) => []),
  getCustomTalentEngine: jest.fn((_name: string) => undefined),
  getKeywordHintsForToolNames: jest.fn((talentNames: string[]) =>
    talentNames.reduce<Record<string, string[]>>((acc, name) => {
      acc[name] = [];
      return acc;
    }, {}),
  ),
  isTalentEnabled: jest.fn((_name: string) => true),
  getSettings: jest.fn((_name: string) => ({
    enabled: true,
    agentDefault: true,
    keywords: [],
  })),
  setTalentEnabled: jest.fn(),
  setTalentAgentDefault: jest.fn(),
  setTalentKeywords: jest.fn(),
  customTalents: [],
  talentSettings: {},
  webSearchSettings: {
    provider: 'brave',
    count: 5,
    country: 'US',
    search_lang: 'en',
    no_cache: true,
    categories: 'general',
    safesearch: '1',
    time_range: '',
  },
  mailBridgeSettings: {
    endpoint: '',
    accountEmail: '',
    inboxFolder: 'INBOX',
    sentFolder: 'Sent',
    defaultLimit: 5,
  },
  updateWebSearchSettings: jest.fn(),
  resetWebSearchSettings: jest.fn(),
  updateMailBridgeSettings: jest.fn(),
  resetMailBridgeSettings: jest.fn(),
  addCustomTalent: jest.fn(),
  removeCustomTalent: jest.fn(),
  getManifest: jest.fn(),
  getAllTalentNames: jest.fn(() => [
    'calculate',
    'datetime',
    'web_search',
    'deep_research',
    'mail_search',
    'mail_read',
    'mail_send',
    'workspace_list',
    'workspace_read',
    'workspace_write',
    'workspace_delete',
    'workspace_search',
    'workspace_shell',
    'calendar_find_events',
    'calendar_create_event',
    'reminder_find',
    'reminder_create',
    'reminder_complete',
  ]),
} satisfies Record<string, any>;

export const makeCustomTool = (name: string): ToolDefinition => ({
  type: 'function',
  function: {
    name,
    description: name,
    parameters: {type: 'object'},
  },
});
