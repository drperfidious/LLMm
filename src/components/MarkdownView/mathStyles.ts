import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const createMathStyles = (theme: Theme) =>
  StyleSheet.create({
    inlineMath: {
      fontFamily: theme.typography.codeS.fontFamily,
      fontSize: theme.typography.bodyM.fontSize,
      lineHeight: theme.typography.bodyM.lineHeight,
      color: theme.colors.onSurface,
      backgroundColor: theme.colors.surfaceContainerHigh,
      borderRadius: 4,
      paddingHorizontal: 3,
      paddingVertical: 1,
    },
    blockMathContainer: {
      backgroundColor: theme.colors.surfaceContainerHigh,
      borderRadius: 6,
      marginVertical: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    blockMath: {
      fontFamily: theme.typography.codeM.fontFamily,
      fontSize: theme.typography.codeM.fontSize,
      lineHeight: theme.typography.codeM.lineHeight,
      color: theme.colors.onSurface,
    },
  });
