import React from 'react';
import * as Keychain from 'react-native-keychain';
import {NativeModules, Platform} from 'react-native';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';
import {l10n} from '../../../locales';
import {L10nContext} from '../../../utils';
import {
  registerDefaultTalents,
  resetRegisteredFlag,
  talentRegistry,
} from '../../../services/talents';
import {talentStore} from '../../../store/TalentStore';
import {TalentsScreen} from '../TalentsScreen';

const originalFetch = (global as any).fetch;
const originalNativeMailModule = (NativeModules as any).NativeMailModule;

const nativeMail = {
  check: jest.fn(),
  search: jest.fn(),
  read: jest.fn(),
  send: jest.fn(),
};

const renderScreen = () =>
  render(
    <L10nContext.Provider value={l10n.en}>
      <TalentsScreen />
    </L10nContext.Provider>,
    {withSafeArea: true},
  );

describe('TalentsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = originalFetch;
    talentRegistry.reset();
    resetRegisteredFlag();
    registerDefaultTalents();
    talentStore.customTalents = [];
    talentStore.talentSettings = {};
    talentStore.resetWebSearchSettings();
    talentStore.resetMailBridgeSettings();
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'ios',
    });
    (NativeModules as any).NativeMailModule = nativeMail;
    nativeMail.check.mockResolvedValue({
      ok: true,
      provider: 'native-gmail',
      capabilities: ['search', 'read', 'send'],
    });
  });

  afterAll(() => {
    talentRegistry.reset();
    resetRegisteredFlag();
    (global as any).fetch = originalFetch;
    (NativeModules as any).NativeMailModule = originalNativeMailModule;
  });

  it('renders installed talents and web search configuration', async () => {
    const {getByTestId, getByText} = renderScreen();

    expect(getByTestId('talents-screen')).toBeTruthy();
    expect(getByTestId('talents-web-search-section')).toBeTruthy();
    expect(getByTestId('talents-row-web_search')).toBeTruthy();
    expect(getByText(l10n.en.talents.availableTitle)).toBeTruthy();

    await waitFor(() => {
      expect(getByTestId('talents-web-search-status').props.children).toBe(
        l10n.en.talents.webSearch.notConfigured,
      );
    });
  });

  it('saves a Brave Search key through Keychain', async () => {
    const {getByTestId, getByText} = renderScreen();

    fireEvent.changeText(
      getByTestId('talents-web-search-key-input'),
      ' brave-key ',
    );
    fireEvent.press(getByTestId('talents-web-search-save'));

    await waitFor(() => {
      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'brave_search_api_key',
        'brave-key',
        {service: 'llmm.talent.brave-search'},
      );
    });
    expect(getByText(l10n.en.talents.webSearch.saved)).toBeTruthy();
  });

  it('clears an existing Brave Search key', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'brave_search_api_key',
      password: 'brave-key',
    });
    const {getByTestId, getByText} = renderScreen();

    await waitFor(() => {
      expect(
        getByTestId('talents-web-search-clear').props.accessibilityState,
      ).not.toEqual(expect.objectContaining({disabled: true}));
    });
    fireEvent.press(getByTestId('talents-web-search-clear'));

    await waitFor(() => {
      expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
        service: 'llmm.talent.brave-search',
      });
    });
    expect(getByText(l10n.en.talents.webSearch.cleared)).toBeTruthy();
  });

  it('saves a selected Tavily key through provider-specific keychain storage', async () => {
    const {getByTestId, getByText} = renderScreen();

    fireEvent.press(getByText('Tavily'));
    fireEvent.changeText(
      getByTestId('talents-web-search-key-input'),
      ' tavily-key ',
    );
    fireEvent.press(getByTestId('talents-web-search-save'));

    await waitFor(() => {
      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'search_provider_api_key',
        'tavily-key',
        {service: 'llmm.talent.tavily-search'},
      );
    });
  });

  it('saves Brave country selection from the Talents UI', () => {
    const {getByTestId} = renderScreen();

    fireEvent.changeText(
      getByTestId('talents-web-search-country-input'),
      ' ca ',
    );

    expect(talentStore.webSearchSettings.country).toBe('CA');
  });

  it('configures SearXNG with an endpoint and optional granular filters', async () => {
    const {getByTestId, getByText} = renderScreen();

    fireEvent.press(getByText('SearXNG'));
    fireEvent.changeText(
      getByTestId('talents-web-search-endpoint-input'),
      ' https://search.example ',
    );
    fireEvent.changeText(
      getByTestId('talents-web-search-categories-input'),
      ' general,news ',
    );
    fireEvent.changeText(
      getByTestId('talents-web-search-engines-input'),
      ' duckduckgo ',
    );
    fireEvent.changeText(
      getByTestId('talents-web-search-time-range-input'),
      ' day ',
    );
    fireEvent.changeText(
      getByTestId('talents-web-search-safesearch-input'),
      ' 0 ',
    );

    await waitFor(() => {
      expect(getByTestId('talents-web-search-status').props.children).toBe(
        l10n.en.talents.webSearch.configured,
      );
    });
    expect(talentStore.webSearchSettings).toEqual(
      expect.objectContaining({
        provider: 'searxng',
        endpoint: 'https://search.example',
        categories: 'general,news',
        engines: 'duckduckgo',
        time_range: 'day',
        safesearch: '0',
      }),
    );
  });

  it('configures Gmail mail settings and stores app password in Keychain', async () => {
    const {getByTestId, getByText} = renderScreen();

    expect(() => getByTestId('talents-mail-endpoint-input')).toThrow();
    fireEvent.changeText(
      getByTestId('talents-mail-account-input'),
      ' user@example.com ',
    );
    fireEvent.changeText(
      getByTestId('talents-mail-username-input'),
      ' login@example.com ',
    );
    fireEvent.changeText(
      getByTestId('talents-mail-imap-host-input'),
      ' imap.gmail.com ',
    );
    fireEvent.changeText(getByTestId('talents-mail-imap-port-input'), ' 993 ');
    fireEvent.changeText(
      getByTestId('talents-mail-smtp-host-input'),
      ' smtp.gmail.com ',
    );
    fireEvent.changeText(getByTestId('talents-mail-smtp-port-input'), ' 465 ');
    fireEvent.changeText(getByTestId('talents-mail-inbox-input'), ' Inbox ');
    fireEvent.changeText(getByTestId('talents-mail-limit-input'), ' 9 ');
    fireEvent.changeText(
      getByTestId('talents-mail-token-input'),
      ' app-password ',
    );
    fireEvent.press(getByTestId('talents-mail-token-save'));

    await waitFor(() => {
      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'mail_bridge_token',
        'app-password',
        {service: 'llmm.talent.mail-bridge'},
      );
    });
    expect(talentStore.mailBridgeSettings).toEqual(
      expect.objectContaining({
        provider: 'gmail',
        endpoint: '',
        accountEmail: 'user@example.com',
        username: 'login@example.com',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        inboxFolder: 'Inbox',
        defaultLimit: 9,
      }),
    );
    expect(getByText('Saved mail account credential.')).toBeTruthy();
  });

  it('tests the configured mail bridge status endpoint', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        ok: true,
        provider: 'imap-smtp',
        capabilities: ['search', 'read', 'send'],
      }),
      text: jest.fn().mockResolvedValue(''),
    });
    const {getByTestId, getByText} = renderScreen();

    fireEvent.press(getByText('Bridge'));
    fireEvent.changeText(
      getByTestId('talents-mail-endpoint-input'),
      ' https://mail.example ',
    );
    fireEvent.press(getByTestId('talents-mail-test'));

    await waitFor(() => {
      expect((global as any).fetch).toHaveBeenCalledWith(
        'https://mail.example/mail/status',
        expect.objectContaining({method: 'GET'}),
      );
    });
    expect(getByText(/Capabilities: search, read, send/)).toBeTruthy();
  });

  it('tests Gmail direct mail without a bridge endpoint', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: 'mail_bridge_token',
      password: 'app-password',
    });
    const {getByTestId, getByText} = renderScreen();

    await waitFor(() => {
      expect(getByTestId('talents-mail-status').props.children).toBe(
        'Needs account',
      );
    });

    fireEvent.changeText(
      getByTestId('talents-mail-account-input'),
      ' user@gmail.com ',
    );
    fireEvent.changeText(
      getByTestId('talents-mail-username-input'),
      ' user@gmail.com ',
    );

    await waitFor(() => {
      expect(getByTestId('talents-mail-status').props.children).toBe('Ready');
    });

    fireEvent.press(getByTestId('talents-mail-test'));

    await waitFor(() => {
      expect(nativeMail.check).toHaveBeenCalledWith(
        expect.objectContaining({
          accountEmail: 'user@gmail.com',
          mailProvider: 'gmail',
          mailAuth: expect.objectContaining({password: 'app-password'}),
        }),
      );
    });
    expect(getByText(/Direct mail ok/)).toBeTruthy();
  });

  it('warns when the bridge endpoint is an IMAP host instead of a bridge', async () => {
    const {getByTestId, getByText} = renderScreen();

    fireEvent.press(getByText('Bridge'));
    fireEvent.changeText(
      getByTestId('talents-mail-endpoint-input'),
      'imap.gmail.com',
    );

    expect(getByText(/looks like an IMAP\/SMTP mail server/)).toBeTruthy();
    expect(getByTestId('talents-mail-test').props.accessibilityState).toEqual(
      expect.objectContaining({disabled: true}),
    );
  });

  it('creates a custom talent that appears in the installed list', async () => {
    const {getByTestId, getByText} = renderScreen();

    fireEvent.changeText(
      getByTestId('talents-custom-title-input'),
      'Contract Reviewer',
    );
    fireEvent.changeText(
      getByTestId('talents-custom-keywords-input'),
      'contract reviewer, legal pass',
    );
    fireEvent.changeText(
      getByTestId('talents-custom-instructions-input'),
      'Review text for risky clauses and return concise notes.',
    );
    fireEvent.press(getByTestId('talents-custom-save'));

    await waitFor(() => {
      expect(getByTestId('talents-row-contract_reviewer')).toBeTruthy();
    });
    expect(getByText('Contract Reviewer')).toBeTruthy();
  });

  it('lets the user manually edit keyword routing for a talent', () => {
    const {getByTestId} = renderScreen();

    fireEvent.changeText(
      getByTestId('talents-keywords-web_search'),
      'look up, cite source',
    );

    expect(talentStore.getSettings('web_search').keywords).toEqual([
      'look up',
      'cite source',
    ]);
  });

  it('installs a custom talent from pasted JSON', async () => {
    const {getByTestId, getByText} = renderScreen();

    fireEvent.changeText(
      getByTestId('talents-install-json-input'),
      JSON.stringify({
        title: 'Source Auditor',
        instructions: 'Check claims against source notes and return risks.',
        keywords: ['source audit', 'verify claims'],
      }),
    );
    fireEvent.press(getByTestId('talents-install-json-save'));

    await waitFor(() => {
      expect(getByTestId('talents-row-source_auditor')).toBeTruthy();
    });
    expect(getByText('Source Auditor')).toBeTruthy();
    expect(talentStore.getSettings('source_auditor').keywords).toEqual([
      'source audit',
      'verify claims',
    ]);
  });
});
