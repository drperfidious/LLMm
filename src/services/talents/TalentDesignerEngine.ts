import {talentStore} from '../../store/TalentStore';
import type {TalentEngine, TalentResult, ToolDefinition} from './types';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean);
  }
  const text = asString(value);
  return text
    ? text
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    : [];
}

export class TalentDesignerEngine implements TalentEngine {
  readonly name = 'create_talent';
  readonly manifest = {
    name: 'create_talent',
    title: 'Talent maker',
    description: 'Create or update a custom instruction talent.',
    source: 'builtin' as const,
    category: 'management' as const,
    sideEffect: true,
    configurable: true,
    agentDefaultEnabled: false,
    keywords: ['create talent', 'make talent', 'new talent', 'add tool'],
  };

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const title = asString(args.title ?? args.name);
    const description = asString(args.description);
    const instructions = asString(args.instructions);
    if (!title || !instructions) {
      const summary =
        'create_talent: title/name and instructions are required to create a custom talent';
      return {type: 'error', summary, errorMessage: summary};
    }

    try {
      const talent = talentStore.addCustomTalent({
        name: asString(args.name) || title,
        title,
        description:
          description || `Custom talent created for ${title.toLowerCase()}.`,
        instructions,
        keywords: asStringArray(args.keywords),
        source: 'agent',
      });
      return {
        type: 'text',
        summary:
          `create_talent: saved "${talent.title}" as ${talent.name}. ` +
          `Route keywords: ${(talent.keywords ?? []).join(', ')}. ` +
          'It is enabled for Agent mode and will participate in keyword routing immediately.',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        type: 'error',
        summary: `create_talent: ${errorMessage}`,
        errorMessage,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Create or update a custom LLMm talent manifest. This creates an instruction-backed talent, not arbitrary executable code.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Optional stable snake_case tool name. If omitted, LLMm derives it from the title.',
            },
            title: {
              type: 'string',
              description: 'Human-readable talent name.',
            },
            description: {
              type: 'string',
              description: 'Short purpose shown in the Talents tab.',
            },
            instructions: {
              type: 'string',
              description:
                'The instruction body the talent returns when called. Be specific about inputs and output format.',
            },
            keywords: {
              type: 'array',
              items: {type: 'string'},
              description:
                'Concrete trigger phrases that should route user requests to this talent. Include 3-8 phrases users would naturally type.',
            },
          },
          required: ['title', 'instructions'],
        },
      },
    };
  }
}
