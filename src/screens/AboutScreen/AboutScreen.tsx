import React, {useState, useContext} from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';

import DeviceInfo from 'react-native-device-info';
import Clipboard from '@react-native-clipboard/clipboard';
import {Text, Button, SegmentedButtons} from 'react-native-paper';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {BuildInfo} from 'llama.rn';

import {submitFeedback} from '../../api/feedback';
import {
  DonationProduct,
  getDonationProducts,
  purchaseDonation,
} from '../../services/donations';

import {
  CopyIcon,
  GithubIcon,
  ChevronRightIcon,
  HeartIcon,
} from '../../assets/icons';

import {Sheet, TextInput} from '../../components';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {L10nContext} from '../../utils';
import {
  openReportEmailDraft,
  REPORT_RECIPIENT_EMAIL,
  ReportEmailResult,
} from '../../utils/reportEmail';

const GithubButtonIcon = ({color}: {color: string}) => (
  <GithubIcon stroke={color} />
);

const ChevronRightButtonIcon = ({color}: {color: string}) => (
  <ChevronRightIcon stroke={color} />
);

export const AboutScreen: React.FC = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme, insets);
  const l10n = useContext(L10nContext);
  const [showFeedback, setShowFeedback] = useState(false);
  const [donationProduct, setDonationProduct] =
    useState<DonationProduct | null>(null);
  const [isLoadingDonation, setIsLoadingDonation] = useState(false);
  const [isPurchasingDonation, setIsPurchasingDonation] = useState(false);

  const [appInfo, setAppInfo] = React.useState({
    version: '0.4.0',
    build: '147',
  });

  const [useCase, setUseCase] = useState('');
  const [featureRequests, setFeatureRequests] = useState('');
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [usageFrequency, setUsageFrequency] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    const version = DeviceInfo.getVersion();
    const buildNumber = DeviceInfo.getBuildNumber();
    setAppInfo({
      version,
      build: buildNumber,
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const loadDonationProduct = async () => {
      if (Platform.OS !== 'ios') {
        return;
      }
      setIsLoadingDonation(true);
      try {
        const products = await getDonationProducts();
        if (!cancelled) {
          setDonationProduct(products[0] ?? null);
        }
      } catch {
        if (!cancelled) {
          setDonationProduct(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDonation(false);
        }
      }
    };

    loadDonationProduct();
    return () => {
      cancelled = true;
    };
  }, []);

  const copyVersionToClipboard = () => {
    const versionString = `Version ${appInfo.version} (${appInfo.build})`;
    Clipboard.setString(versionString);
    Alert.alert(
      l10n.about.versionCopiedTitle,
      l10n.about.versionCopiedDescription,
    );
  };

  const clearFeedbackForm = () => {
    setUseCase('');
    setFeatureRequests('');
    setGeneralFeedback('');
    setUsageFrequency('');
  };

  const showEmailFallbackAlert = (
    result: ReportEmailResult,
    onPress?: () => void,
  ) => {
    if (result.openedMailApp) {
      Alert.alert(
        'Email draft opened',
        `Server feedback failed, so a prefilled email to ${REPORT_RECIPIENT_EMAIL} was opened. Send it to forward the report.${
          result.copiedBodyToClipboard
            ? ' The full report was copied to your clipboard because it was too large for the email link.'
            : ''
        }`,
        [{text: l10n.common.ok, onPress}],
      );
      return;
    }

    Alert.alert(
      'Report copied',
      `Server feedback failed and no email app opened. The full report was copied to your clipboard; paste it into an email to ${REPORT_RECIPIENT_EMAIL}.`,
      [{text: l10n.common.ok, onPress}],
    );
  };

  const handleSubmit = async () => {
    if (!useCase && !featureRequests && !generalFeedback) {
      Alert.alert(l10n.feedback.validation.required);
      return;
    }

    setIsSubmitting(true);
    const feedbackPayload = {
      useCase,
      featureRequests,
      generalFeedback,
      usageFrequency,
    };

    try {
      await submitFeedback(feedbackPayload);
      Alert.alert('Success', l10n.feedback.success);
      setShowFeedback(false);
      clearFeedbackForm();
    } catch (error) {
      const emailResult = await openReportEmailDraft({
        reportType: 'feedback',
        subject: 'LLMm feedback report',
        payload: feedbackPayload,
        submissionError: error,
      });
      showEmailFallbackAlert(emailResult, () => {
        setShowFeedback(false);
        clearFeedbackForm();
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDonationPress = async () => {
    if (!donationProduct || isPurchasingDonation) {
      return;
    }

    setIsPurchasingDonation(true);
    try {
      const result = await purchaseDonation(donationProduct.id);
      if (result.status === 'success') {
        Alert.alert(
          l10n.about.tipThankYouTitle,
          l10n.about.tipThankYouDescription,
        );
      } else if (result.status === 'pending') {
        Alert.alert(
          l10n.about.tipPendingTitle,
          l10n.about.tipPendingDescription,
        );
      }
    } catch {
      Alert.alert(l10n.about.tipErrorTitle, l10n.about.tipErrorDescription);
    } finally {
      setIsPurchasingDonation(false);
    }
  };

  const donationButtonLabel = donationProduct
    ? l10n.about.tipButton.replace('{{price}}', donationProduct.displayPrice)
    : isLoadingDonation
      ? l10n.about.tipLoading
      : l10n.about.tipUnavailable;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Text variant="titleLarge" style={styles.title}>
                LLMm
              </Text>
              <Text variant="bodyMedium" style={styles.description}>
                {l10n.about.description}
              </Text>
              <View style={styles.versionContainer}>
                <TouchableOpacity
                  style={styles.versionButton}
                  onPress={copyVersionToClipboard}>
                  <Text style={styles.versionText}>
                    v{appInfo.version} ({appInfo.build})
                  </Text>
                  <CopyIcon
                    width={16}
                    height={16}
                    stroke={theme.colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              <Text style={styles.llamaBuildText}>
                llama.cpp {BuildInfo.number} ({BuildInfo.commit.substring(0, 7)}
                )
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{l10n.about.supportProject}</Text>
            <Text variant="bodyMedium" style={styles.description}>
              {l10n.about.supportProjectDescription}
            </Text>
            <Button
              mode="outlined"
              onPress={() =>
                Linking.openURL('https://github.com/a-ghorbani/pocketpal-ai')
              }
              style={styles.actionButton}
              icon={GithubButtonIcon}>
              {l10n.about.githubButton}
            </Button>
          </View>

          <View style={[styles.section, styles.compactSection]}>
            <Text style={styles.sectionTitle}>{l10n.about.supportTitle}</Text>
            <Text variant="bodyMedium" style={styles.mutedDescription}>
              {l10n.about.supportDescription}
            </Text>
            {Platform.OS !== 'ios' && (
              <>
                <TouchableOpacity
                  style={styles.supportButton}
                  onPress={() =>
                    Linking.openURL('https://www.buymeacoffee.com/aghorbani')
                  }>
                  <HeartIcon stroke={theme.colors.onPrimary} />
                  <Text style={styles.supportButtonText}>
                    {l10n.about.sponsorButton}
                  </Text>
                </TouchableOpacity>
              </>
            )}
            {Platform.OS === 'ios' && (
              <>
                <Button
                  mode="contained"
                  onPress={handleDonationPress}
                  loading={isLoadingDonation || isPurchasingDonation}
                  disabled={!donationProduct || isPurchasingDonation}
                  style={styles.actionButton}>
                  {donationButtonLabel}
                </Button>
                {!donationProduct && !isLoadingDonation && (
                  <Text style={styles.supportHint}>
                    {l10n.about.tipUnavailableDescription}
                  </Text>
                )}
              </>
            )}
          </View>

          <View style={[styles.section, styles.compactSection]}>
            <Text style={styles.sectionTitle}>{l10n.about.feedbackTitle}</Text>
            <Button
              mode="outlined"
              style={styles.actionButton}
              contentStyle={styles.feedbackButtonContent}
              icon={ChevronRightButtonIcon}
              onPress={() => setShowFeedback(true)}>
              {l10n.feedback.shareThoughtsButton}
            </Button>
          </View>

          <View style={styles.legalRow}>
            <Text
              style={styles.legalLink}
              onPress={() =>
                Linking.openURL('https://pocketpal.dev/privacy-policy')
              }>
              {l10n.about.privacyPolicy}
            </Text>
            <Text style={styles.legalSeparator}>·</Text>
            <Text
              style={styles.legalLink}
              onPress={() => Linking.openURL('https://pocketpal.dev/terms')}>
              {l10n.about.termsOfService}
            </Text>
          </View>
        </View>
      </ScrollView>

      <Sheet
        title={l10n.feedback.title}
        isVisible={showFeedback}
        displayFullHeight
        onClose={() => setShowFeedback(false)}>
        <Sheet.ScrollView contentContainerStyle={styles.feedbackForm}>
          <View style={styles.field}>
            <Text style={styles.label}>{l10n.feedback.useCase.label}</Text>
            <TextInput
              defaultValue={useCase}
              onChangeText={setUseCase}
              placeholder={l10n.feedback.useCase.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.featureRequests.label}
            </Text>
            <TextInput
              defaultValue={featureRequests}
              onChangeText={setFeatureRequests}
              placeholder={l10n.feedback.featureRequests.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.generalFeedback.label}
            </Text>
            <TextInput
              defaultValue={generalFeedback}
              onChangeText={setGeneralFeedback}
              placeholder={l10n.feedback.generalFeedback.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.usageFrequency.label}
            </Text>
            <SegmentedButtons
              value={usageFrequency}
              onValueChange={setUsageFrequency}
              buttons={[
                {
                  value: 'daily',
                  label: l10n.feedback.usageFrequency.options.daily,
                },
                {
                  value: 'weekly',
                  label: l10n.feedback.usageFrequency.options.weekly,
                },
                {
                  value: 'monthly',
                  label: l10n.feedback.usageFrequency.options.monthly,
                },
                {
                  value: 'rarely',
                  label: l10n.feedback.usageFrequency.options.rarely,
                },
              ]}
              style={styles.segmentedButtons}
            />
          </View>
        </Sheet.ScrollView>
        <Sheet.Actions>
          <View style={styles.secondaryButtons}>
            <Button mode="text" onPress={() => setShowFeedback(false)}>
              {l10n.common.cancel}
            </Button>
          </View>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={isSubmitting}>
            {l10n.feedback.submit}
          </Button>
        </Sheet.Actions>
      </Sheet>
    </SafeAreaView>
  );
};
