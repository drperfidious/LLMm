import {StyleSheet} from 'react-native';
import {Theme} from '../../../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    addButton: {
      flex: 1,
      width: '100%',
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 4,
      borderRadius: 12,
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
