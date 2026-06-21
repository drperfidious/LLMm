import {
  checkMailBridgeStatus,
  MailReadEngine,
  MailSearchEngine,
  MailSendEngine,
} from '../MailBridgeEngines';
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

describe('MailBridgeEngines', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
    talentStore.resetMailBridgeSettings();
    jest.restoreAllMocks();
  });

  it('returns a config error before endpoint is configured', async () => {
    mockFetch({});

    const result = await new MailSearchEngine(async () => '').execute({
      query: 'invoice',
    });

    expect(result.type).toBe('error');
    expect(result.summary).toContain('bridge endpoint');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('searches mail through the configured bridge', async () => {
    talentStore.updateMailBridgeSettings({
      endpoint: 'https://mail.example.com/',
      accountEmail: 'user@example.com',
      inboxFolder: 'Inbox',
      defaultLimit: 7,
    });
    mockFetch({
      body: {
        messages: [
          {
            id: 'msg-1',
            from: {name: 'Ada', email: 'ada@example.com'},
            subject: 'Project update',
            date: '2026-06-21T12:00:00Z',
            snippet: 'The latest build is ready.',
          },
        ],
      },
    });

    const result = await new MailSearchEngine(async () => 'token').execute({
      query: 'build',
    });

    expect(result.type).toBe('text');
    const [url, options] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('https://mail.example.com/mail/search');
    expect(options.headers.Authorization).toBe('Bearer token');
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({
        accountEmail: 'user@example.com',
        query: 'build',
        folder: 'Inbox',
        limit: 7,
      }),
    );
    expect(result.summary).toContain('Project update');
    expect(result.summary).toContain('msg-1');
  });

  it('checks configured mail bridge capabilities', async () => {
    talentStore.updateMailBridgeSettings({
      endpoint: 'https://mail.example.com/',
      accountEmail: 'user@example.com',
    });
    mockFetch({
      body: {
        ok: true,
        provider: 'imap-smtp',
        accountEmail: 'user@example.com',
        capabilities: ['search', 'read', 'send'],
        folders: ['INBOX', 'Sent'],
      },
    });

    const result = await checkMailBridgeStatus(async () => 'token');

    expect(result.type).toBe('text');
    const [url, options] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('https://mail.example.com/mail/status');
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer token');
    expect(result.summary).toContain('imap-smtp');
    expect(result.summary).toContain('search, read, send');
  });

  it('surfaces bridge status HTTP failures', async () => {
    talentStore.updateMailBridgeSettings({
      endpoint: 'https://mail.example.com',
    });
    mockFetch({
      ok: false,
      status: 404,
      text: jest.fn().mockResolvedValue('not found'),
    });

    const result = await checkMailBridgeStatus(async () => '');

    expect(result.type).toBe('error');
    expect(result.summary).toContain('HTTP 404');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('not found');
    }
  });

  it('reads a message by ID', async () => {
    talentStore.updateMailBridgeSettings({
      endpoint: 'https://mail.example.com',
    });
    mockFetch({
      body: {
        message: {
          id: 'msg-2',
          from: 'sender@example.com',
          to: ['user@example.com'],
          subject: 'Notes',
          body: 'Here are the notes.',
        },
      },
    });

    const result = await new MailReadEngine(async () => '').execute({
      id: 'msg-2',
    });

    expect(result.type).toBe('text');
    const [url, options] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('https://mail.example.com/mail/read');
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({id: 'msg-2', folder: 'INBOX'}),
    );
    expect(result.summary).toContain('Here are the notes.');
  });

  it('requires explicit confirmation before sending', async () => {
    talentStore.updateMailBridgeSettings({
      endpoint: 'https://mail.example.com',
    });
    mockFetch({});

    const result = await new MailSendEngine(async () => 'token').execute({
      to: 'friend@example.com',
      subject: 'Hi',
      body: 'Hello.',
    });

    expect(result.type).toBe('error');
    expect(result.summary).toContain('confirmation required');
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('sends after confirmation', async () => {
    talentStore.updateMailBridgeSettings({
      endpoint: 'https://mail.example.com',
      accountEmail: 'user@example.com',
    });
    mockFetch({
      body: {
        id: 'sent-1',
      },
    });

    const result = await new MailSendEngine(async () => 'token').execute({
      to: ['friend@example.com'],
      subject: 'Hi',
      body: 'Hello.',
      user_confirmed: true,
    });

    expect(result.type).toBe('text');
    const [url, options] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('https://mail.example.com/mail/send');
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({
        accountEmail: 'user@example.com',
        to: ['friend@example.com'],
        subject: 'Hi',
        body: 'Hello.',
      }),
    );
    expect(result.summary).toContain('sent');
    expect(result.summary).toContain('sent-1');
  });

  it('marks send schema as requiring user_confirmed', () => {
    expect(
      new MailSendEngine().toToolDefinition().function.parameters.required,
    ).toContain('user_confirmed');
  });
});
