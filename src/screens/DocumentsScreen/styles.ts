import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    listContent: {
      padding: theme.spacing.default,
      paddingBottom: theme.spacing.default * 2,
      gap: theme.spacing.sm,
    },
    headerWrap: {
      gap: theme.spacing.default,
      marginBottom: theme.spacing.sm,
    },
    header: {
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.s,
    },
    title: {
      color: theme.colors.onBackground,
    },
    subtitle: {
      color: theme.colors.onSurfaceVariant,
      lineHeight: 22,
    },
    summaryBand: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      paddingVertical: theme.spacing.sm,
    },
    summaryItem: {
      flex: 1,
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    summaryValue: {
      ...theme.fonts.titleLarge,
      color: theme.colors.onSurface,
    },
    summaryLabel: {
      ...theme.fonts.labelMedium,
      color: theme.colors.onSurfaceVariant,
    },
    summaryDivider: {
      width: 1,
      alignSelf: 'stretch',
      backgroundColor: theme.colors.outlineVariant,
    },
    toolbar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.s,
    },
    createPanel: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing.default,
      gap: theme.spacing.s,
    },
    createPanelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    createPanelTitle: {
      color: theme.colors.onSurface,
    },
    input: {
      backgroundColor: theme.colors.surface,
    },
    bodyInput: {
      minHeight: 132,
    },
    searchRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.s,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing.s,
    },
    searchInput: {
      flex: 1,
      backgroundColor: theme.colors.surface,
    },
    sortRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.s,
    },
    statusText: {
      color: theme.colors.onSurfaceVariant,
      lineHeight: 18,
    },
    card: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing.default,
      gap: theme.spacing.s,
    },
    cardSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surfaceContainer,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.s,
    },
    fileIcon: {
      width: 36,
      height: 36,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceContainerHighest,
    },
    fileText: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    fileName: {
      color: theme.colors.onSurface,
    },
    fileMeta: {
      color: theme.colors.onSurfaceVariant,
    },
    expanded: {
      gap: theme.spacing.s,
      borderTopWidth: 1,
      borderTopColor: theme.colors.outlineVariant,
      paddingTop: theme.spacing.s,
    },
    previewLoading: {
      minHeight: 120,
      alignItems: 'center',
      justifyContent: 'center',
    },
    previewMessage: {
      color: theme.colors.onSurfaceVariant,
      lineHeight: 20,
    },
    previewError: {
      color: theme.colors.error,
      lineHeight: 20,
    },
    markdownPreview: {
      maxHeight: 360,
      overflow: 'hidden',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.background,
      padding: theme.spacing.s,
    },
    rawPreview: {
      maxHeight: 320,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.background,
      padding: theme.spacing.s,
    },
    rawPreviewText: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onBackground,
      fontFamily: 'Menlo',
      lineHeight: 18,
    },
    reader: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    readerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.s,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.spacing.default,
      paddingVertical: theme.spacing.s,
    },
    readerTitleWrap: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    readerTitle: {
      color: theme.colors.onSurface,
    },
    readerMeta: {
      color: theme.colors.onSurfaceVariant,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceContainerHighest,
    },
    readerBody: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    readerActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.s,
      borderTopWidth: 1,
      borderTopColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing.default,
    },
    previewScroll: {
      flex: 1,
    },
    markdownPreviewContent: {
      padding: theme.spacing.default,
      paddingBottom: theme.spacing.default * 2,
    },
    rawPreviewContent: {
      padding: theme.spacing.default,
      paddingBottom: theme.spacing.default * 2,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.s,
    },
    folderList: {
      gap: theme.spacing.xs,
      borderTopWidth: 1,
      borderTopColor: theme.colors.outlineVariant,
      paddingTop: theme.spacing.s,
    },
    folderListTitle: {
      ...theme.fonts.labelLarge,
      color: theme.colors.onSurfaceVariant,
    },
    folderRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.s,
      borderRadius: 8,
      backgroundColor: theme.colors.surfaceContainerHighest,
      paddingHorizontal: theme.spacing.s,
      paddingVertical: theme.spacing.xs,
    },
    actionButton: {
      minWidth: 120,
    },
    empty: {
      minHeight: 160,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing.default,
    },
    emptyTitle: {
      color: theme.colors.onSurface,
    },
    emptyBody: {
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
