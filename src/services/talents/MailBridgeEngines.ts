import {talentStore} from '../../store/TalentStore';
import {nativeMailClient} from '../mail/NativeMailClient';
import {getMailBridgeToken} from './talentSecrets';
import {TalentEngine, TalentResult, ToolDefinition} from './types';

type MailAddress = string | {email?: string; name?: string};

type MailMessage = {
  id?: string;
  messageId?: string;
  threadId?: string;
  from?: MailAddress | MailAddress[];
  to?: MailAddress | MailAddress[];
  cc?: MailAddress | MailAddress[];
  subject?: string;
  date?: string;
  snippet?: string;
  body?: string;
  text?: string;
  html?: string;
  folder?: string;
};

type BridgeResponse = {
  message?: MailMessage;
  messages?: MailMessage[];
  results?: MailMessage[];
  ok?: boolean;
  provider?: string;
  capabilities?: string[];
  folders?: string[];
  accountEmail?: string;
  id?: string;
  messageId?: string;
  status?: string;
  summary?: string;
};

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberArg(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n)
    ? Math.max(1, Math.min(25, Math.floor(n)))
    : fallback;
}

function boolArg(value: unknown): boolean {
  return value === true || value === 'true';
}

function listArg(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => cleanString(item)).filter(Boolean);
  }
  return cleanString(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

const MAIL_BRIDGE_HELP =
  'Mail endpoint must be an HTTP(S) LLMm mail bridge base URL, such as https://mail.example.com or http://192.168.1.20:8787. It is not a Gmail REST API URL, imap.gmail.com, smtp.gmail.com, or an imap:// / smtp:// URL.';

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value);
}

function looksLikeDirectMailServer(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    /^(imap|smtp|pop3?):\/\//.test(lower) ||
    /(^|:\/\/)(imap|smtp|pop3?)\./.test(lower) ||
    /(^|[/:])(imap|smtp|pop3?)\.[^/\s]+/.test(lower)
  );
}

function looksLikeGoogleMailApi(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower.includes('gmail.googleapis.com') ||
    lower.includes('googleapis.com/gmail')
  );
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    isPrivateIpv4(lower)
  );
}

export function validateMailBridgeEndpoint(endpoint: string):
  | {ok: true; endpoint: string}
  | {ok: false; errorMessage: string} {
  const trimmed = normalizeEndpoint(endpoint);
  if (!trimmed) {
    return {
      ok: false,
      errorMessage:
        'Configure an LLMm-compatible HTTP(S) mail bridge endpoint first.',
    };
  }

  if (looksLikeDirectMailServer(trimmed)) {
    return {
      ok: false,
      errorMessage:
        'That looks like an IMAP/SMTP mail server. Keep imap.gmail.com and smtp.gmail.com in the host fields below; the endpoint field needs an HTTP(S) LLMm mail bridge base URL.',
    };
  }

  if (looksLikeGoogleMailApi(trimmed)) {
    return {
      ok: false,
      errorMessage:
        'That is the Google Gmail REST API, not an LLMm mail bridge. The current mail talents call /mail/status, /mail/search, /mail/read, and /mail/send on a bridge service.',
    };
  }

  const candidate = hasUrlScheme(trimmed)
    ? trimmed
    : /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/|$)/i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      errorMessage: `Invalid mail bridge URL. ${MAIL_BRIDGE_HELP}`,
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      errorMessage: `Mail bridge endpoint must use http:// or https://. ${MAIL_BRIDGE_HELP}`,
    };
  }

  if (parsed.protocol === 'http:' && !isLocalHostname(parsed.hostname)) {
    return {
      ok: false,
      errorMessage:
        'Plain HTTP mail bridges are only allowed for local network hosts on iOS. Use HTTPS for remote mail bridge endpoints.',
    };
  }

  return {ok: true, endpoint: normalizeEndpoint(parsed.toString())};
}

function addressToText(value: MailAddress | undefined): string {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  const email = cleanString(value.email);
  const name = cleanString(value.name);
  return name && email ? `${name} <${email}>` : email || name;
}

function addressListToText(
  value: MailAddress | MailAddress[] | undefined,
): string {
  if (!value) {
    return '';
  }
  const items = Array.isArray(value) ? value : [value];
  return items.map(addressToText).filter(Boolean).join(', ');
}

