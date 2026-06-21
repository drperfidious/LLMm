import {WebSearchEngine} from '../WebSearchEngine';
import {talentStore} from '../../../store/TalentStore';

const originalFetch = (global as any).fetch;

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  text?: jest.Mock;
}) {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(response.body ?? {}),
    text: jest.fn().mockResolvedValue(''),
    ...response,
  });
}

describe('WebSearchEngine', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
    talentStore.resetWebSearchSettings();
    jest.restoreAllMocks();
  });

  it('exposes name "web_search"', () => {
    expect(new WebSearchEngine(async () => 'test-key').name).toBe(
      'web_search',
    );
  });

  it('returns an error without a query', async () => {
    mockFetch({});
    const result = await new WebSearchEngine(async () => 'test-key').execute(
      {},
    );

    expect(result.type).toBe('error');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('returns an error when the Brave Search API key is not configured', async () => {
    mockFetch({});
    const result = await new WebSearchEngine(async () => '').execute({
      query: 'recent ai news',
    });

    expect(result.type).toBe('error');
    expect(result.summary).toContain('Brave Search API key');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('calls Brave Search and summarizes results with URLs', async () => {
    mockFetch({
      body: {
        web: {
          results: [
            {
              title: 'Forecast Example',
              url: 'https://example.com/weather',
              description: 'A three-day forecast.',
              page_age: '2 hours ago',
              extra_snippets: ['Rain tomorrow.', 'Clear later.'],
            },
          ],
        },
      },
    });

    const result = await new WebSearchEngine(async () => 'test-key').execute(
      {
        query: 'Toronto weather forecast next 3 days',
        count: 2,
        freshness: 'pd',
        country: 'ca',
      },
    );

    expect(result.type).toBe('text');
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global as any).fetch.mock.calls[0];
    expect(url).toContain('https://api.search.brave.com/res/v1/web/search?');
    expect(url).toContain('q=Toronto+weather+forecast+next+3+days');
    expect(url).toContain('count=2');
    expect(url).toContain('country=CA');
    expect(url).toContain('freshness=pd');
    expect(options.headers['X-Subscription-Token']).toBe('test-key');
    expect(result.summary).toContain('Forecast Example');
    expect(result.summary).toContain('https://example.com/weather');
    expect(result.summary).toContain('Rain tomorrow.');
  });

  it('uses the configured Brave country with uppercase normalization', async () => {
    talentStore.updateWebSearchSettings({country: ' ca '});
    mockFetch({
      body: {
        web: {
          results: [
            {
              title: 'Canadian Result',
              url: 'https://example.ca/search',
              description: 'Region-aware result.',
            },
          ],
        },
      },
    });

    const result = await new WebSearchEngine(async () => 'test-key').execute({
      query: 'Toronto events',
    });

    expect(result.type).toBe('text');
    const [url] = (global as any).fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('country')).toBe('CA');
  });

  it('omits invalid Brave country values instead of sending enum mismatches', async () => {
    talentStore.updateWebSearchSettings({country: 'zz'});
    mockFetch({body: {web: {results: []}}});

    const result = await new WebSearchEngine(async () => 'test-key').execute({
      query: 'regional news',
    });

    expect(result.type).toBe('text');
    const [url] = (global as any).fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.has('country')).toBe(false);
  });

  it('returns text when Brave returns no web results', async () => {
    mockFetch({body: {web: {results: []}}});

    const result = await new WebSearchEngine(async () => 'test-key').execute(
      {
        query: 'obscure search',
      },
    );

    expect(result.type).toBe('text');
    expect(result.summary).toContain('no results');
  });

  it('surfaces HTTP errors as talent errors', async () => {
    mockFetch({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('SUBSCRIPTION_TOKEN_INVALID'),
    });

    const result = await new WebSearchEngine(async () => 'test-key').execute(
      {
        query: 'recent ai news',
      },
    );

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('401');
      expect(result.errorMessage).toContain('SUBSCRIPTION_TOKEN_INVALID');
    }
  });

  it('uses the selected Tavily provider settings', async () => {
    talentStore.updateWebSearchSettings({provider: 'tavily', count: 3});
    mockFetch({
      body: {
        results: [
          {
            title: 'Tavily Result',
            url: 'https://example.com/tavily',
            content: 'Tavily snippet.',
          },
        ],
      },
    });

    const result = await new WebSearchEngine(async provider =>
      provider === 'tavily' ? 'tavily-key' : '',
    ).execute({query: 'ios llm news'});

    expect(result.type).toBe('text');
    const [url, options] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({
        api_key: 'tavily-key',
        query: 'ios llm news',
        max_results: 3,
      }),
    );
    expect(result.summary).toContain('Tavily Result');
  });

  it('uses a configured SearXNG endpoint without requiring an API key', async () => {
    talentStore.updateWebSearchSettings({
      provider: 'searxng',
      endpoint: 'https://search.example/',
      categories: 'general,news',
      engines: 'duckduckgo',
      safesearch: '0',
      time_range: 'day',
      count: 2,
    });
    mockFetch({
      body: {
        results: [
          {
            title: 'SearXNG Result',
            url: 'https://example.com/searxng',
            content: 'SearXNG snippet.',
            engines: ['duckduckgo'],
          },
        ],
      },
    });

    const result = await new WebSearchEngine(async () => '').execute({
      query: 'private metasearch',
      freshness: 'py',
    });

    expect(result.type).toBe('text');
    const [url, options] = (global as any).fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      'https://search.example/search',
    );
    expect(parsed.searchParams.get('q')).toBe('private metasearch');
    expect(parsed.searchParams.get('format')).toBe('json');
    expect(parsed.searchParams.get('categories')).toBe('general,news');
    expect(parsed.searchParams.get('engines')).toBe('duckduckgo');
    expect(parsed.searchParams.get('safesearch')).toBe('0');
    expect(parsed.searchParams.get('time_range')).toBe('day');
    expect(options.headers.Authorization).toBeUndefined();
    expect(result.summary).toContain('SearXNG Result');
    expect(result.summary).toContain('https://example.com/searxng');
  });

  it('returns a configuration error when SearXNG has no endpoint', async () => {
    talentStore.updateWebSearchSettings({
      provider: 'searxng',
      endpoint: '',
    });
    mockFetch({});

    const result = await new WebSearchEngine(async () => '').execute({
      query: 'private metasearch',
    });

    expect(result.type).toBe('error');
    expect(result.summary).toContain('SearXNG endpoint');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('surfaces network failures as talent errors', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const result = await new WebSearchEngine(async () => 'test-key').execute(
      {
        query: 'recent ai news',
      },
    );

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('offline');
    }
  });

  it('documents current-information use in its schema', () => {
    const def = new WebSearchEngine(async () => 'test-key').toToolDefinition();

    expect(def.function.name).toBe('web_search');
    expect(def.function.parameters.required).toEqual(['query']);
    expect(def.function.description).toMatch(/weather/i);
    expect(def.function.description).toMatch(/recent news|recent/i);
  });
});
