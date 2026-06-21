import {DeepResearchEngine} from '../DeepResearchEngine';
import type {TalentEngine, TalentResult} from '../types';

class FakeSearchEngine implements Pick<TalentEngine, 'execute'> {
  calls: Record<string, any>[] = [];

  async execute(args: Record<string, any>): Promise<TalentResult> {
    this.calls.push(args);
    if (args.query === 'bad query') {
      return {
        type: 'error',
        summary: 'web_search: failed',
        errorMessage: 'provider failed',
      };
    }
    return {
      type: 'text',
      summary:
        `web_search results for "${args.query}":\n` +
        `1. Result for ${args.query}\n` +
        `URL: https://example.com/${encodeURIComponent(args.query)}\n` +
        'Age: today\n' +
        `Snippet: Snippet for ${args.query}`,
    };
  }
}

describe('DeepResearchEngine', () => {
  it('returns an error without a question', async () => {
    const result = await new DeepResearchEngine(
      new FakeSearchEngine() as any,
    ).execute({});

    expect(result.type).toBe('error');
    expect(result.summary).toContain('missing question');
  });

  it('runs multiple searches and returns a deduplicated source packet', async () => {
    const fakeSearch = new FakeSearchEngine();
    const result = await new DeepResearchEngine(fakeSearch as any).execute({
      question: 'iOS local LLM benchmarks',
      queries: ['ios llm', 'mobile llm'],
      max_queries: 2,
      results_per_query: 2,
      country: 'CA',
    });

    expect(result.type).toBe('text');
    expect(fakeSearch.calls).toHaveLength(2);
    expect(fakeSearch.calls[0]).toEqual(
      expect.objectContaining({
        query: 'ios llm',
        count: 2,
        country: 'CA',
        no_cache: true,
      }),
    );
    expect(result.summary).toContain('deep_research packet');
    expect(result.summary).toContain('https://example.com/ios%20llm');
    expect(result.summary).toContain('https://example.com/mobile%20llm');
  });

  it('surfaces provider failures when no sources are found', async () => {
    const result = await new DeepResearchEngine(
      new FakeSearchEngine() as any,
    ).execute({
      question: 'broken',
      queries: ['bad query'],
    });

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('provider failed');
    }
  });

  it('exposes an OpenAI function schema', () => {
    const def = new DeepResearchEngine(
      new FakeSearchEngine() as any,
    ).toToolDefinition();

    expect(def.function.name).toBe('deep_research');
    expect(def.function.parameters.required).toContain('question');
  });
});