function normalizeMessages(data: BridgeResponse): MailMessage[] {
  if (Array.isArray(data.messages)) {
    return data.messages;
  }
  if (Array.isArray(data.results)) {
    return data.results;
  }
  return data.message ? [data.message] : [];
}

function messageId(message: MailMessage): string {
  return cleanString(
    message.id ?? message.messageId ?? message.threadId,
    'unknown',
  );
}

function messageSnippet(message: MailMessage): string {
  return cleanString(
    message.snippet ?? message.body ?? message.text ?? message.html,
    '',
  ).replace(/\s+/g, ' ');
}

function messageSummaryLine(message: MailMessage, index: number): string {
  const from = addressListToText(message.from) || 'unknown sender';
  const subject = cleanString(message.subject, '(no subject)');
  const date = cleanString(message.date);
  const folder = cleanString(message.folder);
  const snippet = messageSnippet(message);
  return `${index + 1}. ${subject}\nID: ${messageId(message)}\nFrom: ${from}${
    date ? `\nDate: ${date}` : ''
  }${folder ? `\nFolder: ${folder}` : ''}${
    snippet ? `\nSnippet: ${snippet.slice(0, 360)}` : ''
  }`;
}

function bridgeConfigError(errorMessage?: string): TalentResult {
  return {
    type: 'error',
    summary: 'mail: bridge endpoint is not configured',
    errorMessage:
      errorMessage ||
      'Configure the custom Mail bridge endpoint in Talents before using mail_search, mail_read, or mail_send with the Bridge provider. Gmail and IMAP/SMTP providers use the direct on-device mail engine.',
  };
}

function directMailConfigError(errorMessage: string): TalentResult {
  return {
    type: 'error',
    summary: 'mail: direct account is not configured',
    errorMessage,
  };
}

function networkErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/network request failed/i.test(raw)) {
    return `${raw}. Could not reach the mail bridge over HTTP(S). Make sure the endpoint is an LLMm-compatible bridge URL, the phone can reach that host on the network, and remote endpoints use HTTPS.`;
  }
  return raw;
}

function directMailErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/network request failed/i.test(raw)) {
    return `${raw}. Could not reach the mail server. Confirm IMAP is enabled, the phone has network access, and the host/port/security settings are correct.`;
  }
  return raw;
}

function isDirectMailProvider(): boolean {
  return talentStore.mailBridgeSettings.provider !== 'custom_bridge';
}

function configuredMailAccount(): string {
  const settings = talentStore.mailBridgeSettings;
  return settings.accountEmail || settings.username;
}

function configuredMailUsername(): string {
  const settings = talentStore.mailBridgeSettings;
  return settings.username || settings.accountEmail;
}

function bridgeHeaders(secret: string): Record<string, string> {
  const settings = talentStore.mailBridgeSettings;
  if (!secret || settings.provider !== 'custom_bridge') {
    return {};
  }
  return {Authorization: `Bearer ${secret}`};
}

function bridgePayload(
  body: Record<string, any>,
  secret: string,
): Record<string, any> {
  const settings = talentStore.mailBridgeSettings;
  const accountEmail = configuredMailAccount();
  const username = configuredMailUsername();
  const directProvider = settings.provider !== 'custom_bridge';

  return {
    accountEmail: accountEmail || undefined,
    mailProvider: settings.provider,
    mailConfig: {
      provider: settings.provider,
      accountEmail: accountEmail || undefined,
      username: username || undefined,
      inboxFolder: settings.inboxFolder,
      sentFolder: settings.sentFolder,
      imap:
        directProvider && settings.imapHost
          ? {
              host: settings.imapHost,
              port: settings.imapPort,
              security: settings.imapSecurity,
            }
          : undefined,
      smtp:
        directProvider && settings.smtpHost
          ? {
              host: settings.smtpHost,
              port: settings.smtpPort,
              security: settings.smtpSecurity,
            }
          : undefined,
    },
    mailAuth:
      directProvider && secret
        ? {
            username: username || undefined,
            password: secret,
          }
        : undefined,
    ...body,
  };
}

