import {
  normalizeBraveSearchCountry,
  talentStore,
  type SearchProviderId,
} from '../../store/TalentStore';
import {TalentEngine, TalentResult, ToolDefinition} from './types';
import {
  getSearchProviderApiKey,
  normalizeTalentSecret,
} from './talentSecrets';

const BRAVE_WEB_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const SEARXNG_DEFAULT_PATH = '/search';

type SearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

function clampCount(value: unknown, fallback = 5): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(1, Math.min(10, Math.floor(n)));
}

function cleanShortString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function appendOptionalParam(
  params: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (typeof value === 'string' && value.trim()) {
    params.set(key, value.trim());
  }
}

function resultToSummaryLine(result: SearchResult, index: number): string {
  const title = cleanShortString(result.title, 'Untitled result');
  const url = cleanShortString(result.url, 'No URL returned');
  const description = cleanShortString(result.description, '');
  const age = cleanShortString(result.age, '');
  return `${index + 1}. ${title}\nURL: ${url}${
    age ? `\nAge: ${age}` : ''
  }${description ? `\nSnippet: ${description}` : ''}`;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return body ? `: ${body.slice(0, 240)}` : '';
}

function normalizeBraveResults(data: any): SearchResult[] {
  const results = Array.isArray(data?.web?.results) ? data.web.results : [];
  return results.map((result: any) => {
    const snippets = Array.isArray(result.extra_snippets)
      ? result.extra_snippets.filter((s: unknown) => typeof s === 'string')
      : [];
    return {
      title: result.title,
      url: result.url,
      age: result.page_age ?? result.age,
      description: [result.description, ...snippets.slice(0, 2)]
        .filter(Boolean)
        .join(' '),
    };
  });
}

function normalizeTavilyResults(data: any): SearchResult[] {
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((result: any) => ({
    title: result.title,
    url: result.url,
    description: result.content ?? result.snippet,
  }));
}

function normalizeSerperResults(data: any): SearchResult[] {
  const results = Array.isArray(data?.organic) ? data.organic : [];
  return results.map((result: any) => ({
    title: result.title,
    url: result.link,
    description: result.snippet,
  }));
}

function normalizeExaResults(data: any): SearchResult[] {
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((result: any) => ({
    title: result.title,
    url: result.url,
    description:
      result.text ??
      result.summary ??
      (Array.isArray(result.highlights) ? result.highlights.join(' ') : ''),
  }));
}

function normalizeSearXngResults(data: any): SearchResult[] {
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((result: any) => ({
    title: result.title,
    url: result.url,
    description:
      result.content ??
      result.description ??
      (Array.isArray(result.engines) ? `Engines: ${result.engines.join(', ')}` : ''),
  }));
}

function normalizeMcpResult(data: any): SearchResult[] {
  const result = data?.result ?? data;
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .map((item: any) => item?.text ?? item?.content ?? textFromUnknown(item))
    .filter(Boolean)
    .join('\n');
  if (!text && result) {
    return [{title: 'MCP search result', description: textFromUnknown(result)}];
  }
  return text ? [{title: 'MCP search result', description: text}] : [];
}

function normalizeEndpoint(endpoint?: string): string {
  const trimmed = cleanShortString(endpoint, '');
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\/+$/, '');
}

function searxngTimeRangeFromFreshness(
  freshness: string | undefined,
  configured?: string,
): string {
  if (configured === 'day' || configured === 'month' || configured === 'year') {
    return configured;
  }
  switch (freshness) {
    case 'pd':
      return 'day';
    case 'pm':
      return 'month';
    case 'py':
      return 'year';
    default:
      return '';
  }
}

export class WebSearchEngine implements TalentEngine {
  readonly name = 'web_search';
  readonly manifest = {
    name: 'web_search',
    title: 'Web search',
    description: 'Search the live web through the configured provider.',
    source: 'builtin' as const,
    category: 'search' as const,
    configurable: true,
    keywords: ['web', 'internet', 'search', 'latest', 'recent', 'weather'],
    agentDefaultEnabled: true,
  };

  constructor(
    private readonly apiKeyProvider: (
      provider: SearchProviderId,
    ) => Promise<string> = getSearchProviderApiKey,
  ) {}

