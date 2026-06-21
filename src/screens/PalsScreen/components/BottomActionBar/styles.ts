import {StyleSheet} from 'react-native';
import {Theme} from '../../../../utils/types';
import {EdgeInsets} from 'react-native-safe-area-context';

export const createStyles = (theme: Theme, insets: EdgeInsets) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.outline,
    },
    actionBar: {
      flexDirection: 'row',
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: Math.max(insets.bottom + 4, 12),
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 64 + Math.max(insets.bottom, 0),
    },
    actionSlot: {
      flex: 1,
      alignItems: 'stretch',
      justifyContent: 'center',
      height: 52,
    },
    actionButton: {
      flex: 1,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 4,
      borderRadius: 12,
    },
    actionButtonActive: {
      backgroundColor: theme.colors.surfaceVariant,
    },
    iconContainer: {
      height: 28,
      marginBottom: 2,
      padding: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: {
      fontSize: 11,
      lineHeight: 13,
      fontWeight: '500',
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      maxWidth: 72,
    },
  });
