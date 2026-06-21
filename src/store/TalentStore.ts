import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type {TalentManifest, ToolDefinition} from '../services/talents/types';
import {CustomInstructionTalentEngine} from '../services/talents/CustomInstructionTalentEngine';
import {keywordMatchesText} from '../services/talents/keywordMatching';

export type SearchProviderId =
  | 'brave'
  | 'tavily'
  | 'serper'
  | 'exa'
  | 'searxng'
  | 'mcp_http';

export type WebSearchSettings = {
  provider: SearchProviderId;
  count: number;
  country: string;
  search_lang: string;
  freshness?: string;
  no_cache: boolean;
  endpoint?: string;
  mcpToolName?: string;
  categories?: string;
  engines?: string;
  safesearch?: '0' | '1' | '2';
  time_range?: 'day' | 'month' | 'year' | '';
};

export type MailBridgeSettings = {
  provider: MailProviderId;
  endpoint: string;
  accountEmail: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurityMode;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurityMode;
  inboxFolder: string;
  sentFolder: string;
  defaultLimit: number;
};

export type MailProviderId = 'gmail' | 'imap_smtp' | 'custom_bridge';

export type MailSecurityMode = 'ssl' | 'starttls' | 'none';

export type TalentRuntimeSettings = {
  enabled?: boolean;
  agentDefault?: boolean;
  keywords?: string[];
};

export type CustomTalentDefinition = TalentManifest & {
  source: 'custom' | 'agent' | 'installed';
  instructions: string;
  createdAt: string;
  updatedAt: string;
};

export const SEARCH_PROVIDER_LABELS: Record<SearchProviderId, string> = {
  brave: 'Brave',
  tavily: 'Tavily',
  serper: 'Serper',
  exa: 'Exa',
  searxng: 'SearXNG',
  mcp_http: 'MCP HTTP',
};

export const MAIL_PROVIDER_LABELS: Record<MailProviderId, string> = {
  gmail: 'Gmail',
  imap_smtp: 'IMAP/SMTP',
  custom_bridge: 'Bridge',
};

export const BRAVE_SEARCH_COUNTRIES = [
  'AR',
  'AU',
  'AT',
  'BE',
  'BR',
  'CA',
  'CL',
  'DK',
  'FI',
  'FR',
  'DE',
  'GR',
  'HK',
  'IN',
  'ID',
  'IT',
  'JP',
  'KR',
  'MY',
  'MX',
  'NL',
  'NZ',
  'NO',
  'CN',
  'PL',
  'PT',
  'PH',
  'RU',
  'SA',
  'ZA',
  'ES',
  'SE',
  'CH',
  'TW',
  'TR',
  'GB',
  'US',
  'ALL',
] as const;

const BRAVE_SEARCH_COUNTRY_SET: ReadonlySet<string> = new Set(
  BRAVE_SEARCH_COUNTRIES,
);

const BRAVE_SEARCH_COUNTRY_ALIASES: Record<string, string> = {
  GLOBAL: 'ALL',
  WORLD: 'ALL',
  WORLDWIDE: 'ALL',
  UK: 'GB',
  UNITEDKINGDOM: 'GB',
  GREATBRITAIN: 'GB',
  USA: 'US',
  UNITEDSTATES: 'US',
  UNITEDSTATESOFAMERICA: 'US',
};

export function normalizeWebSearchCountryInput(
  value: unknown,
  fallback = '',
): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim().toUpperCase();
}

export function normalizeBraveSearchCountry(value: unknown): string {
  const normalized = normalizeWebSearchCountryInput(value);
  if (!normalized) {
    return '';
  }

  if (BRAVE_SEARCH_COUNTRY_SET.has(normalized)) {
    return normalized;
  }

  const compact = normalized.replace(/[^A-Z]/g, '');
  const candidate =
    BRAVE_SEARCH_COUNTRY_ALIASES[normalized] ??
    BRAVE_SEARCH_COUNTRY_ALIASES[compact] ??
    compact;
  return BRAVE_SEARCH_COUNTRY_SET.has(candidate) ? candidate : '';
}

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  provider: 'brave',
  count: 5,
  country: 'US',
  search_lang: 'en',
  no_cache: true,
  mcpToolName: 'web_search',
  categories: 'general',
  safesearch: '1',
  time_range: '',
};

