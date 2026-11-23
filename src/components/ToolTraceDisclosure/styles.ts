import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const styles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    collapsed: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 2,
      paddingBottom: 4,
    },
    collapsedIcon: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      marginRight: 4,
      opacity: 0.85,
    },
    collapsedText: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      opacity: 0.9,
    },
    expanded: {
      borderColor: theme.colors.outlineVariant,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      marginTop: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: theme.colors.surfaceVariant,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
    },
    headerIcon: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
      marginRight: 6,
    },
    headerTitle: {
      color: theme.colors.onSurface,
      fontSize: 12,
      fontWeight: '600',
      flexShrink: 1,
    },
    closeButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 24,
      minWidth: 24,
      marginLeft: 8,
    },
    closeText: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 16,
      lineHeight: 18,
      fontWeight: '600',
    },
    sectionLabel: {
      color: theme.colors.textSecondary,
      fontSize: 10,
      fontWeight: '600',
      marginTop: 6,
      marginBottom: 2,
      textTransform: 'uppercase',
    },
    codeScrollContent: {
      flexGrow: 1,
    },
    codeText: {
      color: theme.colors.onSurface,
      fontFamily: 'Menlo',
      fontSize: 10,
      lineHeight: 14,
    },
  });
