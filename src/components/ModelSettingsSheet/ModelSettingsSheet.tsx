import React, {useState, useEffect, memo, useContext} from 'react';
import {
  Button,
  Text,
  Divider,
  Switch,
  SegmentedButtons,
} from 'react-native-paper';

import {ModelSettings} from '../../screens/ModelsScreen/ModelSettings';
import {Sheet} from '../Sheet';
import {ProjectionModelSelector} from '../ProjectionModelSelector';
import {TextInput} from '../TextInput';
import {CacheType, ModelOrigin} from '../../utils/types';
import type {ContextInitParams, Model} from '../../utils/types';
import {modelStore} from '../../store';
import {chatTemplates} from '../../utils/chat';

import {styles} from './styles';
import {View} from 'react-native';
import {L10nContext} from '../../utils';

const CACHE_TYPES = Object.values(CacheType);
const PROFILE_NUMBER_KEYS = [
  'n_ctx',
  'n_batch',
  'n_ubatch',
  'n_threads',
  'n_gpu_layers',
  'image_max_tokens',
  'n_parallel',
] as const;

type ProfileNumberKey = (typeof PROFILE_NUMBER_KEYS)[number];
type ProfileNumberDrafts = Partial<Record<ProfileNumberKey, string>>;

interface ModelSettingsSheetProps {
  isVisible: boolean;
  onClose: () => void;
  model?: Model;
}

function parsePositiveInteger(value: string, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.floor(numeric)
    : fallback;
}

function getProfileNumberDrafts(
  settings: ContextInitParams,
): ProfileNumberDrafts {
  return PROFILE_NUMBER_KEYS.reduce((drafts, key) => {
    const value = settings[key];
    if (typeof value === 'number') {
      drafts[key] = String(value);
    }
    return drafts;
  }, {} as ProfileNumberDrafts);
}

function resolveProfileNumberDrafts(
  settings: ContextInitParams,
  drafts: ProfileNumberDrafts,
): ContextInitParams {
  return PROFILE_NUMBER_KEYS.reduce(
    (nextSettings, key) => {
      const draft = drafts[key];
      if (draft === undefined || draft.trim() === '') {
        return nextSettings;
      }
      const currentValue = nextSettings[key];
      const fallback = typeof currentValue === 'number' ? currentValue : 1;
      nextSettings[key] = parsePositiveInteger(draft, fallback) as any;
      return nextSettings;
    },
    {...settings},
  );
}

