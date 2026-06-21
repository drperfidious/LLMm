import * as Keychain from 'react-native-keychain';

import {
  BRAVE_SEARCH_KEYCHAIN_SERVICE,
  MAIL_BRIDGE_KEYCHAIN_SERVICE,
  clearBraveSearchApiKey,
  clearMailBridgeToken,
  getBraveSearchApiKey,
  getMailBridgeToken,
  hasBraveSearchApiKey,
  hasMailBridgeToken,
  saveMailBridgeToken,
  saveBraveSearchApiKey,
} from '../talentSecrets';

describe('talentSecrets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves the Brave Search API key in Keychain', async () => {
    const saved = await saveBraveSearchApiKey('  brave-key  ');

    expect(saved).toBe(true);
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'brave_search_api_key',
      'brave-key',
      {service: BRAVE_SEARCH_KEYCHAIN_SERVICE},
    );
  });

  it('does not save an empty key', async () => {
    const saved = await saveBraveSearchApiKey('   ');

    expect(saved).toBe(false);
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it('loads and normalizes the Brave Search API key', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
      username: 'brave_search_api_key',
      password: '  brave-key  ',
    });

    await expect(getBraveSearchApiKey()).resolves.toBe('brave-key');
    await expect(hasBraveSearchApiKey()).resolves.toBe(true);
  });

  it('returns an empty string when no key is stored', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

    await expect(getBraveSearchApiKey()).resolves.toBe('');
    await expect(hasBraveSearchApiKey()).resolves.toBe(false);
  });

  it('clears the Brave Search API key', async () => {
    const cleared = await clearBraveSearchApiKey();

    expect(cleared).toBe(true);
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
      service: BRAVE_SEARCH_KEYCHAIN_SERVICE,
    });
  });

  it('saves and loads the mail bridge token in Keychain', async () => {
    const saved = await saveMailBridgeToken('  bridge-token  ');

    expect(saved).toBe(true);
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'mail_bridge_token',
      'bridge-token',
      {service: MAIL_BRIDGE_KEYCHAIN_SERVICE},
    );

    (Keychain.getGenericPassword as jest.Mock)
      .mockResolvedValueOnce({
        username: 'mail_bridge_token',
        password: '  bridge-token  ',
      })
      .mockResolvedValueOnce({
        username: 'mail_bridge_token',
        password: '  bridge-token  ',
      });
    await expect(getMailBridgeToken()).resolves.toBe('bridge-token');
    await expect(hasMailBridgeToken()).resolves.toBe(true);
  });

  it('clears the mail bridge token', async () => {
    const cleared = await clearMailBridgeToken();

    expect(cleared).toBe(true);
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
      service: MAIL_BRIDGE_KEYCHAIN_SERVICE,
    });
  });
});
