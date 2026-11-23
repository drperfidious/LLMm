import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

import Clipboard from '@react-native-clipboard/clipboard';
import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {observer} from 'mobx-react';
import {Button, Text} from 'react-native-paper';
import Share from 'react-native-share';

import {
  CloseIcon,
  EditBoxIcon,
  RefreshIcon,
  SearchIcon,
  ShareIcon,
  TrashIcon,
  UploadIcon,
  PlusIcon,
} from '../../assets/icons';
import {MarkdownView} from '../../components/MarkdownView';
import {TextInput} from '../../components';
import {useTheme} from '../../hooks';
import {t} from '../../locales';
import {chatSessionStore} from '../../store';
import {assistant, user} from '../../utils/chat';
import {L10nContext, randId} from '../../utils';
import {MessageType} from '../../utils/types';
import {ROUTES} from '../../utils/navigationConstants';
import {
  WorkspaceEntry,
  formatBytes,
  formatDocumentForChat,
  isReadableWorkspacePath,
  languageForWorkspacePath,
  sanitizeWorkspaceFileName,
  workspaceFileSystem,
} from '../../services/workspace';

import {createStyles} from './styles';

type SortMode = 'recent' | 'name' | 'size';

type PreviewState =
  | {status: 'idle'}
  | {status: 'loading'; path: string}
  | {status: 'binary'; path: string}
  | {status: 'ready'; path: string; content: string; language: string}
  | {status: 'error'; path: string; message: string};

