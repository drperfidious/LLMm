import {WebSearchEngine} from './WebSearchEngine';
import {TalentEngine, TalentResult, ToolDefinition} from './types';

type ResearchSource = {
  title: string;
  url: string;
  age?: string;
  snippet?: string;
  query: string;
};

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => cleanString(item)).filter(Boolean);
  }
  return cleanString(value)
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean);
}

function clamp(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n)
    ? Math.max(min, Math.min(max, Math.floor(n)))
    : fallback;
}

function buildQueries(
  question: string,
  provided: string[],
  maxQueries: number,
): string[] {
  const base =
    provided.length > 0
      ? provided
      : [
          question,
          `${question} latest reliable sources`,
          `${question} official source OR report`,
        ];
  return Array.from(
    new Set(base.map(query => query.trim()).filter(Boolean)),
  ).slice(0, maxQueries);
}

function parseSources(summary: string, query: string): ResearchSource[] {
  const chunks = summary.split(/\n(?=\d+\. )/g);
  return chunks
    .map<ResearchSource | undefined>(chunk => {
      const title = cleanString(chunk.match(/^\d+\.\s*(.+)$/m)?.[1]);
      const url = cleanString(chunk.match(/^URL:\s*(.+)$/m)?.[1]);
      const age = cleanString(chunk.match(/^Age:\s*(.+)$/m)?.[1]);
      const snippet = cleanString(chunk.match(/^Snippet:\s*([\s\S]*)$/m)?.[1]);
      return title && url ? {title, url, age, snippet, query} : undefined;
    })
    .filter((source): source is ResearchSource => !!source);
}

function sourceKey(source: ResearchSource): string {
  return source.url.toLowerCase().replace(/\/+$/, '');
}

function formatSource(source: ResearchSource, index: number): string {
  return `${index + 1}. ${source.title}\nURL: ${source.url}\nQuery: ${
    source.query
  }${source.age ? `\nAge: ${source.age}` : ''}${
    source.snippet ? `\nSnippet: ${source.snippet.slice(0, 500)}` : ''
  }`;
}

export class DeepResearchEngine implements TalentEngine {
  readonly name = 'deep_research';
  readonly manifest = {
    name: 'deep_research',
    title: 'Deep research',
    description:
      'Run multiple web searches and assemble a deduplicated source packet.',
    source: 'builtin' as const,
    category: 'search' as const,
    configurable: true,
    agentDefaultEnabled: true,
    keywords: [
      'deep research',
      'research',
      'sources',
      'verify',
      'compare sources',
      'recent report',
    ],
  };
  readonly recommendedContextTokens = 8192;

  constructor(private readonly searchEngine = new WebSearchEngine()) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const question = cleanString(args.question ?? args.query ?? args.topic);
    if (!question) {
      return {
        type: 'error',
        summary: 'deep_research: missing question',
        errorMessage: 'question is required.',
      };
    }

    const maxQueries = clamp(args.max_queries, 3, 1, 5);
    const resultsPerQuery = clamp(args.results_per_query, 4, 1, 6);
    const queries = buildQueries(
      question,
      stringArray(args.queries),
      maxQueries,
    );
    const sourcesByUrl = new Map<string, ResearchSource>();
    const notes: string[] = [];

    for (const query of queries) {
      const result = await this.searchEngine.execute({
        query,
        count: resultsPerQuery,
        freshness: args.freshness,
        country: args.country,
        search_lang: args.search_lang,
        no_cache: args.no_cache ?? true,
      });
      if (result.type === 'error') {
        notes.push(`Search failed for "${query}": ${result.errorMessage}`);
        continue;
      }
      const parsed = parseSources(result.summary, query);
      if (parsed.length === 0) {
        notes.push(`Search returned no parseable sources for "${query}".`);
      }
      parsed.forEach(source => {
        const key = sourceKey(source);
        if (!sourcesByUrl.has(key)) {
          sourcesByUrl.set(key, source);
        }
      });
    }

    const sources = Array.from(sourcesByUrl.values()).slice(
      0,
      maxQueries * resultsPerQuery,
    );
    if (sources.length === 0) {
      return {
        type: 'error',
        summary: `deep_research: no sources found for "${question}"`,
        errorMessage:
          notes.join('\n') ||
          'No sources were returned by the configured search provider.',
      };
    }

    return {
      type: 'text',
      summary:
        `deep_research packet for: ${question}\n` +
        `Searches run: ${queries.join(' | ')}\n` +
        `Unique sources: ${sources.length}\n\n` +
        sources.map(formatSource).join('\n\n') +
        (notes.length ? `\n\nResearch notes:\n${notes.join('\n')}` : '') +
        '\n\nUse these sources to answer the user. Prefer direct source URLs and mention uncertainty when sources conflict.',
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'deep_research',
        description:
          'Run a bounded multi-search research pass for questions that need several current sources, comparison, or verification. Returns a deduplicated source packet for synthesis.',
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'Research question to investigate.',
            },
            queries: {
              type: 'array',
              items: {type: 'string'},
              description:
                'Optional explicit search queries. If omitted, LLMm derives a small query set from question.',
            },
            max_queries: {
              type: 'number',
              description: 'Number of searches to run, 1-5. Default 3.',
            },
            results_per_query: {
              type: 'number',
              description: 'Results per search, 1-6. Default 4.',
            },
            freshness: {
              type: 'string',
              description:
                'Optional freshness filter forwarded to the configured provider.',
            },
            country: {
              type: 'string',
              description: 'Optional result region override.',
            },
            search_lang: {
              type: 'string',
              description: 'Optional search language override.',
            },
          },
          required: ['question'],
        },
      },
    };
  }
}