function validateDirectMailPayload(
  payload: Record<string, any>,
): TalentResult | undefined {
  const settings = talentStore.mailBridgeSettings;
  if (!configuredMailAccount()) {
    return directMailConfigError('Enter the mail account email first.');
  }
  if (!configuredMailUsername()) {
    return directMailConfigError('Enter a mail login username first.');
  }
  if (!payload.mailAuth?.password) {
    return directMailConfigError(
      settings.provider === 'gmail'
        ? 'Save your Gmail app password before using Gmail mail talents.'
        : 'Save your mail account password/key before using mail talents.',
    );
  }
  if (!settings.imapHost.trim()) {
    return directMailConfigError('Enter an IMAP host first.');
  }
  if (!settings.smtpHost.trim()) {
    return directMailConfigError('Enter an SMTP host first.');
  }
  if (settings.imapSecurity !== 'ssl' || settings.smtpSecurity !== 'ssl') {
    return directMailConfigError(
      'Direct mail currently supports SSL/TLS-on-connect only. Use IMAP 993 ssl and SMTP 465 ssl.',
    );
  }
  return undefined;
}

async function postToNativeMail(
  path: string,
  body: Record<string, any>,
  tokenProvider: () => Promise<string>,
): Promise<BridgeResponse | TalentResult> {
  const token = await tokenProvider();
  const payload = bridgePayload(body, token);
  const configError = validateDirectMailPayload(payload);
  if (configError) {
    return configError;
  }

  try {
    if (path === '/mail/status') {
      return await nativeMailClient.check(payload);
    }
    if (path === '/mail/search') {
      return await nativeMailClient.search(payload);
    }
    if (path === '/mail/read') {
      return await nativeMailClient.read(payload);
    }
    if (path === '/mail/send') {
      return await nativeMailClient.send(payload);
    }
    return {
      type: 'error',
      summary: `mail: unsupported native path ${path}`,
      errorMessage: `Unsupported native mail path: ${path}`,
    };
  } catch (error) {
    return {
      type: 'error',
      summary: 'mail: direct mail request failed',
      errorMessage: directMailErrorMessage(error),
    };
  }
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return body ? `: ${body.slice(0, 300)}` : '';
}

async function postToBridge(
  path: string,
  body: Record<string, any>,
  tokenProvider: () => Promise<string>,
): Promise<BridgeResponse | TalentResult> {
  if (isDirectMailProvider()) {
    return postToNativeMail(path, body, tokenProvider);
  }

  const settings = talentStore.mailBridgeSettings;
  const endpointValidation = validateMailBridgeEndpoint(settings.endpoint);
  if (!endpointValidation.ok) {
    return bridgeConfigError(endpointValidation.errorMessage);
  }
  const endpoint = endpointValidation.endpoint;

  let response: Response;
  try {
    const token = await tokenProvider();
    response = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...bridgeHeaders(token),
      },
      body: JSON.stringify(bridgePayload(body, token)),
    });
  } catch (error) {
    return {
      type: 'error',
      summary: 'mail: bridge request failed',
      errorMessage: networkErrorMessage(error),
    };
  }

  if (!response.ok) {
    const detail = await readError(response);
    return {
      type: 'error',
      summary: `mail: bridge request failed with HTTP ${response.status}`,
      errorMessage: `HTTP ${response.status}${detail}`,
    };
  }

  return response.json();
}

function formatBridgeStatus(data: BridgeResponse): string {
  const isNative = cleanString(data.provider).startsWith('native-');
  const provider = cleanString(
    data.provider,
    isNative ? 'native mail' : 'configured bridge',
  );
  const status = cleanString(data.status, data.ok === false ? 'error' : 'ok');
  const account = cleanString(data.accountEmail);
  const capabilities = Array.isArray(data.capabilities)
    ? data.capabilities.map(item => cleanString(item)).filter(Boolean)
    : [];
  const folders = Array.isArray(data.folders)
    ? data.folders.map(item => cleanString(item)).filter(Boolean)
    : [];

  return [
    `${isNative ? 'Direct mail' : 'Mail bridge'} ${status}: ${provider}`,
    account ? `Account: ${account}` : '',
    capabilities.length ? `Capabilities: ${capabilities.join(', ')}` : '',
    folders.length ? `Folders: ${folders.slice(0, 12).join(', ')}` : '',
    cleanString(data.summary),
  ]
    .filter(Boolean)
    .join('\n');
}

