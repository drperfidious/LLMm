import React, {useMemo} from 'react';
import {ScrollView, Text, View} from 'react-native';

import {useTheme} from '../../hooks';

import {createMathStyles} from './mathStyles';
import {decodeMathValue, formatMathValue} from './math';

function getMathPayload(props: any): {kind?: string; value: string} {
  const attribs = props?.tnode?.domNode?.attribs ?? {};
  return {
    kind: attribs['data-llmm-math'],
    value: decodeMathValue(attribs['data-value']),
  };
}

export const MathSpanRenderer = ({TDefaultRenderer, ...props}: any) => {
  const theme = useTheme();
  const styles = useMemo(() => createMathStyles(theme), [theme]);
  const {kind, value} = getMathPayload(props);

  if (kind !== 'inline') {
    return <TDefaultRenderer {...props} />;
  }

  return (
    <Text style={styles.inlineMath} testID="markdown-inline-math">
      {formatMathValue(value)}
    </Text>
  );
};

export const MathDivRenderer = ({TDefaultRenderer, ...props}: any) => {
  const theme = useTheme();
  const styles = useMemo(() => createMathStyles(theme), [theme]);
  const {kind, value} = getMathPayload(props);

  if (kind !== 'block') {
    return <TDefaultRenderer {...props} />;
  }

  return (
    <View style={styles.blockMathContainer} testID="markdown-block-math">
      <ScrollView horizontal nestedScrollEnabled>
        <Text style={styles.blockMath}>{formatMathValue(value)}</Text>
      </ScrollView>
    </View>
  );
};
