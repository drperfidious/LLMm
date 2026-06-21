import {Linking} from 'react-native';

import {TalentEngine, TalentResult, ToolDefinition} from './types';

function normalizeAddresses(value: unknown): string[] {
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

function appendQuery(parts: string[], key: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    parts.push(`${key}=${encodeURIComponent(value.trim())}`);
  }
}

function buildMailtoUrl(args: Record<string, any>): string {
  const to = normalizeAddresses(args.to ?? args.recipients);
  const cc = normalizeAddresses(args.cc);
  const bcc = normalizeAddresses(args.bcc);
  const query: string[] = [];
  appendQuery(query, 'subject', args.subject);
  appendQuery(query, 'body', args.body);
  if (cc.length > 0) {
    query.push(`cc=${cc.map(encodeURIComponent).join(',')}`);
  }
  if (bcc.length > 0) {
    query.push(`bcc=${bcc.map(encodeURIComponent).join(',')}`);
  }
  return `mailto:${to.map(encodeURIComponent).join(',')}${
    query.length > 0 ? `?${query.join('&')}` : ''
  }`;
}

export class MailDraftEngine implements TalentEngine {
  readonly name = 'mail_draft';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const to = normalizeAddresses(args.to ?? args.recipients);
    const subject = typeof args.subject === 'string' ? args.subject.trim() : '';
    const body = typeof args.body === 'string' ? args.body.trim() : '';

    if (to.length === 0) {
      return {
        type: 'error',
        summary: 'mail_draft: missing recipient',
        errorMessage:
          'to argument is required and must contain at least one email address',
      };
    }
    if (!subject && !body) {
      return {
        type: 'error',
        summary: 'mail_draft: missing subject/body',
        errorMessage:
          'subject or body is required so the user has a meaningful draft to review',
      };
    }

    try {
      await Linking.openURL(buildMailtoUrl(args));
      return {
        type: 'text',
        summary:
          'Opened the system mail composer with a draft. The user must review and send it manually.',
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: 'mail_draft: failed to open mail composer',
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'mail_draft',
        description:
          'Open the system mail composer with recipients, subject, and body prefilled. The user must manually review and send; this tool cannot read mail or send silently.',
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'array',
              items: {type: 'string'},
              description: 'One or more recipient email addresses.',
            },
            cc: {
              type: 'array',
              items: {type: 'string'},
              description: 'Optional CC email addresses.',
            },
            bcc: {
              type: 'array',
              items: {type: 'string'},
              description: 'Optional BCC email addresses.',
            },
            subject: {
              type: 'string',
              description: 'Draft email subject.',
            },
            body: {
              type: 'string',
              description: 'Draft email body for the user to review.',
            },
          },
          required: ['to'],
        },
      },
    };
  }
}