export async function checkMailBridgeStatus(
  tokenProvider = getMailBridgeToken,
): Promise<TalentResult> {
  if (isDirectMailProvider()) {
    const response = await postToNativeMail('/mail/status', {}, tokenProvider);
    if ('type' in response) {
      return response;
    }
    const summary = formatBridgeStatus(response);
    if (response.ok === false) {
      return {
        type: 'error',
        summary,
        errorMessage: cleanString(response.summary, 'Direct mail is not ready'),
      };
    }
    return {type: 'text', summary};
  }

  const settings = talentStore.mailBridgeSettings;
  const endpointValidation = validateMailBridgeEndpoint(settings.endpoint);
  if (!endpointValidation.ok) {
    return bridgeConfigError(endpointValidation.errorMessage);
  }
  const endpoint = endpointValidation.endpoint;

  try {
    const token = await tokenProvider();
    const directProvider = settings.provider !== 'custom_bridge';
    const response = await fetch(`${endpoint}/mail/status`, {
      method: directProvider ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(directProvider ? {'Content-Type': 'application/json'} : {}),
        ...bridgeHeaders(token),
      },
      ...(directProvider
        ? {body: JSON.stringify(bridgePayload({}, token))}
        : {}),
    });

    if (!response.ok) {
      const detail = await readError(response);
      return {
        type: 'error',
        summary: `mail: bridge status failed with HTTP ${response.status}`,
        errorMessage: `HTTP ${response.status}${detail}`,
      };
    }

    const data = (await response.json()) as BridgeResponse;
    const summary = formatBridgeStatus(data);
    if (data.ok === false) {
      return {
        type: 'error',
        summary,
        errorMessage: cleanString(data.summary, 'Mail bridge is not ready'),
      };
    }

    return {
      type: 'text',
      summary,
    };
  } catch (error) {
    return {
      type: 'error',
      summary: 'mail: bridge status request failed',
      errorMessage: networkErrorMessage(error),
    };
  }
}

export class MailSearchEngine implements TalentEngine {
  readonly name = 'mail_search';
  readonly manifest = {
    name: 'mail_search',
    title: 'Search mailbox',
    description: 'Search email through the configured mail bridge.',
    source: 'builtin' as const,
    category: 'communication' as const,
    configurable: true,
    agentDefaultEnabled: false,
    keywords: [
      'email',
      'emails',
      'mail',
      'mailbox',
      'inbox',
      'search mail',
      'search emails',
      'find email',
      'find emails',
      'check emails',
      'read emails',
    ],
  };

  constructor(private readonly tokenProvider = getMailBridgeToken) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const query = cleanString(args.query);
    if (!query) {
      return {
        type: 'error',
        summary: 'mail_search: missing query',
        errorMessage: 'query is required.',
      };
    }

    const settings = talentStore.mailBridgeSettings;
    const response = await postToBridge(
      '/mail/search',
      {
        query,
        folder: cleanString(args.folder, settings.inboxFolder),
        limit: numberArg(args.limit, settings.defaultLimit),
      },
      this.tokenProvider,
    );
    if ('type' in response) {
      return response;
    }

    const messages = normalizeMessages(response);
    return {
      type: 'text',
      summary: messages.length
        ? `mail_search results for "${query}":\n\n${messages
            .map(messageSummaryLine)
            .join('\n\n')}`
        : `mail_search: no messages matched "${query}".`,
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'mail_search',
        description:
          'Search configured email. Returns message IDs, senders, subjects, dates, and snippets.',
        parameters: {
          type: 'object',
          properties: {
            query: {type: 'string', description: 'Mailbox search query.'},
            folder: {
              type: 'string',
              description: 'Optional folder/mailbox name. Defaults to INBOX.',
            },
            limit: {
              type: 'number',
              description: 'Maximum messages to return, 1-25.',
            },
          },
          required: ['query'],
        },
      },
    };
  }
}

export class MailReadEngine implements TalentEngine {
  readonly name = 'mail_read';
  readonly manifest = {
    name: 'mail_read',
    title: 'Read email',
    description: 'Read a specific email through the configured mail bridge.',
    source: 'builtin' as const,
    category: 'communication' as const,
    configurable: true,
    agentDefaultEnabled: false,
    keywords: [
      'read email',
      'read emails',
      'open email',
      'open emails',
      'mail message',
      'mailbox',
      'inbox',
    ],
  };

  constructor(private readonly tokenProvider = getMailBridgeToken) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const id = cleanString(args.id ?? args.messageId);
    if (!id) {
      return {
        type: 'error',
        summary: 'mail_read: missing id',
        errorMessage: 'id or messageId is required.',
      };
    }