export const ModelSettingsSheet: React.FC<ModelSettingsSheetProps> = memo(
  ({isVisible, onClose, model}) => {
    const [tempModelName, setTempModelName] = useState(model?.name || '');
    const [tempChatTemplate, setTempChatTemplate] = useState(
      model?.chatTemplate || chatTemplates.default,
    );
    const [tempStopWords, setTempStopWords] = useState<string[]>(
      model?.stopWords || [],
    );
    const initialProfile = model
      ? modelStore.getModelInitProfileDraft(model.id)
      : undefined;
    const [tempProfileSettings, setTempProfileSettings] =
      useState<ContextInitParams>(
        initialProfile?.settings ?? modelStore.contextInitParams,
      );
    const [profileNumberDrafts, setProfileNumberDrafts] =
      useState<ProfileNumberDrafts>(() =>
        getProfileNumberDrafts(
          initialProfile?.settings ?? modelStore.contextInitParams,
        ),
      );
    const l10n = useContext(L10nContext);

    // Reset temp settings when model changes
    useEffect(() => {
      if (model) {
        setTempModelName(model.name);
        setTempChatTemplate(model.chatTemplate);
        setTempStopWords(model.stopWords || []);
        const profile = modelStore.getModelInitProfileDraft(model.id);
        setTempProfileSettings(profile.settings);
        setProfileNumberDrafts(getProfileNumberDrafts(profile.settings));
      }
    }, [model]);

    const updateProfileSetting = <K extends keyof ContextInitParams>(
      key: K,
      value: ContextInitParams[K],
    ) => {
      setTempProfileSettings(prev => ({
        ...prev,
        [key]: value,
      }));
    };

    const updateProfileNumber = (
      key: ProfileNumberKey,
      value: string,
      fallback: number,
    ) => {
      setProfileNumberDrafts(prev => ({
        ...prev,
        [key]: value,
      }));
      if (value.trim() === '') {
        return;
      }
      const parsedValue = parsePositiveInteger(value, fallback);
      updateProfileSetting(key, parsedValue as any);
    };

    const renderNumberInput = (
      key: ProfileNumberKey,
      label: string,
      fallback: number,
      testID: string,
    ) => (
      <TextInput
        testID={testID}
        label={label}
        keyboardType="number-pad"
        value={
          profileNumberDrafts[key] ??
          String(tempProfileSettings[key] ?? fallback)
        }
        onChangeText={value => updateProfileNumber(key, value, fallback)}
        style={styles.profileInput}
      />
    );

    const renderCacheSelector = (
      label: string,
      field: 'cache_type_k' | 'cache_type_v',
      testID: string,
    ) => (
      <View style={styles.profileSettingBlock}>
        <Text variant="labelLarge" style={styles.profileLabel}>
          {label}
        </Text>
        <View style={styles.profileChipRow} testID={testID}>
          {CACHE_TYPES.map(type => (
            <Button
              key={type}
              compact
              mode={
                tempProfileSettings[field] === type ? 'contained' : 'outlined'
              }
              onPress={() => updateProfileSetting(field, type as any)}>
              {type}
            </Button>
          ))}
        </View>
      </View>
    );

    const handleSettingsUpdate = (name: string, value: any) => {
      setTempChatTemplate(prev => {
        const newTemplate =
          name === 'name' ? chatTemplates[value] : {...prev, [name]: value};
        return newTemplate;
      });
    };

    const handleModelNameChange = (name: string) => {
      setTempModelName(name);
    };

    const handleSaveSettings = () => {
      if (model) {
        modelStore.updateModelName(model.id, tempModelName);
        modelStore.updateModelChatTemplate(model.id, tempChatTemplate);
        modelStore.updateModelStopWords(model.id, tempStopWords);
        if (model.origin !== ModelOrigin.REMOTE) {
          const resolvedProfileSettings = resolveProfileNumberDrafts(
            tempProfileSettings,
            profileNumberDrafts,
          );
          modelStore.saveModelInitProfileSettings(
            model.id,
            resolvedProfileSettings,
            true,
            'manual',
            resolvedProfileSettings.n_ctx,
          );
        }
        onClose();
      }
    };

    const handleCancelSettings = () => {
      if (model) {
        // Reset to store values
        setTempModelName(model.name);
        setTempChatTemplate(model.chatTemplate);
        setTempStopWords(model.stopWords || []);
        const profile = modelStore.getModelInitProfileDraft(model.id);
        setTempProfileSettings(profile.settings);
        setProfileNumberDrafts(getProfileNumberDrafts(profile.settings));
      }
      onClose();
    };

    const handleReset = () => {
      if (model) {
        // Reset to model default values
        modelStore.resetModelName(model.id);
        modelStore.resetModelChatTemplate(model.id);
        modelStore.resetModelStopWords(model.id);
        modelStore.clearModelInitProfile(model.id);
        setTempModelName(model.name);
        setTempChatTemplate(model.chatTemplate);
        setTempStopWords(model.stopWords || []);
        const profile = modelStore.getModelInitProfileDraft(model.id);
        setTempProfileSettings(profile.settings);
        setProfileNumberDrafts(getProfileNumberDrafts(profile.settings));
      }
    };

    if (!model) {
      return null;
    }

    return (
      <Sheet
        isVisible={isVisible}
        onClose={handleCancelSettings}
        title={l10n.components.modelSettingsSheet.modelSettings}
        displayFullHeight>
        <Sheet.ScrollView
          bottomOffset={16}
          contentContainerStyle={styles.sheetScrollViewContainer}>
          <ModelSettings
            modelName={tempModelName}
            chatTemplate={tempChatTemplate}
            stopWords={tempStopWords}
            onChange={handleSettingsUpdate}
            onStopWordsChange={value => setTempStopWords(value || [])}
            onModelNameChange={handleModelNameChange}
          />

          {model.origin !== ModelOrigin.REMOTE && (
            <>
              <Divider style={styles.multimodalDivider} />
              <Text style={styles.multimodalSectionTitle}>Load profile</Text>
              <Text style={styles.profileDescription}>
                Saved per-model settings are applied automatically before this
                model loads. Changes here do not require loading the model
                first.
              </Text>
              <View style={styles.profileGrid}>
                {renderNumberInput('n_ctx', 'Context', 2048, 'profile-n-ctx')}
                {renderNumberInput('n_batch', 'Batch', 512, 'profile-n-batch')}
                {renderNumberInput(
                  'n_ubatch',
                  'Physical batch',
                  512,
                  'profile-n-ubatch',
                )}
                {renderNumberInput(
                  'n_threads',
                  'CPU threads',
                  modelStore.max_threads,
                  'profile-n-threads',
                )}
                {renderNumberInput(
                  'n_gpu_layers',
                  'GPU layers',
                  99,
                  'profile-n-gpu-layers',
                )}
                {renderNumberInput(
                  'image_max_tokens',
                  'Image tokens',
                  512,
                  'profile-image-max-tokens',
                )}
              </View>
              <View style={styles.profileSettingBlock}>
                <Text variant="labelLarge" style={styles.profileLabel}>
                  Flash attention
                </Text>
                <View testID="profile-flash-attn">
                  <SegmentedButtons
                    density="high"
                    value={tempProfileSettings.flash_attn_type ?? 'auto'}
                    onValueChange={value =>
                      updateProfileSetting(
                        'flash_attn_type',
                        value as 'auto' | 'on' | 'off',
                      )
                    }
                    buttons={[
                      {value: 'auto', label: 'Auto'},
                      {value: 'on', label: 'On'},
                      {value: 'off', label: 'Off'},
                    ]}
                  />
                </View>
              </View>
              {renderCacheSelector(
                'Key cache',
                'cache_type_k',
                'profile-cache-k',
              )}
              {renderCacheSelector(
                'Value cache',
                'cache_type_v',
                'profile-cache-v',
              )}
              <View style={styles.profileSwitchRow}>
                <Text>Use mmap</Text>
                <Switch
                  testID="profile-use-mmap"
                  value={tempProfileSettings.use_mmap === 'true'}
                  onValueChange={value =>
                    updateProfileSetting('use_mmap', value ? 'true' : 'false')
                  }
                />
              </View>
              <View style={styles.profileSwitchRow}>
                <Text>Use mlock</Text>
                <Switch
                  testID="profile-use-mlock"
                  value={tempProfileSettings.use_mlock}
                  onValueChange={value =>
                    updateProfileSetting('use_mlock', value)
                  }
                />
              </View>
              <View style={styles.profileSwitchRow}>
                <Text>Unified KV cache</Text>
                <Switch
                  testID="profile-kv-unified"
                  value={tempProfileSettings.kv_unified ?? true}
                  onValueChange={value =>
                    updateProfileSetting('kv_unified', value)
                  }
                />
              </View>
            </>
          )}

          {/* Multimodal Settings Section */}
          {model.supportsMultimodal && (
            <>
              <Divider style={styles.multimodalDivider} />
              <Text style={styles.multimodalSectionTitle}>
                {l10n.models.multimodal.settings}
              </Text>
              <ProjectionModelSelector
                model={model}
                onProjectionModelSelect={projectionModelId => {
                  modelStore.setDefaultProjectionModel(
                    model.id,
                    projectionModelId,
                  );
                }}
              />
            </>
          )}
        </Sheet.ScrollView>
        <Sheet.Actions>
          <View style={styles.secondaryButtons}>
            <Button mode="text" onPress={handleReset}>
              {l10n.common.reset}
            </Button>
            <Button mode="text" onPress={handleCancelSettings}>
              {l10n.common.cancel}
            </Button>
          </View>
          <Button mode="contained" onPress={handleSaveSettings}>
            {l10n.components.modelSettingsSheet.saveChanges}
          </Button>
        </Sheet.Actions>
      </Sheet>
    );
  },
);
