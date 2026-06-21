import Clipboard from '@react-native-clipboard/clipboard';
import {Linking} from 'react-native';

import {
  buildReportEmailBody,
  openReportEmailDraft,
  REPORT_RECIPIENT_EMAIL,
} from '../reportEmail';

jest.mock('react-native-device-info', () => ({
  getVersion: jest.fn(() => '0.2.0'),
  getBuildNumber: jest.fn(() => '200'),
  getModel: jest.fn(() => 'iPhone 14 Pro Max'),
  getSystemVersion: jest.fn(() => '27.0'),
}));

const openURLSpy = jest.spyOn(Linking, 'openURL');

describe('reportEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    openURLSpy.mockResolvedValue(undefined);
  });

  it('builds a diagnostic body with app, device, payload, and submit error', () => {
    const body = buildReportEmailBody({
      reportType: 'model-load-error',
      payload: {modelId: 'test-model'},
      submissionError: new Error('App Check failed'),
    });

    expect(body).toContain('LLMm diagnostic report');
    expect(body).toContain(REPORT_RECIPIENT_EMAIL);
    expect(body).toContain('"version": "0.2.0"');
    expect(body).toContain('"modelId": "test-model"');
    expect(body).toContain('"message": "App Check failed"');
  });

  it('opens a prefilled mail draft for normal report bodies', async () => {
    const result = await openReportEmailDraft({
      reportType: 'feedback',
      subject: 'LLMm feedback report',
      payload: {message: 'hello'},
    });

    expect(result).toEqual({
      recipient: REPORT_RECIPIENT_EMAIL,
      openedMailApp: true,
      copiedBodyToClipboard: false,
    });
    expect(openURLSpy).toHaveBeenCalledTimes(1);
    const url = openURLSpy.mock.calls[0][0];
    expect(url).toMatch(`mailto:${REPORT_RECIPIENT_EMAIL}`);
    expect(decodeURIComponent(url)).toContain('LLMm feedback report');
    expect(Clipboard.setString).not.toHaveBeenCalled();
  });

  it('copies the full report when the mailto URL would be too large', async () => {
    await openReportEmailDraft({
      reportType: 'model-load-error',
      subject: 'LLMm large report',
      payload: {log: 'x'.repeat(10000)},
    });

    expect(Clipboard.setString).toHaveBeenCalledWith(
      expect.stringContaining('"log": "'),
    );
    const url = openURLSpy.mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain(
      'The full LLMm diagnostic report was copied to the clipboard',
    );
  });

  it('copies the report if no mail client can open the draft', async () => {
    openURLSpy.mockRejectedValueOnce(new Error('No mail app'));

    const result = await openReportEmailDraft({
      reportType: 'feedback',
      subject: 'LLMm feedback report',
      payload: {message: 'hello'},
    });

    expect(result.openedMailApp).toBe(false);
    expect(result.copiedBodyToClipboard).toBe(true);
    expect(Clipboard.setString).toHaveBeenCalledWith(
      expect.stringContaining('"message": "hello"'),
    );
  });
});