export const DEFAULT_MAIL_BRIDGE_SETTINGS: MailBridgeSettings = {
  provider: 'gmail',
  endpoint: '',
  accountEmail: '',
  username: '',
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapSecurity: 'ssl',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecurity: 'ssl',
  inboxFolder: 'INBOX',
  sentFolder: '[Gmail]/Sent Mail',
  defaultLimit: 5,
};

export const BUILTIN_TALENT_DEFAULTS: Record<string, TalentManifest> = {
  calculate: {
    name: 'calculate',
    title: 'Math expressions',
    description: 'Evaluate mathematical expressions.',
    category: 'utility',
    source: 'builtin',
    agentDefaultEnabled: true,
    keywords: [
      'calculate',
      'compute',
      'evaluate',
      'solve',
      'arithmetic',
      'equation',
    ],
  },
  datetime: {
    name: 'datetime',
    title: 'Date & time',
    description: 'Read the current date, time, and timezone.',
    category: 'utility',
    source: 'builtin',
    agentDefaultEnabled: true,
    keywords: ['date', 'time', 'today', 'tomorrow', 'timezone', 'utc'],
  },
  web_search: {
    name: 'web_search',
    title: 'Web search',
    description: 'Search the live web through the configured provider.',
    category: 'search',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: true,
    keywords: [
      'web',
      'internet',
      'search',
      'look up',
      'browse',
      'current',
      'latest',
      'recent',
      'news',
      'weather',
      'forecast',
      'price',
      'score',
      'schedule',
    ],
  },
  deep_research: {
    name: 'deep_research',
    title: 'Deep research',
    description: 'Run multiple searches and assemble a source packet.',
    category: 'search',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: true,
    keywords: [
      'deep research',
      'research',
      'sources',
      'verify',
      'fact check',
      'compare sources',
      'recent report',
    ],
  },
  render_html: {
    name: 'render_html',
    title: 'HTML preview',
    description: 'Render generated HTML inline in chat.',
    category: 'visual',
    source: 'builtin',
    agentDefaultEnabled: false,
    keywords: ['render html', 'preview html', 'webpage', 'website', 'ui'],
  },
  sms_draft: {
    name: 'sms_draft',
    title: 'Text draft',
    description: 'Open Messages with recipients and body prefilled.',
    category: 'communication',
    source: 'builtin',
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: ['text', 'sms', 'message', 'reply'],
  },
  mail_draft: {
    name: 'mail_draft',
    title: 'Email draft',
    description: 'Open Mail with recipients, subject, and body prefilled.',
    category: 'communication',
    source: 'builtin',
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: ['email', 'mail', 'draft', 'reply'],
  },
  mail_search: {
    name: 'mail_search',
    title: 'Search mailbox',
    description: 'Search email through the configured mail bridge.',
    category: 'communication',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: false,
    keywords: ['email', 'mail', 'inbox', 'search mail', 'find email'],
  },
  mail_read: {
    name: 'mail_read',
    title: 'Read email',
    description: 'Read a specific email through the configured mail bridge.',
    category: 'communication',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: false,
    keywords: ['read email', 'open email', 'mail message', 'inbox'],
  },
  mail_send: {
    name: 'mail_send',
    title: 'Send email',
    description:
      'Send email through the configured mail bridge after confirmation.',
    category: 'communication',
    source: 'builtin',
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: ['send email', 'reply email', 'mail someone', 'email'],
  },
  calendar_find_events: {
    name: 'calendar_find_events',
    title: 'Find calendar events',
    description: 'Search Apple Calendar events on-device.',
    category: 'utility',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: false,
    keywords: [
      'calendar',
      'schedule',
      'event',
      'events',
      'meeting',
      'appointment',
      'appointments',
      "what's next",
      'whats next',
      'coming next',
      'upcoming',
      'agenda',
    ],
  },
  calendar_create_event: {
    name: 'calendar_create_event',
    title: 'Create calendar event',
    description: 'Create Apple Calendar events after explicit confirmation.',
    category: 'utility',
    source: 'builtin',
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: [
      'add event',
      'create event',
      'add to calendar',
      'create calendar event',
      'schedule meeting',
      'schedule appointment',
    ],
  },
  reminder_find: {
    name: 'reminder_find',
    title: 'Find reminders',
    description: 'Search Apple Reminders on-device.',
    category: 'utility',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: false,
    keywords: ['reminder', 'reminders', 'todo', 'task', 'due'],
  },
  reminder_create: {
    name: 'reminder_create',
    title: 'Create reminder',
    description: 'Create Apple Reminders after explicit confirmation.',
    category: 'utility',
    source: 'builtin',
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: ['add reminder', 'create reminder', 'remind me', 'todo'],
  },
  reminder_complete: {
    name: 'reminder_complete',
    title: 'Complete reminder',
    description: 'Mark Apple Reminders complete after explicit confirmation.',
    category: 'utility',
    source: 'builtin',
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: ['complete reminder', 'finish reminder', 'done reminder'],
  },
  create_talent: {
    name: 'create_talent',
    title: 'Talent maker',
    description: 'Create or update custom instruction talents.',
    category: 'management',
    source: 'builtin',
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: ['create talent', 'make talent', 'add tool', 'new talent'],
  },
  workspace_list: {
    name: 'workspace_list',
    title: 'List workspace files',
    description: 'List files in the app-contained LLMm workspace.',
    category: 'management',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: false,
    keywords: [
      'list files',
      'ls',
      'workspace',
      'documents',
      'directory',
      'cwd',
      'current directory',
    ],
  },
  workspace_read: {
    name: 'workspace_read',
    title: 'Read workspace file',
    description: 'Read text files from the app-contained LLMm workspace.',
    category: 'management',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: false,
    keywords: [
      'read file',
      'cat',
      'workspace',
      'documents',
      'open file',
      'cwd',
      'current directory',
    ],
  },
  workspace_write: {
    name: 'workspace_write',
    title: 'Write workspace file',
    description: 'Create or update text files in the app-contained workspace.',
    category: 'management',
    source: 'builtin',
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: [
      'write file',
      'create file',
      'make file',
      'make a file',
      'append file',
      'save document',
      'create document',
      'make document',
      'write document',
      'markdown',
      '.md',
      'md file',
      'cwd',
      'current directory',
    ],
  },
  workspace_delete: {
    name: 'workspace_delete',
    title: 'Delete workspace file',
    description: 'Delete workspace files after explicit confirmation.',
    category: 'management',
    source: 'builtin',
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: ['delete file', 'remove file', 'remove document', 'rm'],
  },
  workspace_search: {
    name: 'workspace_search',
    title: 'Search workspace files',
    description: 'Search text files in the app-contained workspace.',
    category: 'management',
    source: 'builtin',
    configurable: true,
    agentDefaultEnabled: false,
    keywords: ['search files', 'grep', 'find text', 'workspace', 'documents'],
  },
  workspace_shell: {
    name: 'workspace_shell',
    title: 'Workspace shell',
    description:
      'Run shell-like file commands inside the app-contained LLMm workspace.',
    category: 'management',
    source: 'builtin',
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: [
      'shell',
      'terminal',
      'workspace',
      'files',
      'documents',
      'cwd',
      'current directory',
      '.md',
      'markdown',
      'make file',
      'create file',
      'save document',
      'read file',
      'write file',
      'grep',
    ],
  },
};

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeTalentName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function deriveFallbackTalentKeywords({
  name,
  title,
}: {
  name: string;
  title: string;
}): string[] {
  return uniqueStrings([title, name.replace(/_/g, ' '), name]);
}

function normalizeCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : 5;
}

function normalizeMailLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(25, Math.floor(n))) : 5;
}

function normalizeMailPort(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n)
    ? Math.max(1, Math.min(65535, Math.floor(n)))
    : fallback;
}

function normalizeMailProvider(value: unknown): MailProviderId {
  return value === 'gmail' || value === 'imap_smtp' || value === 'custom_bridge'
    ? value
    : DEFAULT_MAIL_BRIDGE_SETTINGS.provider;
}

function normalizeMailSecurity(
  value: unknown,
  fallback: MailSecurityMode,
): MailSecurityMode {
  return value === 'ssl' || value === 'starttls' || value === 'none'
    ? value
    : fallback;
}

function mailProviderDefaults(provider: MailProviderId): MailBridgeSettings {
  if (provider === 'custom_bridge') {
    return {
      ...DEFAULT_MAIL_BRIDGE_SETTINGS,
      provider,
      imapHost: '',
      imapPort: 993,
      smtpHost: '',
      smtpPort: 465,
      sentFolder: 'Sent',
    };
  }

  if (provider === 'imap_smtp') {
    return {
      ...DEFAULT_MAIL_BRIDGE_SETTINGS,
      provider,
      imapHost: '',
      imapPort: 993,
      smtpHost: '',
      smtpPort: 465,
      sentFolder: 'Sent',
    };
  }

  return {
    ...DEFAULT_MAIL_BRIDGE_SETTINGS,
    provider,
  };
}

