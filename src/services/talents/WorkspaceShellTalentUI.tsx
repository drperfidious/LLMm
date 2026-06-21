import React, {useCallback, useMemo, useState} from 'react';
import {TouchableOpacity, View} from 'react-native';

import {Text} from 'react-native-paper';
import Share from 'react-native-share';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {useTheme} from '../../hooks';
import {workspaceFileSystem} from '../workspace';

import {TalentUI} from './TalentUIRegistry';
import {TalentResult} from './types';

type MutationAction =
  | 'wrote'
  | 'appended'
  | 'created'
  | 'deleted'
  | 'touched'
  | 'copied'
  | 'moved';

type WorkspaceMutation = {
  action: MutationAction;
  path: string;
  exportable: boolean;
};

const MUTATION_PATTERNS: Array<{
  action: MutationAction;
  pattern: RegExp;
  exportable: boolean;
  pathIndex?: number;
}> = [
  {
    action: 'wrote',
    pattern: /Wrote \d+ bytes to (\/[^\n]+)/g,
    exportable: true,
  },
  {
    action: 'appended',
    pattern: /Appended \d+ bytes to (\/[^\n]+)/g,
    exportable: true,
  },
  {action: 'touched', pattern: /Touched (\/[^\n]+)/g, exportable: true},
  {
    action: 'copied',
    pattern: /Copied (\/[^\n]+) to (\/[^\n]+)/g,
    exportable: true,
    pathIndex: 2,
  },
  {
    action: 'moved',
    pattern: /Moved (\/[^\n]+) to (\/[^\n]+)/g,
    exportable: true,
    pathIndex: 2,
  },
  {action: 'created', pattern: /Created (\/[^\n]+)/g, exportable: false},
  {action: 'deleted', pattern: /Deleted (\/[^\n]+)/g, exportable: false},
];

function extractWorkspaceMutations(summary: string): WorkspaceMutation[] {
  const found: WorkspaceMutation[] = [];

  for (const {action, pattern, exportable, pathIndex} of MUTATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(summary)) !== null) {
      const path = match[pathIndex ?? 1]?.trim();
      if (
        path &&
        !found.some(item => item.path === path && item.action === action)
      ) {
        found.push({action, path, exportable});
      }
    }
  }

  return found;
}

function actionLabel(action: MutationAction): string {
  switch (action) {
    case 'wrote':
      return 'Wrote';
    case 'appended':
      return 'Appended';
    case 'created':
      return 'Created';
    case 'deleted':
      return 'Deleted';
    case 'touched':
      return 'Touched';
    case 'copied':
      return 'Copied';
    case 'moved':
      return 'Moved';
  }
}

function WorkspaceShellResultCard({summary}: {summary: string}) {
  const theme = useTheme();
  const mutations = useMemo(
    () => extractWorkspaceMutations(summary),
    [summary],
  );
  const [status, setStatus] = useState<string>('');

  const sharePath = useCallback(async (path: string) => {
    try {
      const {absolutePath} = workspaceFileSystem.resolve(path);
      await Share.open({
        title: path.split('/').pop() || path,
        url: absolutePath.startsWith('file://')
          ? absolutePath
          : `file://${absolutePath}`,
        failOnCancel: false,
      });
      setStatus('');
    } catch {
      setStatus('Could not export this workspace file.');
    }
  }, []);

  if (mutations.length === 0) {
    return null;
  }

  return (
    <View
      testID="workspace-shell-result"
      style={{
        alignSelf: 'stretch',
        marginHorizontal: 12,
        marginVertical: 8,
        borderWidth: 1,
        borderColor: theme.colors.outlineVariant,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: theme.colors.surfaceVariant,
        }}>
        <Icon
          name="folder-cog-outline"
          size={16}
          color={theme.colors.onSurfaceVariant}
        />
        <Text
          style={{
            flex: 1,
            marginLeft: 8,
            fontSize: 12,
            fontWeight: '700',
            color: theme.colors.onSurfaceVariant,
          }}>
          Workspace files
        </Text>
      </View>
      {mutations.map(item => (
        <View
          key={`${item.action}-${item.path}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: theme.colors.outlineVariant,
          }}>
          <Icon
            name={
              item.action === 'deleted' ? 'file-remove-outline' : 'file-outline'
            }
            size={18}
            color={theme.colors.primary}
          />
          <View style={{flex: 1, marginLeft: 10}}>
            <Text
              numberOfLines={1}
              style={{fontSize: 13, color: theme.colors.onSurface}}>
              {item.path}
            </Text>
            <Text
              style={{
                marginTop: 2,
                fontSize: 11,
                color: theme.colors.onSurfaceVariant,
              }}>
              {actionLabel(item.action)}
            </Text>
          </View>
          {item.exportable ? (
            <TouchableOpacity
              onPress={() => sharePath(item.path)}
              accessibilityRole="button"
              accessibilityLabel={`Export ${item.path}`}
              testID={`workspace-export-${item.path}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 14,
                backgroundColor: theme.colors.primaryContainer,
              }}>
              <Icon
                name="export-variant"
                size={14}
                color={theme.colors.onPrimaryContainer}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color: theme.colors.onPrimaryContainer,
                }}>
                Export
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      {status ? (
        <Text
          style={{
            paddingHorizontal: 12,
            paddingBottom: 10,
            fontSize: 11,
            color: theme.colors.error,
          }}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}

export class WorkspaceShellTalentUI implements TalentUI {
  readonly name = 'workspace_shell';

  renderResult(result: TalentResult): React.ReactNode {
    if (result.type !== 'text') {
      return null;
    }
    return <WorkspaceShellResultCard summary={result.summary} />;
  }
}
