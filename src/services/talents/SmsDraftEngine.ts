import {Linking, Platform} from 'react-native';

import {TalentEngine, TalentResult, ToolDefinition} from './types';

function normalizeRecipients(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter(item => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\n;]/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function buildSmsUrl(recipients: string[], body: string): string {
  const to = recipients.map(encodeURIComponent).join(',');
  const encodedBody = encodeURIComponent(body);
  const separator = Platform.OS === 'ios' ? '&' : '?';
  return `sms:${to}${separator}body=${encodedBody}`;
}

export class SmsDraftEngine implements TalentEngine {
  readonly name = 'sms_draft';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const recipients = normalizeRecipients(args.recipients ?? args.to);
    const body = typeof args.body === 'string' ? args.body.trim() : '';

    if (recipients.length === 0) {
      return {
        type: 'error',
        summary: 'sms_draft: missing recipient',
        errorMessage:
          'recipients argument is required and must contain at least one phone number or contact address',
      };
    }
    if (!body) {
      return {
        type: 'error',
        summary: 'sms_draft: missing body',
        errorMessage: 'body argument is required and must be non-empty',
      };
    }

    const url = buildSmsUrl(recipients, body);
    try {
      await Linking.openURL(url);
      return {
        type: 'text',
        summary:
          'Opened the system Messages composer with a draft. The user must review and send it manually.',
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: 'sms_draft: failed to open Messages composer',
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'sms_draft',
        description:
          'Open the system Messages composer with recipients and body prefilled. The user must manually review and send; this tool cannot read messages or send silently.',
        parameters: {
          type: 'object',
          properties: {
            recipients: {
              type: 'array',
              items: {type: 'string'},
              description:
                'One or more phone numbers or SMS/iMessage-capable recipient addresses.',
            },
            body: {
              type: 'string',
              description: 'Draft message body for the user to review.',
            },
          },
          required: ['recipients', 'body'],
        },
      },
    };
  }
}