function normalizeMailBridgeSettings(
  settings?: Partial<MailBridgeSettings>,
): MailBridgeSettings {
  const provider = normalizeMailProvider(settings?.provider);
  const defaults = mailProviderDefaults(provider);
  return {
    ...defaults,
    provider,
    endpoint:
      typeof settings?.endpoint === 'string' ? settings.endpoint.trim() : '',
    accountEmail:
      typeof settings?.accountEmail === 'string'
        ? settings.accountEmail.trim()
        : '',
    username:
      typeof settings?.username === 'string' ? settings.username.trim() : '',
    imapHost:
      typeof settings?.imapHost === 'string'
        ? settings.imapHost.trim()
        : defaults.imapHost,
    imapPort: normalizeMailPort(settings?.imapPort, defaults.imapPort),
    imapSecurity: normalizeMailSecurity(
      settings?.imapSecurity,
      defaults.imapSecurity,
    ),
    smtpHost:
      typeof settings?.smtpHost === 'string'
        ? settings.smtpHost.trim()
        : defaults.smtpHost,
    smtpPort: normalizeMailPort(settings?.smtpPort, defaults.smtpPort),
    smtpSecurity: normalizeMailSecurity(
      settings?.smtpSecurity,
      defaults.smtpSecurity,
    ),
    inboxFolder:
      typeof settings?.inboxFolder === 'string' && settings.inboxFolder.trim()
        ? settings.inboxFolder.trim()
        : defaults.inboxFolder,
    sentFolder:
      typeof settings?.sentFolder === 'string' && settings.sentFolder.trim()
        ? settings.sentFolder.trim()
        : defaults.sentFolder,
    defaultLimit: normalizeMailLimit(
      settings?.defaultLimit ?? defaults.defaultLimit,
    ),
  };
}

function normalizeWebSearchSettings(
  settings?: Partial<WebSearchSettings>,
): WebSearchSettings {
  const provider = settings?.provider ?? DEFAULT_WEB_SEARCH_SETTINGS.provider;
  const validProvider: SearchProviderId = Object.prototype.hasOwnProperty.call(
    SEARCH_PROVIDER_LABELS,
    provider,
  )
    ? provider
    : 'brave';
  const endpoint =
    typeof settings?.endpoint === 'string' ? settings.endpoint.trim() : '';
  const safesearch =
    typeof settings?.safesearch === 'string'
      ? settings.safesearch.trim()
      : settings?.safesearch;
  const timeRange =
    typeof settings?.time_range === 'string'
      ? settings.time_range.trim()
      : settings?.time_range;
  return {
    ...DEFAULT_WEB_SEARCH_SETTINGS,
    ...settings,
    provider: validProvider,
    endpoint,
    count: normalizeCount(settings?.count ?? DEFAULT_WEB_SEARCH_SETTINGS.count),
    country: normalizeWebSearchCountryInput(
      settings?.country,
      DEFAULT_WEB_SEARCH_SETTINGS.country,
    ),
    search_lang:
      typeof settings?.search_lang === 'string' && settings.search_lang.trim()
        ? settings.search_lang.trim()
        : DEFAULT_WEB_SEARCH_SETTINGS.search_lang,
    no_cache: settings?.no_cache ?? DEFAULT_WEB_SEARCH_SETTINGS.no_cache,
    mcpToolName:
      typeof settings?.mcpToolName === 'string' && settings.mcpToolName.trim()
        ? settings.mcpToolName.trim()
        : DEFAULT_WEB_SEARCH_SETTINGS.mcpToolName,
    categories:
      typeof settings?.categories === 'string'
        ? settings.categories.trim()
        : DEFAULT_WEB_SEARCH_SETTINGS.categories,
    engines:
      typeof settings?.engines === 'string' ? settings.engines.trim() : '',
    safesearch:
      safesearch === '0' || safesearch === '1' || safesearch === '2'
        ? safesearch
        : DEFAULT_WEB_SEARCH_SETTINGS.safesearch,
    time_range:
      timeRange === 'day' || timeRange === 'month' || timeRange === 'year'
        ? timeRange
        : '',
  };
}

