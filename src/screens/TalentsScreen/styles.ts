import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      padding: theme.spacing.default,
      paddingBottom: theme.spacing.default * 2,
      gap: theme.spacing.default,
    },
    header: {
      gap: theme.spacing.s,
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
    section: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.default,
      paddingTop: theme.spacing.default,
      paddingBottom: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      gap: theme.spacing.s,
    },
    sectionTitle: {
      color: theme.colors.onSurface,
      flexShrink: 1,
    },
    statusPill: {
      minHeight: 28,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.s,
      gap: theme.spacing.xs,
    },
    statusPillReady: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surfaceContainerHighest,
    },
    statusPillMissing: {
      borderColor: theme.colors.error,
      backgroundColor: theme.colors.errorContainer,
    },
    statusPillText: {
      ...theme.fonts.labelSmall,
      color: theme.colors.primary,
    },
    statusPillTextMissing: {
      color: theme.colors.error,
    },
    input: {
      marginHorizontal: theme.spacing.default,
      marginTop: theme.spacing.xs,
    },
    helperText: {
      marginHorizontal: theme.spacing.default,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 18,
    },
    statusMessage: {
      marginHorizontal: theme.spacing.default,
      marginTop: theme.spacing.s,
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
    },
    statusMessageError: {
      color: theme.colors.error,
    },
    statusMessageSuccess: {
      color: theme.colors.primary,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: theme.spacing.default,
      gap: theme.spacing.s,
    },
    primaryButton: {
      flex: 1,
    },
    providerWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: theme.spacing.default,
      marginTop: theme.spacing.sm,
      gap: theme.spacing.s,
    },
    providerButton: {
      minWidth: 84,
    },
    compactInputRow: {
      flexDirection: 'row',
      marginHorizontal: theme.spacing.default,
      marginTop: theme.spacing.sm,
      gap: theme.spacing.s,
    },
    compactInput: {
      flex: 1,
    },
    multilineInput: {
      minHeight: 112,
    },
    talentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.default,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: theme.colors.outlineVariant,
      gap: theme.spacing.sm,
    },
    talentIcon: {
      width: 36,
      height: 36,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceContainerHighest,
    },
    talentContent: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    talentTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.s,
    },
    talentTitle: {
      color: theme.colors.onSurface,
      flexShrink: 1,
    },
    talentDescription: {
      color: theme.colors.onSurfaceVariant,
      lineHeight: 18,
    },
    keywordText: {
      color: theme.colors.onSurfaceVariant,
      opacity: 0.75,
      lineHeight: 18,
    },
    toggleRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.s,
      marginTop: theme.spacing.xs,
    },
    toggleItem: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    toggleLabel: {
      ...theme.fonts.labelSmall,
      color: theme.colors.onSurfaceVariant,
    },
    badge: {
      minHeight: 24,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      paddingHorizontal: theme.spacing.s,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surfaceContainerHigh,
    },
    badgeText: {
      ...theme.fonts.labelSmall,
      color: theme.colors.onSurfaceVariant,
    },
  });
