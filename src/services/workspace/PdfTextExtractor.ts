import {NativeModules, Platform} from 'react-native';

export type PdfTextExtractionResult = {
  text: string;
  pageCount: number;
  truncated: boolean;
};

type NativePdfTextExtractor = {
  extractText: (
    path: string,
    maxChars: number,
  ) => Promise<{
    text?: string;
    pageCount?: number;
    truncated?: boolean;
  }>;
};

const DEFAULT_MAX_PDF_CHARS = 256 * 1024;

export async function extractPdfText(
  absolutePath: string,
  maxChars = DEFAULT_MAX_PDF_CHARS,
): Promise<PdfTextExtractionResult> {
  if (Platform.OS !== 'ios') {
    throw new Error(
      'PDF text extraction is only available on iOS in this build',
    );
  }

  const module = NativeModules.PdfTextExtractor as
    | NativePdfTextExtractor
    | undefined;
  if (!module?.extractText) {
    throw new Error('PDF text extraction is unavailable in this build');
  }

  const result = await module.extractText(
    absolutePath,
    Math.max(1, Math.floor(maxChars)),
  );
  return {
    text: typeof result?.text === 'string' ? result.text : '',
    pageCount:
      typeof result?.pageCount === 'number' && Number.isFinite(result.pageCount)
        ? result.pageCount
        : 0,
    truncated: result?.truncated === true,
  };
}