    const settings = talentStore.mailBridgeSettings;
    const response = await postToBridge(
      '/mail/read',
      {
        id,
        folder: cleanString(args.folder, settings.inboxFolder),
      },
      this.tokenProvider,
    );
    if ('type' in response) {
      return response;
    }

    const message = response.message ?? normalizeMessages(response)[0];
    if (!message) {
      return {
        type: 'text',
        summary: `mail_read: no message returned for ${id}.`,
      };
    }

    const from = addressListToText(message.from) || 'unknown sender';
    const to = addressListToText(message.to);
    const subject = cleanString(message.subject, '(no subject)');
    const body = cleanString(message.body ?? message.text ?? message.html);
    return {
      type: 'text',
      summary: [
        `mail_read ${messageId(message)}: ${subject}`,
        `From: ${from}`,
        to ? `To: ${to}` : '',
        cleanString(message.date) ? `Date: ${message.date}` : '',
        '',
        body || messageSnippet(message) || '(empty message body)',
      ]
        .filter(line => line !== '')
        .join('\n'),
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'mail_read',
        description:
          'Read one email by ID through the configured mail bridge. Use IDs returned by mail_search.',
        parameters: {
          type: 'object',
          properties: {
            id: {type: 'string', description: 'Message ID to read.'},
            folder: {
              type: 'string',
              description: 'Optional folder/mailbox name. Defaults to INBOX.',
            },
          },
          required: ['id'],
        },
      },
    };
  }
}

export class MailSendEngine implements TalentEngine {
  readonly name = 'mail_send';
  readonly manifest = {
    name: 'mail_send',
    title: 'Send email',
    description:
      'Send email through the configured mail bridge after confirmation.',
    source: 'builtin' as const,
    category: 'communication' as const,
    configurable: true,
    sideEffect: true,
    agentDefaultEnabled: false,
    keywords: [
      'send email',
      'send emails',
      'reply email',
      'reply emails',
      'mail someone',
      'email',
      'emails',
    ],
  };

  constructor(private readonly tokenProvider = getMailBridgeToken) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    if (!boolArg(args.user_confirmed)) {
      return {
        type: 'error',
        summary: 'mail_send: confirmation required',
        errorMessage:
          'Sending email changes external state. Ask the user to confirm the exact recipient, subject, and body, then call mail_send with user_confirmed=true.',
      };
    }

    const to = listArg(args.to);
    const subject = cleanString(args.subject);
    const body = cleanString(args.body);
    if (to.length === 0 || !subject || !body) {
      return {
        type: 'error',
        summary: 'mail_send: missing required fields',
        errorMessage: 'to, subject, and body are required.',
      };
    }

    const response = await postToBridge(
      '/mail/send',
      {
        to,
        cc: listArg(args.cc),
        bcc: listArg(args.bcc),
        subject,
        body,
        replyToId: cleanString(args.replyToId) || undefined,
      },
      this.tokenProvider,
    );
    if ('type' in response) {
      return response;
    }

    const sentId = cleanString(response.id ?? response.messageId);
    return {
      type: 'text',
      summary:
        cleanString(response.summary) ||
        `mail_send: sent "${subject}" to ${to.join(', ')}${
          sentId ? ` (${sentId})` : ''
        }.`,
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'mail_send',
        description:
          'Send email through the configured mail bridge. Only call after the user explicitly confirms the recipient, subject, and body; set user_confirmed=true.',
        parameters: {
          type: 'object',
          properties: {
            to: {
              oneOf: [
                {type: 'string'},
                {type: 'array', items: {type: 'string'}},
              ],
              description: 'Recipient email address or addresses.',
            },
            cc: {
              oneOf: [
                {type: 'string'},
                {type: 'array', items: {type: 'string'}},
              ],
              description: 'Optional CC recipients.',
            },
            bcc: {
              oneOf: [
                {type: 'string'},
                {type: 'array', items: {type: 'string'}},
              ],
              description: 'Optional BCC recipients.',
            },
            subject: {type: 'string', description: 'Email subject.'},
            body: {type: 'string', description: 'Email body.'},
            replyToId: {
              type: 'string',
              description: 'Optional original message ID when replying.',
            },
            user_confirmed: {
              type: 'boolean',
              description:
                'Must be true only after the user explicitly confirms the send.',
            },
          },
          required: ['to', 'subject', 'body', 'user_confirmed'],
        },
      },
    };
  }
}