class TalentStore {
  talentSettings: Record<string, TalentRuntimeSettings> = {};
  customTalents: CustomTalentDefinition[] = [];
  webSearchSettings: WebSearchSettings = DEFAULT_WEB_SEARCH_SETTINGS;
  mailBridgeSettings: MailBridgeSettings = DEFAULT_MAIL_BRIDGE_SETTINGS;

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'TalentStore',
      properties: [
        'talentSettings',
        'customTalents',
        'webSearchSettings',
        'mailBridgeSettings',
      ],
      storage: AsyncStorage,
    }).then(() => {
      runInAction(() => {
        this.webSearchSettings = normalizeWebSearchSettings(
          this.webSearchSettings,
        );
        this.mailBridgeSettings = normalizeMailBridgeSettings(
          this.mailBridgeSettings,
        );
        this.customTalents = this.customTalents
          .map(talent => this.normalizeCustomTalent(talent))
          .filter((talent): talent is CustomTalentDefinition => !!talent);
      });
    });
  }

  private normalizeCustomTalent(
    talent: Partial<CustomTalentDefinition>,
  ): CustomTalentDefinition | undefined {
    const name = normalizeTalentName(talent.name ?? talent.title ?? '');
    const title =
      typeof talent.title === 'string' && talent.title.trim()
        ? talent.title.trim()
        : name;
    const description =
      typeof talent.description === 'string' && talent.description.trim()
        ? talent.description.trim()
        : `Custom talent: ${title}`;
    const instructions =
      typeof talent.instructions === 'string' ? talent.instructions.trim() : '';
    if (!name || !instructions) {
      return undefined;
    }
    const now = new Date().toISOString();
    const providedKeywords = uniqueStrings(talent.keywords ?? []);
    return {
      name,
      title,
      description,
      instructions,
      keywords: providedKeywords.length
        ? providedKeywords
        : deriveFallbackTalentKeywords({name, title}),
      source:
        talent.source === 'agent' || talent.source === 'installed'
          ? talent.source
          : 'custom',
      category: talent.category ?? 'utility',
      configurable: true,
      sideEffect: false,
      agentDefaultEnabled: talent.agentDefaultEnabled ?? true,
      createdAt: talent.createdAt ?? now,
      updatedAt: talent.updatedAt ?? now,
    };
  }

  getManifest(name: string): TalentManifest | undefined {
    return (
      BUILTIN_TALENT_DEFAULTS[name] ??
      this.customTalents.find(talent => talent.name === name)
    );
  }

  getBuiltInTalentNames(): string[] {
    return Object.keys(BUILTIN_TALENT_DEFAULTS);
  }

  getAllTalentNames(): string[] {
    return uniqueStrings([
      ...this.getBuiltInTalentNames(),
      ...this.customTalents.map(talent => talent.name),
    ]);
  }

  getSettings(name: string): Required<TalentRuntimeSettings> {
    const manifest = this.getManifest(name);
    const overrides = this.talentSettings[name] ?? {};
    const keywords =
      overrides.keywords === undefined
        ? uniqueStrings(manifest?.keywords ?? [])
        : uniqueStrings(overrides.keywords);
    return {
      enabled: overrides.enabled ?? true,
      agentDefault:
        overrides.agentDefault ?? manifest?.agentDefaultEnabled ?? false,
      keywords,
    };
  }

  isTalentEnabled(name: string): boolean {
    return this.getSettings(name).enabled;
  }

  isAgentDefault(name: string): boolean {
    const settings = this.getSettings(name);
    return settings.enabled && settings.agentDefault;
  }

  setTalentEnabled(name: string, enabled: boolean) {
    runInAction(() => {
      this.talentSettings = {
        ...this.talentSettings,
        [name]: {
          ...(this.talentSettings[name] ?? {}),
          enabled,
        },
      };
    });
  }

  setTalentAgentDefault(name: string, agentDefault: boolean) {
    runInAction(() => {
      this.talentSettings = {
        ...this.talentSettings,
        [name]: {
          ...(this.talentSettings[name] ?? {}),
          agentDefault,
        },
      };
    });
  }

  setTalentKeywords(name: string, keywords: string[]) {
    runInAction(() => {
      this.talentSettings = {
        ...this.talentSettings,
        [name]: {
          ...(this.talentSettings[name] ?? {}),
          keywords: uniqueStrings(keywords),
        },
      };
    });
  }

  updateWebSearchSettings(settings: Partial<WebSearchSettings>) {
    runInAction(() => {
      this.webSearchSettings = normalizeWebSearchSettings({
        ...this.webSearchSettings,
        ...settings,
      });
    });
  }

  resetWebSearchSettings() {
    runInAction(() => {
      this.webSearchSettings = DEFAULT_WEB_SEARCH_SETTINGS;
    });
  }

  updateMailBridgeSettings(settings: Partial<MailBridgeSettings>) {
    runInAction(() => {
      this.mailBridgeSettings = normalizeMailBridgeSettings({
        ...this.mailBridgeSettings,
        ...settings,
      });
    });
  }

  resetMailBridgeSettings() {
    runInAction(() => {
      this.mailBridgeSettings = DEFAULT_MAIL_BRIDGE_SETTINGS;
    });
  }

  addCustomTalent(
    talent: Partial<CustomTalentDefinition> & {
      title?: string;
      instructions: string;
    },
  ): CustomTalentDefinition {
    const normalized = this.normalizeCustomTalent({
      ...talent,
      source: talent.source ?? 'custom',
    });
    if (!normalized) {
      throw new Error(
        'Custom talent requires a valid name/title and instructions',
      );
    }

    runInAction(() => {
      const index = this.customTalents.findIndex(
        t => t.name === normalized.name,
      );
      if (index >= 0) {
        const existing = this.customTalents[index];
        this.customTalents.splice(index, 1, {
          ...normalized,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        });
      } else {
        this.customTalents.push(normalized);
      }
      this.talentSettings = {
        ...this.talentSettings,
        [normalized.name]: {
          ...(this.talentSettings[normalized.name] ?? {}),
          enabled: true,
          agentDefault: normalized.agentDefaultEnabled ?? true,
        },
      };
    });
    return normalized;
  }

  removeCustomTalent(name: string) {
    runInAction(() => {
      this.customTalents = this.customTalents.filter(
        talent => talent.name !== name,
      );
      const {[name]: _removed, ...remaining} = this.talentSettings;
      this.talentSettings = remaining;
    });
  }

  getCustomTalentEngine(
    name: string,
  ): CustomInstructionTalentEngine | undefined {
    const talent = this.customTalents.find(
      candidate => candidate.name === name,
    );
    return talent ? new CustomInstructionTalentEngine(talent) : undefined;
  }

  deriveCustomToolSchemas(talentNames?: string[]): ToolDefinition[] {
    const wanted = talentNames ? new Set(talentNames) : undefined;
    return this.customTalents
      .filter(talent => this.isTalentEnabled(talent.name))
      .filter(talent => !wanted || wanted.has(talent.name))
      .map(talent =>
        new CustomInstructionTalentEngine(talent).toToolDefinition(),
      );
  }

  getDefaultAgentTalentNames(): string[] {
    return this.getAllTalentNames().filter(name => this.isAgentDefault(name));
  }

  resolveAllowedAgentTalentNames(palTalentNames: string[] = []): string[] {
    return uniqueStrings([
      ...this.getDefaultAgentTalentNames(),
      ...palTalentNames.filter(name => this.isTalentEnabled(name)),
    ]);
  }

  getKeywordHintsForToolNames(talentNames: string[]): Record<string, string[]> {
    const hints: Record<string, string[]> = {};
    talentNames.forEach(name => {
      const keywords = this.getSettings(name).keywords;
      if (keywords.length > 0) {
        hints[name] = keywords;
      }
    });
    return hints;
  }

  getKeywordMatchedTalentNames(messageText: string): string[] {
    const lowerText = messageText.trim().toLowerCase();
    if (!lowerText) {
      return [];
    }

    return this.getAllTalentNames().filter(name => {
      const settings = this.getSettings(name);
      if (!settings.enabled) {
        return false;
      }
      return settings.keywords.some(keyword =>
        keywordMatchesText(lowerText, keyword),
      );
    });
  }
}

export const talentStore = new TalentStore();