function modifiedLabel(iso?: string): string {
  if (!iso) {
    return '';
  }
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) {
    return '';
  }
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 14) {
    return `${days}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}

export const DocumentsScreen: React.FC = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const l10n = useContext(L10nContext);
  const copy = l10n.components.documents;
  const navigation = useNavigation<any>();
  const {width} = useWindowDimensions();

  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [directories, setDirectories] = useState<WorkspaceEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({status: 'idle'});
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isManagingDirs, setIsManagingDirs] = useState(false);
  const [newNotePath, setNewNotePath] = useState(copy.defaultNoteName);
  const [newNoteBody, setNewNoteBody] = useState(copy.defaultNoteBody);
  const [newDirectoryPath, setNewDirectoryPath] = useState(
    copy.defaultFolderName,
  );

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [files, folders] = await Promise.all([
        workspaceFileSystem.listFiles(),
        workspaceFileSystem.listDirectories(),
      ]);
      setEntries(files);
      setDirectories(folders);
      if (selectedPath && !files.some(entry => entry.path === selectedPath)) {
        setSelectedPath(null);
        setPreview({status: 'idle'});
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [selectedPath]);

  useEffect(() => {
    reload();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const totalSize = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.size, 0),
    [entries],
  );
  const visibleDirectories = useMemo(
    () => directories.slice(0, 80),
    [directories],
  );

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? entries.filter(entry =>
          `${entry.name} ${entry.path}`.toLowerCase().includes(normalizedQuery),
        )
      : entries;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortMode === 'name') {
        return a.path.localeCompare(b.path);
      }
      if (sortMode === 'size') {
        return b.size - a.size;
      }
      const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
      const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
      return bTime - aTime;
    });
    return sorted;
  }, [entries, query, sortMode]);
  const selectedEntry = useMemo(
    () => entries.find(entry => entry.path === selectedPath) ?? null,
    [entries, selectedPath],
  );

  const closePreview = useCallback(() => {
    setSelectedPath(null);
    setPreview({status: 'idle'});
  }, []);

  const loadPreview = useCallback(
    async (entry: WorkspaceEntry) => {
      setSelectedPath(entry.path);
      setStatusMessage('');
      if (!isReadableWorkspacePath(entry.path)) {
        setPreview({status: 'binary', path: entry.path});
        return;
      }
      setPreview({status: 'loading', path: entry.path});
      try {
        const result = await workspaceFileSystem.readFile(
          entry.path,
          '',
          256 * 1024,
        );
        setPreview({
          status: 'ready',
          path: entry.path,
          content: result.content,
          language: languageForWorkspacePath(entry.path),
        });
      } catch (error) {
        setPreview({
          status: 'error',
          path: entry.path,
          message: error instanceof Error ? error.message : copy.loadFailed,
        });
      }
    },
    [copy.loadFailed],
  );

  const handleImport = useCallback(async () => {
    if (isImporting) {
      return;
    }
    setIsImporting(true);
    setStatusMessage('');
    try {
      const picked = await pick({
        mode: 'import',
        allowMultiSelection: true,
        type: Platform.OS === 'ios' ? 'public.data' : [types.allFiles],
      });
      let imported = 0;
      for (const file of picked) {
        const name = sanitizeWorkspaceFileName(file.name);
        const target = await workspaceFileSystem.getAvailablePath(
          `documents/${name}`,
        );
        await workspaceFileSystem.importFile(file.uri, target);
        imported++;
      }
      setStatusMessage(t(copy.imported, {count: String(imported)}));
      await reload();
    } catch (error) {
      if (
        isErrorWithCode(error) &&
        error.code === errorCodes.OPERATION_CANCELED
      ) {
        return;
      }
      setStatusMessage(copy.importFailed);
    } finally {
      setIsImporting(false);
    }
  }, [copy.importFailed, copy.imported, isImporting, reload]);

  const handleCreate = useCallback(async () => {
    setStatusMessage('');
    try {
      const safePath = newNotePath.trim() || copy.defaultNoteName;
      const target = await workspaceFileSystem.getAvailablePath(safePath);
      await workspaceFileSystem.writeFile(target, newNoteBody);
      setNewNotePath(copy.defaultNoteName);
      setNewNoteBody(copy.defaultNoteBody);
      setIsCreating(false);
      setStatusMessage(copy.created);
      await reload();
      const created = {path: target, name: target.split('/').pop() ?? target};
      await loadPreview(created as WorkspaceEntry);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : copy.createFailed,
      );
    }
  }, [
    copy.createFailed,
    copy.created,
    copy.defaultNoteBody,
    copy.defaultNoteName,
    loadPreview,
    newNoteBody,
    newNotePath,
    reload,
  ]);

  const handleCreateDirectory = useCallback(async () => {
    setStatusMessage('');
    try {
      const safePath = newDirectoryPath.trim() || copy.defaultFolderName;
      const result = await workspaceFileSystem.mkdir(safePath);
      setNewDirectoryPath(copy.defaultFolderName);
      setStatusMessage(t(copy.folderCreated, {path: result}));
      await reload();
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : copy.folderCreateFailed,
      );
    }
  }, [
    copy.defaultFolderName,
    copy.folderCreateFailed,
    copy.folderCreated,
    newDirectoryPath,
    reload,
  ]);

  const handleDeleteDirectory = useCallback(
    (entry: WorkspaceEntry) => {
      Alert.alert(
        copy.deleteFolderTitle,
        t(copy.deleteFolderMessage, {path: entry.path}),
        [
          {text: l10n.common.cancel, style: 'cancel'},
          {
            text: l10n.common.delete,
            style: 'destructive',
            onPress: async () => {
              try {
                await workspaceFileSystem.deletePath(entry.path);
                setStatusMessage(t(copy.folderDeleted, {path: entry.path}));
                await reload();
              } catch {
                setStatusMessage(copy.folderDeleteFailed);
              }
            },
          },
        ],
      );
    },
    [
      copy.deleteFolderMessage,
      copy.deleteFolderTitle,
      copy.folderDeleteFailed,
      copy.folderDeleted,
      l10n.common.cancel,
      l10n.common.delete,
      reload,
    ],
  );

  const handlePruneEmptyDirectories = useCallback(() => {
    Alert.alert(copy.pruneEmptyTitle, copy.pruneEmptyMessage, [
      {text: l10n.common.cancel, style: 'cancel'},
      {
        text: copy.pruneEmpty,
        style: 'destructive',
        onPress: async () => {
          try {
            const result = await workspaceFileSystem.deleteEmptyDirectories();
            setStatusMessage(
              t(copy.pruneEmptyComplete, {
                count: String(result.deleted.length),
              }),
            );
            await reload();
          } catch {
            setStatusMessage(copy.pruneEmptyFailed);
          }
        },
      },
    ]);
  }, [
    copy.pruneEmpty,
    copy.pruneEmptyComplete,
    copy.pruneEmptyFailed,
    copy.pruneEmptyMessage,
    copy.pruneEmptyTitle,
    l10n.common.cancel,
    reload,
  ]);

  const handleDelete = useCallback(
    (entry: WorkspaceEntry) => {
      Alert.alert(copy.deleteTitle, t(copy.deleteMessage, {path: entry.path}), [
        {text: l10n.common.cancel, style: 'cancel'},
        {
          text: l10n.common.delete,
          style: 'destructive',
          onPress: async () => {
            try {
              await workspaceFileSystem.deletePath(entry.path);
              setStatusMessage(copy.deleted);
              if (selectedPath === entry.path) {
                setSelectedPath(null);
                setPreview({status: 'idle'});
              }
              await reload();
            } catch {
              setStatusMessage(copy.deleteFailed);
            }
          },
        },
      ]);
    },
    [
      copy.deleteFailed,
      copy.deleteMessage,
      copy.deleteTitle,
      copy.deleted,
      l10n.common.cancel,
      l10n.common.delete,
      reload,
      selectedPath,
    ],
  );

  const handleClone = useCallback(
    async (entry: WorkspaceEntry) => {
      setStatusMessage('');
      if (!isReadableWorkspacePath(entry.path)) {
        setStatusMessage(copy.binaryCloneBlocked);
        return;
      }
      try {
        const result = await workspaceFileSystem.readFile(
          entry.path,
          '',
          256 * 1024,
        );
        const message: MessageType.Text = {
          id: randId(),
          type: 'text',
          text: formatDocumentForChat({
            path: result.path,
            content: result.content,
            language: languageForWorkspacePath(result.path),
          }),
          author: user,
          createdAt: Date.now(),
          status: 'sent',
          metadata: {
            source: 'workspace_document_clone',
            workspacePath: result.path,
            assistantId: assistant.id,
          },
        };
        await chatSessionStore.addMessageToCurrentSession(message);
        setStatusMessage(copy.cloned);
        navigation.navigate(ROUTES.CHAT);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : copy.cloneFailed,
        );
      }
    },
    [copy.binaryCloneBlocked, copy.cloneFailed, copy.cloned, navigation],
  );

  const handleCopy = useCallback(
    async (entry: WorkspaceEntry) => {
      setStatusMessage('');
      if (!isReadableWorkspacePath(entry.path)) {
        setStatusMessage(copy.binaryCloneBlocked);
        return;
      }
      try {
        const content =
          preview.status === 'ready' && preview.path === entry.path
            ? preview.content
            : (await workspaceFileSystem.readFile(entry.path, '', 256 * 1024))
                .content;
        Clipboard.setString(content);
        setStatusMessage(copy.copied);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : copy.copyFailed,
        );
      }
    },
    [copy.binaryCloneBlocked, copy.copied, copy.copyFailed, preview],
  );

  const handleShare = useCallback(
    async (entry: WorkspaceEntry) => {
      try {
        const {absolutePath} = workspaceFileSystem.resolve(entry.path);
        await Share.open({
          title: entry.name,
          url: absolutePath.startsWith('file://')
            ? absolutePath
            : `file://${absolutePath}`,
          failOnCancel: false,
        });
      } catch {
        setStatusMessage(copy.shareFailed);
      }
    },
    [copy.shareFailed],
  );

  const renderPreview = (entry: WorkspaceEntry) => {
    if (preview.status === 'idle' || preview.path !== entry.path) {
      return null;
    }
    if (preview.status === 'loading') {
      return (
        <View style={styles.previewLoading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      );
    }
    if (preview.status === 'binary') {
      return (
        <Text style={styles.previewMessage}>{copy.previewUnavailable}</Text>
      );
    }
    if (preview.status === 'error') {
      return <Text style={styles.previewError}>{preview.message}</Text>;
    }

    if (preview.language === 'markdown') {
      return (
        <ScrollView
          nestedScrollEnabled
          style={styles.previewScroll}
          contentContainerStyle={styles.markdownPreviewContent}>
          <MarkdownView
            markdownText={preview.content}
            maxMessageWidth={Math.max(240, width - 64)}
          />
        </ScrollView>
      );
    }

    return (
      <ScrollView
        nestedScrollEnabled
        style={styles.previewScroll}
        contentContainerStyle={styles.rawPreviewContent}>
        <Text selectable style={styles.rawPreviewText}>
          {preview.content}
        </Text>
      </ScrollView>
    );
  };

  const renderItem = ({item}: {item: WorkspaceEntry}) => {
    const selected = selectedPath === item.path;
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => loadPreview(item)}
        style={[styles.card, selected && styles.cardSelected]}
        testID={`documents-row-${item.path}`}>
        <View style={styles.cardHeader}>
          <View style={styles.fileIcon}>
            <EditBoxIcon width={18} height={18} stroke={theme.colors.primary} />
          </View>
          <View style={styles.fileText}>
            <Text
              variant="titleSmall"
              style={styles.fileName}
              numberOfLines={1}>
              {item.name}
            </Text>
            <Text variant="bodySmall" style={styles.fileMeta} numberOfLines={1}>
              {item.path} · {formatBytes(item.size)}
              {item.modifiedAt ? ` · ${modifiedLabel(item.modifiedAt)}` : ''}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.safeArea}>
      <FlatList
        testID="documents-screen"
        data={visibleEntries}
        keyExtractor={item => item.path}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <View style={styles.header}>
              <Text variant="headlineSmall" style={styles.title}>
                {copy.title}
              </Text>
              <Text variant="bodyMedium" style={styles.subtitle}>
                {copy.subtitle}
              </Text>
            </View>

            <View style={styles.summaryBand}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{entries.length}</Text>
                <Text style={styles.summaryLabel}>
                  {t(copy.count, {count: String(entries.length)})}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>
                  {formatBytes(totalSize)}
                </Text>
                <Text style={styles.summaryLabel}>
                  {t(copy.storage, {
                    size: formatBytes(totalSize),
                    folders: String(directories.length),
                  })}
                </Text>
              </View>
            </View>

            <View style={styles.toolbar}>
              <Button
                mode="contained"
                compact
                onPress={handleImport}
                disabled={isImporting}
                icon={({color}) => (
                  <UploadIcon width={16} height={16} stroke={color} />
                )}>
                {copy.import}
              </Button>
              <Button
                mode={isCreating ? 'contained' : 'outlined'}
                compact
                onPress={() => setIsCreating(value => !value)}>
                {copy.newNote}
              </Button>
              <Button
                mode={isManagingDirs ? 'contained' : 'outlined'}
                compact
                onPress={() => setIsManagingDirs(value => !value)}
                icon={({color}) => (
                  <PlusIcon width={16} height={16} stroke={color} />
                )}>
                {copy.manageFolders}
              </Button>
              <Button
                mode="text"
                compact
                onPress={reload}
                disabled={isLoading}
                icon={({color}) => (
                  <RefreshIcon width={16} height={16} stroke={color} />
                )}>
                {copy.refresh}
              </Button>
            </View>

            {isCreating ? (
              <View style={styles.createPanel}>
                <View style={styles.createPanelHeader}>
                  <Text variant="titleSmall" style={styles.createPanelTitle}>
                    {copy.newNote}
                  </Text>
                  <TouchableOpacity onPress={() => setIsCreating(false)}>
                    <CloseIcon
                      width={18}
                      height={18}
                      stroke={theme.colors.onSurfaceVariant}
                    />
                  </TouchableOpacity>
                </View>
                <TextInput
                  label={copy.nameLabel}
                  value={newNotePath}
                  onChangeText={setNewNotePath}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <TextInput
                  label={copy.bodyLabel}
                  value={newNoteBody}
                  onChangeText={setNewNoteBody}
                  multiline
                  style={[styles.input, styles.bodyInput]}
                />
                <Button mode="contained" onPress={handleCreate}>
                  {copy.create}
                </Button>
              </View>
            ) : null}

            {isManagingDirs ? (
              <View style={styles.createPanel} testID="documents-dir-manager">
                <View style={styles.createPanelHeader}>
                  <Text variant="titleSmall" style={styles.createPanelTitle}>
                    {copy.manageFolders}
                  </Text>
                  <TouchableOpacity onPress={() => setIsManagingDirs(false)}>
                    <CloseIcon
                      width={18}
                      height={18}
                      stroke={theme.colors.onSurfaceVariant}
                    />
                  </TouchableOpacity>
                </View>
                <TextInput
                  testID="documents-folder-path"
                  label={copy.folderNameLabel}
                  value={newDirectoryPath}
                  onChangeText={setNewDirectoryPath}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <View style={styles.actionRow}>
                  <Button
                    testID="documents-create-folder"
                    mode="contained"
                    compact
                    onPress={handleCreateDirectory}>
                    {copy.createFolder}
                  </Button>
                  <Button
                    testID="documents-prune-empty-folders"
                    mode="outlined"
                    compact
                    onPress={handlePruneEmptyDirectories}>
                    {copy.pruneEmpty}
                  </Button>
                </View>
                <View style={styles.folderList}>
                  <Text style={styles.folderListTitle}>
                    {t(copy.folderCount, {
                      count: String(directories.length),
                    })}
                  </Text>
                  {visibleDirectories.length === 0 ? (
                    <Text style={styles.previewMessage}>{copy.noFolders}</Text>
                  ) : (
                    visibleDirectories.map(entry => (
                      <View
                        key={entry.path}
                        style={styles.folderRow}
                        testID={`documents-dir-row-${entry.path}`}>
                        <View style={styles.fileText}>
                          <Text
                            variant="bodyMedium"
                            style={styles.fileName}
                            numberOfLines={1}>
                            {entry.path}
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={styles.fileMeta}
                            numberOfLines={1}>
                            {entry.modifiedAt
                              ? modifiedLabel(entry.modifiedAt)
                              : copy.folder}
                          </Text>
                        </View>
                        <Button
                          compact
                          mode="text"
                          textColor={theme.colors.error}
                          onPress={() => handleDeleteDirectory(entry)}>
                          {l10n.common.delete}
                        </Button>
                      </View>
                    ))
                  )}
                </View>
              </View>
            ) : null}

            <View style={styles.searchRow}>
              <SearchIcon
                width={18}
                height={18}
                stroke={theme.colors.primary}
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={copy.searchPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.searchInput}
              />
            </View>

            <View style={styles.sortRow}>
              {(['recent', 'name', 'size'] as SortMode[]).map(mode => (
                <Button
                  key={mode}
                  compact
                  mode={sortMode === mode ? 'contained' : 'outlined'}
                  onPress={() => setSortMode(mode)}>
                  {mode === 'recent'
                    ? copy.sortRecent
                    : mode === 'name'
                      ? copy.sortName
                      : copy.sortSize}
                </Button>
              ))}
            </View>

            {statusMessage ? (
              <Text style={styles.statusText}>{statusMessage}</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="titleMedium" style={styles.emptyTitle}>
              {copy.emptyTitle}
            </Text>
            <Text variant="bodySmall" style={styles.emptyBody}>
              {copy.emptyBody}
            </Text>
          </View>
        }
      />
      <Modal
        visible={!!selectedEntry}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closePreview}>
        <View style={styles.reader}>
          {selectedEntry ? (
            <>
              <View style={styles.readerHeader}>
                <View style={styles.readerTitleWrap}>
                  <Text
                    variant="titleMedium"
                    style={styles.readerTitle}
                    numberOfLines={1}>
                    {selectedEntry.name}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={styles.readerMeta}
                    numberOfLines={1}>
                    {selectedEntry.path} · {formatBytes(selectedEntry.size)}
                    {selectedEntry.modifiedAt
                      ? ` · ${modifiedLabel(selectedEntry.modifiedAt)}`
                      : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={l10n.common.close}
                  onPress={closePreview}
                  style={styles.closeButton}>
                  <CloseIcon
                    width={20}
                    height={20}
                    stroke={theme.colors.onSurfaceVariant}
                  />
                </TouchableOpacity>
              </View>
              <View style={styles.readerBody}>
                {renderPreview(selectedEntry)}
              </View>
              <View style={styles.readerActions}>
                <Button
                  compact
                  mode="contained"
                  onPress={() => handleClone(selectedEntry)}
                  style={styles.actionButton}>
                  {copy.clone}
                </Button>
                <Button
                  testID="documents-copy"
                  compact
                  mode="outlined"
                  onPress={() => handleCopy(selectedEntry)}
                  disabled={
                    preview.status !== 'ready' ||
                    preview.path !== selectedEntry.path
                  }>
                  {copy.copy}
                </Button>
                <Button
                  compact
                  mode="outlined"
                  onPress={() => handleShare(selectedEntry)}
                  icon={({color}) => (
                    <ShareIcon width={16} height={16} stroke={color} />
                  )}>
                  {copy.share}
                </Button>
                <Button
                  compact
                  mode="text"
                  textColor={theme.colors.error}
                  onPress={() => handleDelete(selectedEntry)}
                  icon={({color}) => (
                    <TrashIcon width={16} height={16} stroke={color} />
                  )}>
                  {l10n.common.delete}
                </Button>
              </View>
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
});

export default DocumentsScreen;
