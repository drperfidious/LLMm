import React from 'react';
import {Pressable, ScrollView, View} from 'react-native';

import {Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {useTheme} from '../../hooks';
import {AgentToolCall, AgentToolOutcome} from '../../utils/types';

import {styles} from './styles';

interface ToolTraceDisclosureProps {
  call: AgentToolCall;
  outcome: AgentToolOutcome;
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) {
      return '';
    }
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCall(call: AgentToolCall): string {
  const rawArgs = call.function?.arguments ?? '';
  let args: unknown = rawArgs;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    args = rawArgs;
  }

  return formatJson({
    id: call.id,
    name: call.function?.name ?? '',
    arguments: args,
  });
}

/**
 * Collapsed-by-default inspector for persisted agent tool calls. The normal
 * tool UI stays low-noise, but a tap reveals the exact function call and the
 * exact tool payload that was sent back into the agent loop.
 */
export const ToolTraceDisclosure: React.FC<ToolTraceDisclosureProps> = ({
  call,
  outcome,
}) => {
  const theme = useTheme();
  const componentStyles = styles({theme});
  const [expanded, setExpanded] = React.useState(false);
  const name = call.function?.name || outcome.toolName || 'tool';
  const status = outcome.result.type === 'error' ? 'failed' : 'completed';

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Show ${name} tool details`}
        onPress={() => setExpanded(true)}
        style={componentStyles.collapsed}
        testID="tool-trace-collapsed">
        <Icon
          name="chevron-right"
          style={componentStyles.collapsedIcon}
          testID="tool-trace-collapsed-icon"
        />
        <Text style={componentStyles.collapsedText}>
          {name} details · {status}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={componentStyles.expanded} testID="tool-trace-expanded">
      <View style={componentStyles.header}>
        <View style={componentStyles.headerTitleRow}>
          <Icon
            name="code-json"
            style={componentStyles.headerIcon}
            testID="tool-trace-expanded-icon"
          />
          <Text style={componentStyles.headerTitle}>{name} details</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Hide ${name} tool details`}
          onPress={() => setExpanded(false)}
          hitSlop={8}
          style={componentStyles.closeButton}
          testID="tool-trace-close">
          <Text style={componentStyles.closeText}>x</Text>
        </Pressable>
      </View>

      <Text style={componentStyles.sectionLabel}>Call</Text>
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={componentStyles.codeScrollContent}>
        <Text selectable style={componentStyles.codeText}>
          {formatCall(call)}
        </Text>
      </ScrollView>

      <Text style={componentStyles.sectionLabel}>Output</Text>
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={componentStyles.codeScrollContent}>
        <Text selectable style={componentStyles.codeText}>
          {outcome.responseContent}
        </Text>
      </ScrollView>

      <Text style={componentStyles.sectionLabel}>Result</Text>
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={componentStyles.codeScrollContent}>
        <Text selectable style={componentStyles.codeText}>
          {formatJson(outcome.result)}
        </Text>
      </ScrollView>
    </View>
  );
};
