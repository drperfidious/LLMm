import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {Keyboard, ScrollView, View} from 'react-native';
import {observer} from 'mobx-react';

import {SafeAreaView} from 'react-native-safe-area-context';
import {
  Button,
  Switch,
  Text,
  TextInput as PaperTextInput,
} from 'react-native-paper';

import {
  AlertIcon,
  CheckCircleIcon,
  CodeIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  LockIcon,
  SearchIcon,
  TrashIcon,
} from '../../assets/icons';
import {TextInput} from '../../components';
import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';
import {
  clearBraveSearchApiKey,
  clearMailBridgeToken,
  clearSearchProviderApiKey,
  checkMailBridgeStatus,
  hasBraveSearchApiKey,
  hasMailBridgeToken,
  hasSearchProviderApiKey,
  registerDefaultTalents,
  saveBraveSearchApiKey,
  saveMailBridgeToken,
  saveSearchProviderApiKey,
  talentRegistry,
  validateMailBridgeEndpoint,
} from '../../services/talents';
import {
  MAIL_PROVIDER_LABELS,
  SEARCH_PROVIDER_LABELS,
  talentStore,
  type CustomTalentDefinition,
  type MailProviderId,
  type SearchProviderId,
} from '../../store/TalentStore';

import {createStyles} from './styles';

type SvgIcon = React.ComponentType<{
  width?: number;
  height?: number;
  stroke?: string;
}>;

const TALENT_ICONS: Record<string, SvgIcon> = {
  render_html: CodeIcon,
  calculate: CodeIcon,
  datetime: CheckCircleIcon,
  sms_draft: LockIcon,
  mail_draft: LockIcon,
  mail_search: LockIcon,
  mail_read: LockIcon,
  mail_send: LockIcon,
  web_search: SearchIcon,
  deep_research: SearchIcon,
  create_talent: CodeIcon,
  workspace_list: CodeIcon,
  workspace_read: CodeIcon,
  workspace_write: CodeIcon,
  workspace_delete: TrashIcon,
  workspace_search: SearchIcon,
  workspace_shell: CodeIcon,
};

type InstallableTalent = Partial<CustomTalentDefinition> & {
  prompt?: string;
  systemPrompt?: string;
};
type InstalledTalentDefinition = Partial<CustomTalentDefinition> & {
  instructions: string;
};

function splitKeywords(text: string): string[] {
  return text
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readInstallPayload(jsonText: string): InstalledTalentDefinition[] {
  const parsed = JSON.parse(jsonText);
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.talents)
      ? parsed.talents
      : [parsed];

  return candidates.map((candidate: InstallableTalent, index: number) => {
    const title = pickString(candidate.title ?? candidate.name);
    const instructions = pickString(
      candidate.instructions ?? candidate.prompt ?? candidate.systemPrompt,
    );
    if (!title || !instructions) {
      throw new Error(
        `Talent ${index + 1} needs a title/name and instructions field.`,
      );
    }

    return {
      name: pickString(candidate.name) || title,
      title,
      description:
        pickString(candidate.description) || `Installed talent: ${title}`,
      instructions,
      keywords: Array.isArray(candidate.keywords)
        ? candidate.keywords
        : splitKeywords(pickString(candidate.keywords)),
      source: 'installed',
    };
  });
}

