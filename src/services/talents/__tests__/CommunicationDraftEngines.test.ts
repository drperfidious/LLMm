import {Linking} from 'react-native';

import {MailDraftEngine} from '../MailDraftEngine';
import {SmsDraftEngine} from '../SmsDraftEngine';

describe('SmsDraftEngine', () => {
  const engine = new SmsDraftEngine();

  beforeEach(() => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes name "sms_draft"', () => {
    expect(engine.name).toBe('sms_draft');
  });

  it('opens Messages with recipients and body encoded', async () => {
    const result = await engine.execute({
      recipients: ['+15551234567', 'second@example.com'],
      body: 'Hello there',
    });

    expect(result.type).toBe('text');
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(url).toMatch(/^sms:/);
    expect(url).toContain('%2B15551234567');
    expect(url).toContain('second%40example.com');
    expect(url).toContain('body=Hello%20there');
  });

  it('accepts comma-separated to aliases', async () => {
    await engine.execute({
      to: '+15551234567, +15557654321',
      body: 'Two people',
    });

    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('%2B15551234567');
    expect(url).toContain('%2B15557654321');
  });

  it('returns an error without a recipient', async () => {
    const result = await engine.execute({body: 'Hello'});

    expect(result.type).toBe('error');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('returns an error without a body', async () => {
    const result = await engine.execute({recipients: ['+15551234567']});

    expect(result.type).toBe('error');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('surfaces Linking failures as talent errors', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValueOnce(
      new Error('no handler'),
    );

    const result = await engine.execute({
      recipients: ['+15551234567'],
      body: 'Hello',
    });

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('no handler');
    }
  });

  it('documents the manual-send contract in its schema', () => {
    const def = engine.toToolDefinition();

    expect(def.function.name).toBe('sms_draft');
    expect(def.function.parameters.required).toEqual(['recipients', 'body']);
    expect(def.function.description).toMatch(/manually review and send/i);
  });
});

describe('MailDraftEngine', () => {
  const engine = new MailDraftEngine();

  beforeEach(() => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes name "mail_draft"', () => {
    expect(engine.name).toBe('mail_draft');
  });

  it('opens Mail with recipients, subject, body, cc, and bcc encoded', async () => {
    const result = await engine.execute({
      to: ['person@example.com'],
      cc: 'copy@example.com',
      bcc: ['hidden@example.com'],
      subject: 'Status update',
      body: 'Here is the update.',
    });

    expect(result.type).toBe('text');
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(url).toMatch(/^mailto:/);
    expect(url).toContain('person%40example.com');
    expect(url).toContain('subject=Status%20update');
    expect(url).toContain('body=Here%20is%20the%20update.');
    expect(url).toContain('cc=copy%40example.com');
    expect(url).toContain('bcc=hidden%40example.com');
  });

  it('accepts recipients alias and comma-separated addresses', async () => {
    await engine.execute({
      recipients: 'one@example.com; two@example.com',
      subject: 'Hi',
    });

    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('one%40example.com');
    expect(url).toContain('two%40example.com');
  });

  it('returns an error without a recipient', async () => {
    const result = await engine.execute({
      subject: 'Status update',
      body: 'Here is the update.',
    });

    expect(result.type).toBe('error');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('returns an error without subject or body', async () => {
    const result = await engine.execute({to: ['person@example.com']});

    expect(result.type).toBe('error');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('surfaces Linking failures as talent errors', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValueOnce(
      new Error('mail unavailable'),
    );

    const result = await engine.execute({
      to: ['person@example.com'],
      subject: 'Status update',
    });

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toContain('mail unavailable');
    }
  });

  it('documents the manual-send contract in its schema', () => {
    const def = engine.toToolDefinition();

    expect(def.function.name).toBe('mail_draft');
    expect(def.function.parameters.required).toEqual(['to']);
    expect(def.function.description).toMatch(/manually review and send/i);
  });
});
