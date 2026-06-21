import * as Keychain from 'react-native-keychain';

export const BRAVE_SEARCH_KEYCHAIN_SERVICE = 'llmm.talent.brave-search';
export const MAIL_BRIDGE_KEYCHAIN_SERVICE = 'llmm.talent.mail-bridge';
const BRAVE_SEARCH_ACCOUNT = 'brave_search_api_key';
const SEARCH_PROVIDER_ACCOUNT = 'search_provider_api_key';
const MAIL_BRIDGE_ACCOUNT = 'mail_bridge_token';

export type SearchSecretProvider =
  | 'brave'
  | 'tavily'
  | 'serper'
  | 'exa'
  | 'searxng'
  | 'mcp_http';

export const SEARCH_PROVIDER_KEYCHAIN_SERVICES: Record<
  SearchSecretProvider,
  string
> = {
  brave: BRAVE_SEARCH_KEYCHAIN_SERVICE,
  tavily: 'llmm.talent.tavily-search',
  serper: 'llmm.talent.serper-search',
  exa: 'llmm.talent.exa-search',
  searxng: 'llmm.talent.searxng-search',
  mcp_http: 'llmm.talent.mcp-http-search',
};

export function normalizeTalentSecret(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function getBraveSearchApiKey(): Promise<string> {
  return getSearchProviderApiKey('brave');
}

export async function getSearchProviderApiKey(
  provider: SearchSecretProvider,
): Promise<string> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: SEARCH_PROVIDER_KEYCHAIN_SERVICES[provider],
    });
    return credentials ? normalizeTalentSecret(credentials.password) : '';
  } catch (error) {
    console.error(`Failed to load ${provider} Search API key:`, error);
    return '';
  }
}

export async function hasBraveSearchApiKey(): Promise<boolean> {
  return hasSearchProviderApiKey('brave');
}

export async function hasSearchProviderApiKey(
  provider: SearchSecretProvider,
): Promise<boolean> {
  return (await getSearchProviderApiKey(provider)).length > 0;
}

export async function saveBraveSearchApiKey(apiKey: string): Promise<boolean> {
  return saveSearchProviderApiKey('brave', apiKey, BRAVE_SEARCH_ACCOUNT);
}

export async function saveSearchProviderApiKey(
  provider: SearchSecretProvider,
  apiKey: string,
  account = SEARCH_PROVIDER_ACCOUNT,
): Promise<boolean> {
  const normalized = normalizeTalentSecret(apiKey);
  if (!normalized) {
    return false;
  }

  try {
    await Keychain.setGenericPassword(account, normalized, {
      service: SEARCH_PROVIDER_KEYCHAIN_SERVICES[provider],
    });
    return true;
  } catch (error) {
    console.error(`Failed to save ${provider} Search API key:`, error);
    return false;
  }
}

export async function clearBraveSearchApiKey(): Promise<boolean> {
  return clearSearchProviderApiKey('brave');
}

export async function clearSearchProviderApiKey(
  provider: SearchSecretProvider,
): Promise<boolean> {
  try {
    await Keychain.resetGenericPassword({
      service: SEARCH_PROVIDER_KEYCHAIN_SERVICES[provider],
    });
    return true;
  } catch (error) {
    console.error(`Failed to clear ${provider} Search API key:`, error);
    return false;
  }
}

export async function getMailBridgeToken(): Promise<string> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: MAIL_BRIDGE_KEYCHAIN_SERVICE,
    });
    return credentials ? normalizeTalentSecret(credentials.password) : '';
  } catch (error) {
    console.error('Failed to load mail bridge token:', error);
    return '';
  }
}

export async function hasMailBridgeToken(): Promise<boolean> {
  return (await getMailBridgeToken()).length > 0;
}

export async function saveMailBridgeToken(token: string): Promise<boolean> {
  const normalized = normalizeTalentSecret(token);
  if (!normalized) {
    return false;
  }

  try {
    await Keychain.setGenericPassword(MAIL_BRIDGE_ACCOUNT, normalized, {
      service: MAIL_BRIDGE_KEYCHAIN_SERVICE,
    });
    return true;
  } catch (error) {
    console.error('Failed to save mail bridge token:', error);
    return false;
  }
}

export async function clearMailBridgeToken(): Promise<boolean> {
  try {
    await Keychain.resetGenericPassword({
      service: MAIL_BRIDGE_KEYCHAIN_SERVICE,
    });
    return true;
  } catch (error) {
    console.error('Failed to clear mail bridge token:', error);
    return false;
  }
}