export const TalentsScreen: React.FC = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const l10n = useContext(L10nContext);
  const copy = l10n.talents;

  const [webKey, setWebKey] = useState('');
  const [webKeyConfigured, setWebKeyConfigured] = useState(false);
  const [mailToken, setMailToken] = useState('');
  const [mailTokenConfigured, setMailTokenConfigured] = useState(false);
  const [isLoadingSecret, setIsLoadingSecret] = useState(true);
  const [isSavingSecret, setIsSavingSecret] = useState(false);
  const [isLoadingMailSecret, setIsLoadingMailSecret] = useState(true);
  const [isSavingMailSecret, setIsSavingMailSecret] = useState(false);
  const [isTestingMailBridge, setIsTestingMailBridge] = useState(false);
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [mailSecureTextEntry, setMailSecureTextEntry] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusTone, setStatusTone] = useState<'default' | 'error' | 'success'>(
    'default',
  );
  const [mailStatusMessage, setMailStatusMessage] = useState('');
  const [mailStatusTone, setMailStatusTone] = useState<
    'default' | 'error' | 'success'
  >('default');
  const [customTitle, setCustomTitle] = useState('');
  const [customKeywords, setCustomKeywords] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [installJson, setInstallJson] = useState('');

  const talents = useMemo(() => {
    registerDefaultTalents();
    const builtIns = talentRegistry.getAll().map(engine => ({
      name: engine.name,
      isCustom: false,
    }));
    const custom = talentStore.customTalents.map(talent => ({
      name: talent.name,
      isCustom: true,
    }));
    return [...builtIns, ...custom];
  }, [talentStore.customTalents.length]);

  const provider = talentStore.webSearchSettings.provider;
  const mailProvider = talentStore.mailBridgeSettings.provider;
  const isDirectMailProvider = mailProvider !== 'custom_bridge';
  const endpointConfigured =
    !!talentStore.webSearchSettings.endpoint?.trim() &&
    (provider === 'searxng' || provider === 'mcp_http');
  const providerConfigured =
    provider === 'searxng' || provider === 'mcp_http'
      ? endpointConfigured
      : webKeyConfigured;
  const mailEndpointValidation = validateMailBridgeEndpoint(
    talentStore.mailBridgeSettings.endpoint,
  );

  const refreshWebKeyStatus = useCallback(async () => {
    setIsLoadingSecret(true);
    const configured =
      provider === 'brave'
        ? await hasBraveSearchApiKey()
        : await hasSearchProviderApiKey(provider);
    setWebKeyConfigured(configured);
    setIsLoadingSecret(false);
  }, [provider]);

  useEffect(() => {
    refreshWebKeyStatus();
  }, [refreshWebKeyStatus]);

  const refreshMailTokenStatus = useCallback(async () => {
    setIsLoadingMailSecret(true);
    setMailTokenConfigured(await hasMailBridgeToken());
    setIsLoadingMailSecret(false);
  }, []);

  useEffect(() => {
    refreshMailTokenStatus();
  }, [refreshMailTokenStatus]);

  const handleProviderChange = (nextProvider: SearchProviderId) => {
    talentStore.updateWebSearchSettings({provider: nextProvider});
    setWebKey('');
    setStatusMessage('');
    setStatusTone('default');
  };

  const handleMailProviderChange = (nextProvider: MailProviderId) => {
    const current = talentStore.mailBridgeSettings;
    if (nextProvider === 'gmail') {
      talentStore.updateMailBridgeSettings({
        provider: nextProvider,
        username: current.username || current.accountEmail,
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecurity: 'ssl',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecurity: 'ssl',
        inboxFolder: 'INBOX',
        sentFolder: '[Gmail]/Sent Mail',
      });
    } else if (nextProvider === 'imap_smtp') {
      talentStore.updateMailBridgeSettings({
        provider: nextProvider,
        sentFolder:
          current.provider === 'gmail' ? 'Sent' : current.sentFolder || 'Sent',
      });
    } else {
      talentStore.updateMailBridgeSettings({
        provider: nextProvider,
        sentFolder: current.sentFolder || 'Sent',
      });
    }
    setMailToken('');
    setMailStatusMessage('');
    setMailStatusTone('default');
  };

  const handleSaveWebKey = async () => {
    const nextKey = webKey.trim();
    if (!nextKey) {
      setStatusTone('error');
      setStatusMessage(copy.webSearch.emptyKey);
      return;
    }

    Keyboard.dismiss();
    setIsSavingSecret(true);
    const saved =
      provider === 'brave'
        ? await saveBraveSearchApiKey(nextKey)
        : await saveSearchProviderApiKey(provider, nextKey);
    setIsSavingSecret(false);

    if (saved) {
      setWebKey('');
      setWebKeyConfigured(true);
      setStatusTone('success');
      setStatusMessage(copy.webSearch.saved);
    } else {
      setStatusTone('error');
      setStatusMessage(copy.webSearch.saveFailed);
    }
  };

  const handleClearWebKey = async () => {
    Keyboard.dismiss();
    setIsSavingSecret(true);
    const cleared =
      provider === 'brave'
        ? await clearBraveSearchApiKey()
        : await clearSearchProviderApiKey(provider);
    setIsSavingSecret(false);

    if (cleared) {
      setWebKey('');
      setWebKeyConfigured(false);
      setStatusTone('success');
      setStatusMessage(copy.webSearch.cleared);
    } else {
      setStatusTone('error');
      setStatusMessage(copy.webSearch.clearFailed);
    }
  };

  const handleSaveMailToken = async () => {
    const nextToken = mailToken.trim();
    if (!nextToken) {
      setMailStatusTone('error');
      setMailStatusMessage(
        isDirectMailProvider
          ? 'Enter the mail account password or app password first.'
          : 'Enter a bridge token first.',
      );
      return;
    }

    Keyboard.dismiss();
    setIsSavingMailSecret(true);
    const saved = await saveMailBridgeToken(nextToken);
    setIsSavingMailSecret(false);

    if (saved) {
      setMailToken('');
      setMailTokenConfigured(true);
      setMailStatusTone('success');
      setMailStatusMessage(
        isDirectMailProvider
          ? 'Saved mail account credential.'
          : 'Saved mail bridge token.',
      );
    } else {
      setMailStatusTone('error');
      setMailStatusMessage(
        isDirectMailProvider
          ? 'Could not save mail account credential.'
          : 'Could not save mail bridge token.',
      );
    }
  };

  const handleClearMailToken = async () => {
    Keyboard.dismiss();
    setIsSavingMailSecret(true);
    const cleared = await clearMailBridgeToken();
    setIsSavingMailSecret(false);

    if (cleared) {
      setMailToken('');
      setMailTokenConfigured(false);
      setMailStatusTone('success');
      setMailStatusMessage(
        isDirectMailProvider
          ? 'Cleared mail account credential.'
          : 'Cleared mail bridge token.',
      );
    } else {
      setMailStatusTone('error');
      setMailStatusMessage(
        isDirectMailProvider
          ? 'Could not clear mail account credential.'
          : 'Could not clear mail bridge token.',
      );
    }
  };

  const handleTestMailBridge = async () => {
    Keyboard.dismiss();
    if (!isDirectMailProvider && !mailEndpointValidation.ok) {
      setMailStatusTone('error');
      setMailStatusMessage(mailEndpointValidation.errorMessage);
      return;
    }
    setIsTestingMailBridge(true);
    setMailStatusTone('default');
    setMailStatusMessage('Checking mail bridge...');

    const result = await checkMailBridgeStatus();
    setIsTestingMailBridge(false);
    if (result.type === 'error') {
      setMailStatusTone('error');
      setMailStatusMessage(result.errorMessage || result.summary);
      return;
    }
    setMailStatusTone('success');
    setMailStatusMessage(result.summary);
  };

  const handleCreateCustomTalent = () => {
    try {
      const talent = talentStore.addCustomTalent({
        title: customTitle,
        description: `Custom talent: ${customTitle}`,
        instructions: customInstructions,
        keywords: splitKeywords(customKeywords),
        source: 'custom',
      });
      setCustomTitle('');
      setCustomKeywords('');
      setCustomInstructions('');
      setStatusTone('success');
      setStatusMessage(`Saved custom talent ${talent.title}.`);
    } catch (error) {
      setStatusTone('error');
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleInstallTalentJson = () => {
    try {
      const talentsToInstall = readInstallPayload(installJson);
      const installed = talentsToInstall.map(talent =>
        talentStore.addCustomTalent(talent),
      );
      setInstallJson('');
      setStatusTone('success');
      setStatusMessage(
        `Installed ${installed.length} talent${
          installed.length === 1 ? '' : 's'
        }.`,
      );
    } catch (error) {
      setStatusTone('error');
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const renderTalent = (engine: {name: string; isCustom: boolean}) => {
    const names = l10n.components.palSheet.talentNames;
    const descriptions = l10n.components.palSheet.talentDescriptions;
    const Icon = TALENT_ICONS[engine.name] ?? CodeIcon;
    const manifest = talentStore.getManifest(engine.name);
    const settings = talentStore.getSettings(engine.name);
    const title =
      names[engine.name as keyof typeof names] ??
      manifest?.title ??
      engine.name;
    const description =
      descriptions[engine.name as keyof typeof descriptions] ??
      manifest?.description ??
      '';

    return (
      <View
        key={engine.name}
        style={styles.talentRow}
        testID={`talents-row-${engine.name}`}>
        <View style={styles.talentIcon}>
          <Icon width={20} height={20} stroke={theme.colors.primary} />
        </View>
        <View style={styles.talentContent}>
          <View style={styles.talentTitleRow}>
            <Text variant="titleSmall" style={styles.talentTitle}>
              {title}
            </Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {engine.isCustom
                  ? 'Custom'
                  : settings.enabled && settings.agentDefault
                    ? copy.defaultAgentBadge
                    : copy.palOptInBadge}
              </Text>
            </View>
          </View>
          <Text variant="bodySmall" style={styles.talentDescription}>
            {description}
          </Text>
          <Text variant="bodySmall" style={styles.keywordText}>
            {settings.keywords.slice(0, 8).join(', ')}
          </Text>
          <TextInput
            testID={`talents-keywords-${engine.name}`}
            label="Route keywords"
            value={settings.keywords.join(', ')}
            onChangeText={text =>
              talentStore.setTalentKeywords(engine.name, splitKeywords(text))
            }
            style={styles.input}
          />
          <View style={styles.toggleRow}>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleLabel}>Enabled</Text>
              <Switch
                value={settings.enabled}
                onValueChange={value =>
                  talentStore.setTalentEnabled(engine.name, value)
                }
              />
            </View>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleLabel}>Agent default</Text>
              <Switch
                value={settings.agentDefault}
                disabled={!settings.enabled}
                onValueChange={value =>
                  talentStore.setTalentAgentDefault(engine.name, value)
                }
              />
            </View>
            {engine.isCustom ? (
              <Button
                compact
                mode="text"
                onPress={() => talentStore.removeCustomTalent(engine.name)}>
                Remove
              </Button>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  const configuredLabel = isLoadingSecret
    ? copy.webSearch.checking
    : providerConfigured
      ? copy.webSearch.configured
      : copy.webSearch.notConfigured;
  const mailEndpointConfigured = isDirectMailProvider
    ? true
    : mailEndpointValidation.ok;
  const mailIdentityConfigured =
    !isDirectMailProvider ||
    (!!talentStore.mailBridgeSettings.accountEmail.trim() &&
      !!talentStore.mailBridgeSettings.imapHost.trim() &&
      !!talentStore.mailBridgeSettings.smtpHost.trim() &&
      mailTokenConfigured);
  const mailFullyConfigured = mailEndpointConfigured && mailIdentityConfigured;
  const mailConfiguredLabel = isLoadingMailSecret
    ? 'Checking'
    : mailFullyConfigured
      ? 'Ready'
      : mailEndpointConfigured
        ? isDirectMailProvider
          ? mailTokenConfigured
            ? 'Needs account'
            : 'Needs password'
          : mailTokenConfigured
            ? 'Ready'
            : 'Endpoint set'
        : 'Not configured';

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        testID="talents-screen"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text variant="headlineSmall" style={styles.title}>
            {copy.title}
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            {copy.subtitle}
          </Text>
        </View>

        <View style={styles.summaryBand}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{talents.length}</Text>
            <Text style={styles.summaryLabel}>{copy.installed}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>
              {talentStore.getDefaultAgentTalentNames().length}
            </Text>
            <Text style={styles.summaryLabel}>Agent defaults</Text>
          </View>
        </View>

        <View style={styles.section} testID="talents-web-search-section">
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <GlobeIcon width={22} height={22} stroke={theme.colors.primary} />
              <Text variant="titleMedium" style={styles.sectionTitle}>
                {copy.webSearch.title}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                providerConfigured
                  ? styles.statusPillReady
                  : styles.statusPillMissing,
              ]}>
              {providerConfigured ? (
                <CheckCircleIcon
                  width={14}
                  height={14}
                  stroke={theme.colors.primary}
                />
              ) : (
                <AlertIcon width={14} height={14} stroke={theme.colors.error} />
              )}
              <Text
                testID="talents-web-search-status"
                style={[
                  styles.statusPillText,
                  !providerConfigured && styles.statusPillTextMissing,
                ]}>
                {configuredLabel}
              </Text>
            </View>
          </View>

          <TextInput
            testID="talents-web-search-key-input"
            label={
              provider === 'searxng' || provider === 'mcp_http'
                ? `Optional ${SEARCH_PROVIDER_LABELS[provider]} bearer token`
                : `${SEARCH_PROVIDER_LABELS[provider]} API key`
            }
            value={webKey}
            onChangeText={text => {
              setWebKey(text);
              setStatusMessage('');
              setStatusTone('default');
            }}
            placeholder={
              webKeyConfigured
                ? copy.webSearch.replacePlaceholder
                : copy.webSearch.placeholder
            }
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            secureTextEntry={secureTextEntry}
            style={styles.input}
            right={
              <PaperTextInput.Icon
                testID="talents-web-search-key-toggle"
                icon={({color}) =>
                  secureTextEntry ? (
                    <EyeIcon width={24} height={24} stroke={color} />
                  ) : (
                    <EyeOffIcon width={24} height={24} stroke={color} />
                  )
                }
                onPress={() => setSecureTextEntry(value => !value)}
              />
            }
          />

          <Text variant="bodySmall" style={styles.helperText}>
            {copy.webSearch.storageNote}
          </Text>

          <View style={styles.providerWrap}>
            {(Object.keys(SEARCH_PROVIDER_LABELS) as SearchProviderId[]).map(
              providerId => (
                <Button
                  key={providerId}
                  compact
                  mode={provider === providerId ? 'contained' : 'outlined'}
                  onPress={() => handleProviderChange(providerId)}
                  style={styles.providerButton}>
                  {SEARCH_PROVIDER_LABELS[providerId]}
                </Button>
              ),
            )}
          </View>

          <View style={styles.compactInputRow}>
            <TextInput
              testID="talents-web-search-count-input"
              label="Results"
              keyboardType="number-pad"
              value={String(talentStore.webSearchSettings.count)}
              onChangeText={value =>
                talentStore.updateWebSearchSettings({count: Number(value)})
              }
              style={styles.compactInput}
            />
            <TextInput
              testID="talents-web-search-country-input"
              label="Country/region"
              placeholder="US, CA, GB, ALL"
              value={talentStore.webSearchSettings.country}
              autoCapitalize="characters"
              onChangeText={country =>
                talentStore.updateWebSearchSettings({country})
              }
              style={styles.compactInput}
            />
            <TextInput
              testID="talents-web-search-lang-input"
              label="Language"
              value={talentStore.webSearchSettings.search_lang}
              autoCapitalize="none"
              onChangeText={search_lang =>
                talentStore.updateWebSearchSettings({search_lang})
              }
              style={styles.compactInput}
            />
          </View>

          {provider === 'mcp_http' || provider === 'searxng' ? (
            <>
              <TextInput
                testID="talents-web-search-endpoint-input"
                label={
                  provider === 'searxng'
                    ? 'SearXNG base URL'
                    : 'MCP HTTP endpoint'
                }
                value={talentStore.webSearchSettings.endpoint ?? ''}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={endpoint =>
                  talentStore.updateWebSearchSettings({endpoint})
                }
                style={styles.input}
              />
              {provider === 'mcp_http' ? (
                <TextInput
                  testID="talents-web-search-tool-input"
                  label="MCP tool name"
                  value={talentStore.webSearchSettings.mcpToolName ?? ''}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={mcpToolName =>
                    talentStore.updateWebSearchSettings({mcpToolName})
                  }
                  style={styles.input}
                />
              ) : (
                <>
                  <View style={styles.compactInputRow}>
                    <TextInput
                      testID="talents-web-search-categories-input"
                      label="Categories"
                      value={talentStore.webSearchSettings.categories ?? ''}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={categories =>
                        talentStore.updateWebSearchSettings({categories})
                      }
                      style={styles.compactInput}
                    />
                    <TextInput
                      testID="talents-web-search-engines-input"
                      label="Engines"
                      value={talentStore.webSearchSettings.engines ?? ''}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={engines =>
                        talentStore.updateWebSearchSettings({engines})
                      }
                      style={styles.compactInput}
                    />
                  </View>
                  <View style={styles.compactInputRow}>
                    <TextInput
                      testID="talents-web-search-time-range-input"
                      label="Time range"
                      placeholder="day, month, year"
                      value={talentStore.webSearchSettings.time_range ?? ''}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={time_range =>
                        talentStore.updateWebSearchSettings({
                          time_range: time_range as
                            | 'day'
                            | 'month'
                            | 'year'
                            | '',
                        })
                      }
                      style={styles.compactInput}
                    />
                    <TextInput
                      testID="talents-web-search-safesearch-input"
                      label="Safesearch"
                      placeholder="0, 1, 2"
                      value={talentStore.webSearchSettings.safesearch ?? '1'}
                      keyboardType="number-pad"
                      onChangeText={safesearch =>
                        talentStore.updateWebSearchSettings({
                          safesearch: safesearch as '0' | '1' | '2',
                        })
                      }
                      style={styles.compactInput}
                    />
                  </View>
                </>
              )}
            </>
          ) : null}

          {statusMessage ? (
            <Text
              testID="talents-web-search-message"
              style={[
                styles.statusMessage,
                statusTone === 'error' && styles.statusMessageError,
                statusTone === 'success' && styles.statusMessageSuccess,
              ]}>
              {statusMessage}
            </Text>
          ) : null}

          <View style={styles.actionRow}>
            <Button
              testID="talents-web-search-save"
              mode="contained"
              onPress={handleSaveWebKey}
              loading={isSavingSecret}
              disabled={isSavingSecret || !webKey.trim()}
              style={styles.primaryButton}>
              {copy.webSearch.saveKey}
            </Button>
            <Button
              testID="talents-web-search-clear"
              mode="outlined"
              onPress={handleClearWebKey}
              disabled={isSavingSecret || !webKeyConfigured}>
              {copy.webSearch.clearKey}
            </Button>
          </View>
        </View>

        <View style={styles.section} testID="talents-mail-section">
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <LockIcon width={22} height={22} stroke={theme.colors.primary} />
              <Text variant="titleMedium" style={styles.sectionTitle}>
                Mail account
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                mailFullyConfigured
                  ? styles.statusPillReady
                  : styles.statusPillMissing,
              ]}>
              {mailFullyConfigured ? (
                <CheckCircleIcon
                  width={14}
                  height={14}
                  stroke={theme.colors.primary}
                />
              ) : (
                <AlertIcon width={14} height={14} stroke={theme.colors.error} />
              )}
              <Text
                testID="talents-mail-status"
                style={[
                  styles.statusPillText,
                  !mailFullyConfigured && styles.statusPillTextMissing,
                ]}>
                {mailConfiguredLabel}
              </Text>
            </View>
          </View>

          <View style={styles.providerWrap}>
            {(Object.keys(MAIL_PROVIDER_LABELS) as MailProviderId[]).map(
              providerId => (
                <Button
                  key={providerId}
                  compact
                  mode={mailProvider === providerId ? 'contained' : 'outlined'}
                  onPress={() => handleMailProviderChange(providerId)}
                  style={styles.providerButton}>
                  {MAIL_PROVIDER_LABELS[providerId]}
                </Button>
              ),
            )}
          </View>

          {!isDirectMailProvider ? (
            <>
              <TextInput
                testID="talents-mail-endpoint-input"
                label="Bridge endpoint"
                placeholder="https://mail.example.com"
                value={talentStore.mailBridgeSettings.endpoint}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={endpoint =>
                  talentStore.updateMailBridgeSettings({endpoint})
                }
                style={styles.input}
              />
              <Text
                testID="talents-mail-endpoint-help"
                variant="bodySmall"
                style={[
                  styles.helperText,
                  talentStore.mailBridgeSettings.endpoint.trim() &&
                  !mailEndpointValidation.ok
                    ? styles.statusMessageError
                    : undefined,
                ]}>
                {talentStore.mailBridgeSettings.endpoint.trim() &&
                !mailEndpointValidation.ok
                  ? mailEndpointValidation.errorMessage
                  : 'Use an LLMm-compatible HTTP(S) bridge base URL. The bridge should expose /mail/status, /mail/search, /mail/read, and /mail/send.'}
              </Text>
            </>
          ) : null}
          <TextInput
            testID="talents-mail-account-input"
            label="Account email"
            value={talentStore.mailBridgeSettings.accountEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={accountEmail =>
              talentStore.updateMailBridgeSettings({accountEmail})
            }
            style={styles.input}
          />

          {isDirectMailProvider ? (
            <>
              <TextInput
                testID="talents-mail-username-input"
                label="Login username"
                placeholder="Blank uses account email"
                value={talentStore.mailBridgeSettings.username}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onChangeText={username =>
                  talentStore.updateMailBridgeSettings({username})
                }
                style={styles.input}
              />

              <View style={styles.compactInputRow}>
                <TextInput
                  testID="talents-mail-imap-host-input"
                  label="IMAP host"
                  value={talentStore.mailBridgeSettings.imapHost}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={imapHost =>
                    talentStore.updateMailBridgeSettings({imapHost})
                  }
                  style={styles.compactInput}
                />
                <TextInput
                  testID="talents-mail-imap-port-input"
                  label="Port"
                  keyboardType="number-pad"
                  value={String(talentStore.mailBridgeSettings.imapPort)}
                  onChangeText={imapPort =>
                    talentStore.updateMailBridgeSettings({
                      imapPort: Number(imapPort),
                    })
                  }
                  style={styles.compactInput}
                />
                <TextInput
                  testID="talents-mail-imap-security-input"
                  label="Security"
                  placeholder="ssl"
                  value={talentStore.mailBridgeSettings.imapSecurity}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={imapSecurity =>
                    talentStore.updateMailBridgeSettings({
                      imapSecurity: imapSecurity as 'ssl' | 'starttls' | 'none',
                    })
                  }
                  style={styles.compactInput}
                />
              </View>

              <View style={styles.compactInputRow}>
                <TextInput
                  testID="talents-mail-smtp-host-input"
                  label="SMTP host"
                  value={talentStore.mailBridgeSettings.smtpHost}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={smtpHost =>
                    talentStore.updateMailBridgeSettings({smtpHost})
                  }
                  style={styles.compactInput}
                />
                <TextInput
                  testID="talents-mail-smtp-port-input"
                  label="Port"
                  keyboardType="number-pad"
                  value={String(talentStore.mailBridgeSettings.smtpPort)}
                  onChangeText={smtpPort =>
                    talentStore.updateMailBridgeSettings({
                      smtpPort: Number(smtpPort),
                    })
                  }
                  style={styles.compactInput}
                />
                <TextInput
                  testID="talents-mail-smtp-security-input"
                  label="Security"
                  placeholder="ssl"
                  value={talentStore.mailBridgeSettings.smtpSecurity}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={smtpSecurity =>
                    talentStore.updateMailBridgeSettings({
                      smtpSecurity: smtpSecurity as 'ssl' | 'starttls' | 'none',
                    })
                  }
                  style={styles.compactInput}
                />
              </View>
            </>
          ) : null}

          <View style={styles.compactInputRow}>
            <TextInput
              testID="talents-mail-inbox-input"
              label="Inbox folder"
              value={talentStore.mailBridgeSettings.inboxFolder}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={inboxFolder =>
                talentStore.updateMailBridgeSettings({inboxFolder})
              }
              style={styles.compactInput}
            />
            <TextInput
              testID="talents-mail-sent-input"
              label="Sent folder"
              value={talentStore.mailBridgeSettings.sentFolder}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={sentFolder =>
                talentStore.updateMailBridgeSettings({sentFolder})
              }
              style={styles.compactInput}
            />
            <TextInput
              testID="talents-mail-limit-input"
              label="Limit"
              keyboardType="number-pad"
              value={String(talentStore.mailBridgeSettings.defaultLimit)}
              onChangeText={defaultLimit =>
                talentStore.updateMailBridgeSettings({
                  defaultLimit: Number(defaultLimit),
                })
              }
              style={styles.compactInput}
            />
          </View>

          <TextInput
            testID="talents-mail-token-input"
            label={
              mailProvider === 'gmail'
                ? 'Gmail app password'
                : mailProvider === 'imap_smtp'
                  ? 'Mail account password/key'
                  : 'Optional bridge token'
            }
            value={mailToken}
            onChangeText={text => {
              setMailToken(text);
              setMailStatusMessage('');
              setMailStatusTone('default');
            }}
            placeholder={
              mailTokenConfigured
                ? isDirectMailProvider
                  ? 'Enter a new password/key to replace it'
                  : 'Enter a new token to replace it'
                : mailProvider === 'gmail'
                  ? 'Paste Google app password'
                  : ''
            }
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            secureTextEntry={mailSecureTextEntry}
            style={styles.input}
            right={
              <PaperTextInput.Icon
                testID="talents-mail-token-toggle"
                icon={({color}) =>
                  mailSecureTextEntry ? (
                    <EyeIcon width={24} height={24} stroke={color} />
                  ) : (
                    <EyeOffIcon width={24} height={24} stroke={color} />
                  )
                }
                onPress={() => setMailSecureTextEntry(value => !value)}
              />
            }
          />

          <Text variant="bodySmall" style={styles.helperText}>
            {mailProvider === 'gmail'
              ? 'Gmail uses direct on-device IMAP/SMTP. Enable IMAP in Gmail and paste a Google app password; the credential is stored in Keychain and is not sent to an LLMm bridge.'
              : isDirectMailProvider
                ? 'IMAP/SMTP uses direct on-device mail server access. Credentials are stored in Keychain.'
                : 'Search/read/send use the configured bridge. Sending still requires explicit user confirmation before the agent can call mail_send.'}
          </Text>

          {mailStatusMessage ? (
            <Text
              testID="talents-mail-message"
              style={[
                styles.statusMessage,
                mailStatusTone === 'error' && styles.statusMessageError,
                mailStatusTone === 'success' && styles.statusMessageSuccess,
              ]}>
              {mailStatusMessage}
            </Text>
          ) : null}

          <View style={styles.actionRow}>
            <Button
              testID="talents-mail-token-save"
              mode="contained"
              onPress={handleSaveMailToken}
              loading={isSavingMailSecret}
              disabled={isSavingMailSecret || !mailToken.trim()}
              style={styles.primaryButton}>
              {isDirectMailProvider ? 'Save credential' : 'Save token'}
            </Button>
            <Button
              testID="talents-mail-token-clear"
              mode="outlined"
              onPress={handleClearMailToken}
              disabled={isSavingMailSecret || !mailTokenConfigured}>
              Clear
            </Button>
            <Button
              testID="talents-mail-test"
              mode="outlined"
              onPress={handleTestMailBridge}
              loading={isTestingMailBridge}
              disabled={
                isTestingMailBridge ||
                (!isDirectMailProvider && !mailEndpointValidation.ok) ||
                (isDirectMailProvider && !mailIdentityConfigured)
              }>
              {isDirectMailProvider ? 'Test account' : 'Test bridge'}
            </Button>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <CodeIcon width={22} height={22} stroke={theme.colors.primary} />
              <Text variant="titleMedium" style={styles.sectionTitle}>
                Create custom talent
              </Text>
            </View>
          </View>
          <TextInput
            testID="talents-custom-title-input"
            label="Name"
            value={customTitle}
            onChangeText={setCustomTitle}
            style={styles.input}
          />
          <TextInput
            testID="talents-custom-keywords-input"
            label="Keywords"
            placeholder="summarize PDF, research source, format table"
            value={customKeywords}
            onChangeText={setCustomKeywords}
            style={styles.input}
          />
          <TextInput
            testID="talents-custom-instructions-input"
            label="Instructions"
            value={customInstructions}
            onChangeText={setCustomInstructions}
            multiline
            style={[styles.input, styles.multilineInput]}
          />
          <View style={styles.actionRow}>
            <Button
              testID="talents-custom-save"
              mode="contained"
              onPress={handleCreateCustomTalent}
              disabled={!customTitle.trim() || !customInstructions.trim()}
              style={styles.primaryButton}>
              Add talent
            </Button>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <CodeIcon width={22} height={22} stroke={theme.colors.primary} />
              <Text variant="titleMedium" style={styles.sectionTitle}>
                Install talent pack
              </Text>
            </View>
          </View>
          <TextInput
            testID="talents-install-json-input"
            label="Talent JSON"
            placeholder='{"title":"Research brief","instructions":"...","keywords":["research"]}'
            value={installJson}
            onChangeText={setInstallJson}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, styles.multilineInput]}
          />
          <View style={styles.actionRow}>
            <Button
              testID="talents-install-json-save"
              mode="outlined"
              onPress={handleInstallTalentJson}
              disabled={!installJson.trim()}>
              Install JSON
            </Button>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              {copy.availableTitle}
            </Text>
          </View>
          {talents.map(renderTalent)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
});

export default TalentsScreen;
