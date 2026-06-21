import {View} from 'react-native';
import React, {useMemo} from 'react';

import {marked} from 'marked';
import {RenderHTMLSource} from 'react-native-render-html';

import {preprocessMarkdownMath} from './math';

marked.use({
  breaks: true,
  gfm: true,
});

interface MarkdownViewProps {
  markdownText: string;
  maxMessageWidth: number;
  selectable?: boolean;
}

const isEmptyContent = (content: string): boolean => {
  return !content || content.trim() === '';
};

/**
 * Renders a markdown string inside the app-level RenderHTML provider tree.
 * The engine (parser + tagsStyles + renderers) lives on `MarkdownProvider`
 * at the app root; only `source` and `contentWidth` change here, so per-
 * token streaming updates stay cheap.
 *
 * NOTE: `selectable` is accepted for API compatibility but is currently
 * fixed at the provider level. If a caller ever needs a selectable variant
 * a separate provider scope would have to host it.
 */
export const MarkdownView: React.FC<MarkdownViewProps> = React.memo(
  ({markdownText, maxMessageWidth}) => {
    const normalizedMarkdown = useMemo(
      () => markdownText.replace(/\r\n/g, '\n').trim(),
      [markdownText],
    );
    const mathAwareMarkdown = useMemo(
      () => preprocessMarkdownMath(normalizedMarkdown),
      [normalizedMarkdown],
    );
    const htmlContent = useMemo(
      () => marked(mathAwareMarkdown) as string,
      [mathAwareMarkdown],
    );
    const source = useMemo(() => ({html: htmlContent}), [htmlContent]);

    return (
      <View testID="markdown-content" style={{maxWidth: maxMessageWidth}}>
        {!isEmptyContent(normalizedMarkdown) && (
          <RenderHTMLSource source={source} contentWidth={maxMessageWidth} />
        )}
      </View>
    );
  },
  (prevProps, nextProps) =>
    prevProps.markdownText === nextProps.markdownText &&
    prevProps.maxMessageWidth === nextProps.maxMessageWidth &&
    prevProps.selectable === nextProps.selectable,
);
