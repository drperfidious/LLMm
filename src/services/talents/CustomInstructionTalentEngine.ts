import type {
  TalentEngine,
  TalentManifest,
  TalentResult,
  ToolDefinition,
} from './types';

type CustomInstructionDefinition = TalentManifest & {
  instructions: string;
};

function buildSchema(description: string): Record<string, any> {
  return {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description:
          'The user request or relevant details this custom talent should process.',
      },
      context: {
        type: 'string',
        description: 'Optional extra context gathered before using this talent.',
      },
    },
    required: ['input'],
    additionalProperties: true,
    description,
  };
}

export class CustomInstructionTalentEngine implements TalentEngine {
  readonly name: string;
  readonly manifest: TalentManifest;

  constructor(private readonly definition: CustomInstructionDefinition) {
    this.name = definition.name;
    this.manifest = definition;
  }

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const input =
      typeof args.input === 'string' && args.input.trim()
        ? args.input.trim()
        : JSON.stringify(args);
    const context =
      typeof args.context === 'string' && args.context.trim()
        ? `\nContext:\n${args.context.trim()}`
        : '';

    return {
      type: 'text',
      summary:
        `custom_talent:${this.definition.name}\n` +
        `Title: ${this.definition.title}\n` +
        `Purpose: ${this.definition.description}\n` +
        `Instructions:\n${this.definition.instructions}\n` +
        `Input:\n${input}${context}`,
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.definition.name,
        description: `${this.definition.description} ${this.definition.instructions}`.slice(
          0,
          900,
        ),
        parameters: buildSchema(this.definition.description),
      },
    };
  }
}
