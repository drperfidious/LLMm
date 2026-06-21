import Clipboard from '@react-native-clipboard/clipboard';
import {Linking, Platform} from 'react-native';
import DeviceInfo from 'react-native-device-info';

export const REPORT_RECIPIENT_EMAIL = 'rduqu044@gmail.com';

const MAX_MAILTO_URL_LENGTH = 8000;

type OpenReportEmailDraftParams = {
  reportType: string;
  subject: string;
  payload: Record<string, unknown>;
  submissionError?: unknown;
};

export type ReportEmailResult = {
  recipient: string;
  openedMailApp: boolean;
  copiedBodyToClipboard: boolean;
  error?: unknown;
};

const serializeError = (error: unknown) => {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return String(error);
};

const stableStringify = (value: unknown) => {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_key, nestedValue) => {
      if (typeof nestedValue === 'object' && nestedValue !== null) {
        if (seen.has(nestedValue)) {
          return '[Circular]';
        }
        seen.add(nestedValue);
      }
      return nestedValue;
    },
    2,
  );
};

const buildMailtoUrl = (subject: string, body: string) =>
  `mailto:${REPORT_RECIPIENT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;

export const buildReportEmailBody = ({
  reportType,
  payload,
  submissionError,
}: Omit<OpenReportEmailDraftParams, 'subject'>) => {
  const report = {
    reportType,
    generatedAt: new Date().toISOString(),
    app: {
      name: 'LLMm',
      version: DeviceInfo.getVersion(),
      build: DeviceInfo.getBuildNumber(),
    },
    device: {
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      model: DeviceInfo.getModel(),
      systemVersion: DeviceInfo.getSystemVersion(),
    },
    submissionError: serializeError(submissionError),
    payload,
  };

  return [
    'LLMm diagnostic report',
    '',
    `Report type: ${reportType}`,
    `Recipient: ${REPORT_RECIPIENT_EMAIL}`,
    '',
    'JSON payload:',
    stableStringify(report),
  ].join('\n');
};

export const openReportEmailDraft = async ({
  reportType,
  subject,
  payload,
  submissionError,
}: OpenReportEmailDraftParams): Promise<ReportEmailResult> => {
  const fullBody = buildReportEmailBody({
    reportType,
    payload,
    submissionError,
  });
  let body = fullBody;
  let copiedBodyToClipboard = false;
  let mailtoUrl = buildMailtoUrl(subject, body);

  if (mailtoUrl.length > MAX_MAILTO_URL_LENGTH) {
    Clipboard.setString(fullBody);
    copiedBodyToClipboard = true;
    body = [
      'The full LLMm diagnostic report was copied to the clipboard because it was too large for a mailto URL.',
      '',
      'Please paste the report body below this line before sending.',
    ].join('\n');
    mailtoUrl = buildMailtoUrl(subject, body);
  }

  try {
    await Linking.openURL(mailtoUrl);
    return {
      recipient: REPORT_RECIPIENT_EMAIL,
      openedMailApp: true,
      copiedBodyToClipboard,
    };
  } catch (error) {
    Clipboard.setString(fullBody);
    return {
      recipient: REPORT_RECIPIENT_EMAIL,
      openedMailApp: false,
      copiedBodyToClipboard: true,
      error,
    };
  }
};
