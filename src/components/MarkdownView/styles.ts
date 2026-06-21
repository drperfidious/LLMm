import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

// Plain object (not via StyleSheet.create) because react-syntax-highlighter's
// customStyle is merged with Object.assign — a numeric StyleSheet id won't
// flatten the upstream white PreTag fallback. See MarkdownView for the why.
export const codeHighlighterPreOverride = {
  backgroundColor: 'transparent',
} as const;

export const createTagsStyles = (theme: Theme) => ({
  body: {
    color: theme.colors.text,
    fontFamily: theme.typography.bodyM.fontFamily,
    fontSize: theme.typography.bodyM.fontSize,
    lineHeight: theme.typography.bodyM.lineHeight,
    padding: 0,
    paddingTop: 0,
    margin: 0,
    backgroundColor: 'transparent',
  },
  p: {
    marginTop: 0,
    marginBottom: 8,
  },
  h1: {
    ...theme.typography.titleL,
    color: theme.colors.onSurface,
    marginTop: 2,
    marginBottom: 10,
  },
  h2: {
    ...theme.typography.titleM,
    color: theme.colors.onSurface,
    marginTop: 2,
    marginBottom: 8,
  },
  h3: {
    ...theme.typography.titleS,
    color: theme.colors.onSurface,
    marginTop: 2,
    marginBottom: 8,
  },
  h4: {
    ...theme.typography.uiM,
    color: theme.colors.onSurface,
    marginTop: 2,
    marginBottom: 6,
  },
  h5: {
    ...theme.typography.uiS,
    color: theme.colors.onSurface,
    marginTop: 2,
    marginBottom: 6,
  },
  h6: {
    ...theme.typography.uiS,
    color: theme.colors.onSurfaceVariant,
    marginTop: 2,
    marginBottom: 6,
  },
  strong: {
    fontFamily: theme.typography.uiM.fontFamily,
    fontWeight: '500' as const,
    color: theme.colors.onSurface,
  },
  b: {
    fontFamily: theme.typography.uiM.fontFamily,
    fontWeight: '500' as const,
    color: theme.colors.onSurface,
  },
  em: {
    fontStyle: 'italic' as const,
  },
  i: {
    fontStyle: 'italic' as const,
  },
  a: {
    color: theme.colors.primary,
    textDecorationLine: 'underline' as const,
    textDecorationColor: theme.colors.primary,
  },
  ul: {
    marginTop: 0,
    marginBottom: 8,
    paddingLeft: 18,
  },
  ol: {
    marginTop: 0,
    marginBottom: 8,
    paddingLeft: 18,
  },
  li: {
    marginBottom: 4,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
    backgroundColor: theme.colors.surfaceContainer,
    paddingLeft: 10,
    paddingRight: 10,
    paddingVertical: 8,
    marginVertical: 8,
    borderRadius: 6,
    color: theme.colors.onSurfaceVariant,
  },
  hr: {
    backgroundColor: theme.colors.outline,
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  code: {
    fontFamily: theme.typography.codeS.fontFamily,
    backgroundColor: theme.colors.surfaceContainerHigh,
    padding: 4,
    borderRadius: 4,
    color: theme.colors.onSurface,
    fontSize: theme.typography.codeS.fontSize,
    lineHeight: theme.typography.codeS.lineHeight,
    whiteSpace: 'pre' as const,
  },
  pre: {
    backgroundColor: theme.colors.surfaceContainerHighest,
    padding: 8,
    borderRadius: 6,
    marginVertical: 8,
    color: theme.colors.onPrimaryContainer,
    fontFamily: theme.typography.codeM.fontFamily,
    fontSize: theme.typography.codeM.fontSize,
    lineHeight: theme.typography.codeM.lineHeight,
    whiteSpace: 'pre' as const,
  },
  // Styles for thinking tags
  thinking: {
    color: theme.colors.thinkingBubbleText,
    fontSize: theme.typography.bodyS.fontSize,
    lineHeight: theme.typography.bodyS.lineHeight,
    fontFamily: theme.typography.bodyS.fontFamily,
  },
  think: {
    color: theme.colors.thinkingBubbleText,
    fontSize: theme.typography.bodyS.fontSize,
    lineHeight: theme.typography.bodyS.lineHeight,
    fontFamily: theme.typography.bodyS.fontFamily,
  },
  thought: {
    color: theme.colors.thinkingBubbleText,
    fontSize: theme.typography.bodyS.fontSize,
    lineHeight: theme.typography.bodyS.lineHeight,
    fontFamily: theme.typography.bodyS.fontFamily,
  },
});

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    markdownContainer: {
      // Dynamic maxWidth will be applied via style prop
    },
    codeHighlighterText: {
      fontFamily: theme.typography.codeM.fontFamily,
    },
    codeHighlighterScrollContent: {
      backgroundColor: theme.colors.surfaceContainerHighest,
      padding: 8,
      borderRadius: 6,
      marginTop: 4,
    },
  });