  private async requestBrave(args: {
    query: string;
    count: number;
    apiKey: string;
    country: string;
    searchLang: string;
    freshness?: string;
    noCache: boolean;
  }): Promise<SearchResult[] | TalentResult> {
    const country = normalizeBraveSearchCountry(args.country);
    const params = new URLSearchParams({
      q: args.query,
      count: String(args.count),
      search_lang: args.searchLang,
      extra_snippets: 'true',
    });
    appendOptionalParam(params, 'country', country);
    appendOptionalParam(params, 'freshness', args.freshness);

    const response = await fetch(`${BRAVE_WEB_SEARCH_URL}?${params}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': args.noCache ? 'no-cache' : 'max-age=300',
        'X-Subscription-Token': args.apiKey,
      },
    });
    if (!response.ok) {
      const detail = await readError(response);
      return {
        type: 'error',
        summary: `web_search: Brave request failed with HTTP ${response.status}`,
        errorMessage: `HTTP ${response.status}${detail}`,
      };
    }
    return normalizeBraveResults(await response.json());
  }

  private async requestTavily(args: {
    query: string;
    count: number;
    apiKey: string;
  }): Promise<SearchResult[] | TalentResult> {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        api_key: args.apiKey,
        query: args.query,
        max_results: args.count,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (!response.ok) {
      const detail = await readError(response);
      return {
        type: 'error',
        summary: `web_search: Tavily request failed with HTTP ${response.status}`,
        errorMessage: `HTTP ${response.status}${detail}`,
      };
    }
    return normalizeTavilyResults(await response.json());
  }

  private async requestSerper(args: {
    query: string;
    count: number;
    apiKey: string;
    country: string;
    searchLang: string;
  }): Promise<SearchResult[] | TalentResult> {
    const response = await fetch(SERPER_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': args.apiKey,
      },
      body: JSON.stringify({
        q: args.query,
        num: args.count,
        gl: args.country.toLowerCase(),
        hl: args.searchLang,
      }),
    });
    if (!response.ok) {
      const detail = await readError(response);
      return {
        type: 'error',
        summary: `web_search: Serper request failed with HTTP ${response.status}`,
        errorMessage: `HTTP ${response.status}${detail}`,
      };
    }
    return normalizeSerperResults(await response.json());
  }

  private async requestExa(args: {
    query: string;
    count: number;
    apiKey: string;
  }): Promise<SearchResult[] | TalentResult> {
    const response = await fetch(EXA_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': args.apiKey,
      },
      body: JSON.stringify({
        query: args.query,
        numResults: args.count,
        type: 'auto',
        contents: {text: {maxCharacters: 360}},
      }),
    });
    if (!response.ok) {
      const detail = await readError(response);
      return {
        type: 'error',
        summary: `web_search: Exa request failed with HTTP ${response.status}`,
        errorMessage: `HTTP ${response.status}${detail}`,
      };
    }
    return normalizeExaResults(await response.json());
  }

  private async requestMcp(args: {
    query: string;
    count: number;
    apiKey: string;
    endpoint?: string;
    toolName?: string;
    freshness?: string;
    country: string;
    searchLang: string;
  }): Promise<SearchResult[] | TalentResult> {
    const endpoint = cleanShortString(args.endpoint, '');
    if (!endpoint) {
      return {
        type: 'error',
        summary: 'web_search: MCP HTTP endpoint is not configured',
        errorMessage: 'Open Talents > Web search and set an MCP HTTP endpoint.',
      };
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.apiKey ? {Authorization: `Bearer ${args.apiKey}`} : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: args.toolName || 'web_search',
          arguments: {
            query: args.query,
            count: args.count,
            freshness: args.freshness,
            country: args.country,
            search_lang: args.searchLang,
          },
        },
      }),
    });
    if (!response.ok) {
      const detail = await readError(response);
      return {
        type: 'error',
        summary: `web_search: MCP HTTP request failed with HTTP ${response.status}`,
        errorMessage: `HTTP ${response.status}${detail}`,
      };
    }
    return normalizeMcpResult(await response.json());
  }

  private async requestSearxng(args: {
    query: string;
    count: number;
    apiKey: string;
    endpoint?: string;
    categories?: string;
    engines?: string;
    safesearch?: string;
    timeRange?: string;
    freshness?: string;
    searchLang: string;
  }): Promise<SearchResult[] | TalentResult> {
    const endpoint = normalizeEndpoint(args.endpoint);
    if (!endpoint) {
      return {
        type: 'error',
        summary: 'web_search: SearXNG endpoint is not configured',
        errorMessage:
          'Open Talents > Web search, choose SearXNG, and set your SearXNG base URL.',
      };
    }

    const params = new URLSearchParams({
      q: args.query,
      format: 'json',
      language: cleanShortString(args.searchLang, 'en'),
      pageno: '1',
    });
    appendOptionalParam(params, 'categories', args.categories);
    appendOptionalParam(params, 'engines', args.engines);
    appendOptionalParam(params, 'safesearch', args.safesearch);
    appendOptionalParam(
      params,
      'time_range',
      searxngTimeRangeFromFreshness(args.freshness, args.timeRange),
    );

    const response = await fetch(`${endpoint}${SEARXNG_DEFAULT_PATH}?${params}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(args.apiKey ? {Authorization: `Bearer ${args.apiKey}`} : {}),
      },
    });
    if (!response.ok) {
      const detail = await readError(response);
      return {
        type: 'error',
        summary: `web_search: SearXNG request failed with HTTP ${response.status}`,
        errorMessage: `HTTP ${response.status}${detail}`,
      };
    }
    return normalizeSearXngResults(await response.json()).slice(0, args.count);
  }

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return {
        type: 'error',
        summary: 'web_search: missing query',
        errorMessage: 'query argument is required and must be non-empty',
      };
    }

    const settings = talentStore.webSearchSettings;
    const provider = settings.provider;
    const apiKey = normalizeTalentSecret(await this.apiKeyProvider(provider));
    if (!apiKey && provider !== 'mcp_http' && provider !== 'searxng') {
      const providerLabel =
        provider === 'brave' ? 'Brave Search' : provider.toUpperCase();
      return {
        type: 'error',
        summary: `web_search: ${providerLabel} API key is not configured`,
        errorMessage:
          'Open Talents > Web search and save an API key for the selected provider.',
      };
    }

    const count = clampCount(args.count, settings.count);
    const country = cleanShortString(args.country, settings.country).toUpperCase();
    const searchLang = cleanShortString(args.search_lang, settings.search_lang);
    const freshness =
      typeof args.freshness === 'string' ? args.freshness : settings.freshness;
    const noCache = args.no_cache ?? settings.no_cache;

    try {
      const commonArgs = {query, count, apiKey, country, searchLang, freshness};
      const resultsOrError =
        provider === 'brave'
          ? await this.requestBrave({...commonArgs, noCache})
          : provider === 'tavily'
            ? await this.requestTavily(commonArgs)
            : provider === 'serper'
              ? await this.requestSerper(commonArgs)
              : provider === 'exa'
                ? await this.requestExa(commonArgs)
                : provider === 'searxng'
                  ? await this.requestSearxng({
                      ...commonArgs,
                      endpoint: settings.endpoint,
                      categories: settings.categories,
                      engines: settings.engines,
                      safesearch: settings.safesearch,
                      timeRange: settings.time_range,
                    })
                  : await this.requestMcp({
                      ...commonArgs,
                      endpoint: settings.endpoint,
                      toolName: settings.mcpToolName,
                    });

      if (!Array.isArray(resultsOrError)) {
        return resultsOrError;
      }
      if (resultsOrError.length === 0) {
        return {
          type: 'text',
          summary: `web_search: no results returned from ${provider} for "${query}"`,
        };
      }

      const lines = resultsOrError.slice(0, count).map(resultToSummaryLine);
      return {
        type: 'text',
        summary: `web_search (${provider}) results for "${query}":\n${lines.join(
          '\n\n',
        )}`,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: 'web_search: request failed',
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the live web for current facts, weather, forecasts, recent news, releases, prices, or other time-sensitive information. Uses the provider configured in LLMm Talents.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Specific search query. Include location/timeframe when relevant, e.g. "Toronto weather forecast next 3 days" or "latest AI news today".',
            },
            count: {
              type: 'number',
              description: 'Number of results to return, 1-10.',
            },
            freshness: {
              type: 'string',
              description:
                'Optional freshness filter when supported, e.g. pd for past day, pw for past week, pm for past month, py for past year.',
            },
            country: {
              type: 'string',
              description:
                'Two-letter country code for result region. Uses Talents default when omitted.',
            },
            search_lang: {
              type: 'string',
              description:
                'Search language code. Uses Talents default when omitted.',
            },
            no_cache: {
              type: 'boolean',
              description:
                'Set true for current/recent requests. Uses Talents default when omitted.',
            },
          },
          required: ['query'],
        },
      },
    };
  }
}
