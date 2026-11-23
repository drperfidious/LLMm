import * as React from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  Animated,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  Modal,
  Platform,
} from 'react-native';
import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import {useCameraPermission} from 'react-native-vision-camera';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Share from 'react-native-share';

import {observer} from 'mobx-react';
import {IconButton, Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {hasVideoCapability} from '../../utils/pal-capabilities';

import {
  ChevronUpIcon,
  VideoRecorderIcon,
  PlusIcon,
  AtomIcon,
} from '../../assets/icons';

import {useTheme} from '../../hooks';

import {createStyles} from './styles';

import {
  chatSessionStore,
  modelStore,
  palStore,
  ttsStore,
  uiStore,
} from '../../store';

import {MessageType} from '../../utils/types';
import {L10nContext, UserContext, randId} from '../../utils';

import {SendButton, StopButton, Menu, VoiceChip} from '..';
import {
  dirname,
  formatBytes,
  formatDocumentForChat,
  isReadableWorkspacePath,
  languageForWorkspacePath,
  sanitizeWorkspaceFileName,
  workspaceFileSystem,
  type WorkspaceEntry,
} from '../../services/workspace';

export interface ChatInputTopLevelProps {
  /** Whether the AI is currently streaming tokens */
  isStreaming?: boolean;
  /** Will be called on {@link SendButton} tap. Has {@link MessageType.PartialText} which can
   * be transformed to {@link MessageType.Text} and added to the messages list. */
  onSendPress: (message: MessageType.PartialText) => void;
  onStopPress?: () => void;
  onCancelEdit?: () => void;
  onPalBtnPress?: () => void;
  isStopVisible?: boolean;
  /** Controls the visibility behavior of the {@link SendButton} based on the
   * `TextInput` state. Defaults to `editing`. */
  sendButtonVisibilityMode?: 'always' | 'editing';
  textInputProps?: TextInputProps;
  isPickerVisible?: boolean;
  inputBackgroundColor?: string;
  /** External control for selected images (for edit mode) */
  defaultImages?: string[];
  onDefaultImagesChange?: (images: string[]) => void;

  /** Camera-specific props */
  isCameraActive?: boolean;
  onStartCamera?: () => void;
  /** For camera input, allows direct editing of the prompt text */
  promptText?: string;
  onPromptTextChange?: (text: string) => void;
  /** Whether to show the image upload button */
  showImageUpload?: boolean;
  isVisionEnabled?: boolean;
  /** Whether to show the thinking toggle button */
  showThinkingToggle?: boolean;
  /** Whether thinking mode is currently enabled */
  isThinkingEnabled?: boolean;
  /** Callback when thinking toggle is pressed */
  onThinkingToggle?: (enabled: boolean) => void;
}

export interface ChatInputAdditionalProps {
  /** Camera-specific props */
  isCameraActive?: boolean;
  onStartCamera?: () => void;
  /** For camera input, allows direct editing of the prompt text */
  promptText?: string;
  onPromptTextChange?: (text: string) => void;
  /** Whether to show the image upload button */
  showImageUpload?: boolean;
  /** Whether to show the thinking toggle button */
  showThinkingToggle?: boolean;
  /** Whether thinking mode is currently enabled */
  isThinkingEnabled?: boolean;
  /** Callback when thinking toggle is pressed */
  onThinkingToggle?: (enabled: boolean) => void;
}

export type ChatInputProps = ChatInputTopLevelProps & ChatInputAdditionalProps;

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

/** Bottom bar input component with a text input, attachment and
 * send buttons inside. By default hides send button when text input is empty. */
export const ChatInput = observer(
  ({
    isStreaming = false,
    onSendPress,
    onStopPress,
    onCancelEdit,
    onPalBtnPress,
    isStopVisible,
    sendButtonVisibilityMode,
    textInputProps,
    isPickerVisible,
    inputBackgroundColor,
    isCameraActive = false,
    onStartCamera,
    promptText,
    onPromptTextChange,
    showImageUpload = false,
    isVisionEnabled = false,
    defaultImages,
    onDefaultImagesChange,
    showThinkingToggle = false,
    isThinkingEnabled = false,
    onThinkingToggle,
  }: ChatInputProps) => {
    const l10n = React.useContext(L10nContext);
    const theme = useTheme();
    const user = React.useContext(UserContext);
    const inputRef = React.useRef<TextInput>(null);
    const editBarHeight = React.useRef(new Animated.Value(0)).current;
    const iconRotation = React.useRef(new Animated.Value(0)).current;
    const activePalId = chatSessionStore.activePalId;
    const currentActivePal = palStore.pals.find(pal => pal.id === activePalId);

    // Camera permission hook from react-native-vision-camera
    const {hasPermission, requestPermission} = useCameraPermission();

    const hasActiveModel = !!modelStore.activeModelId;

    // Use `defaultValue` if provided
    const [text, setText] = React.useState(textInputProps?.defaultValue ?? '');
    // State for selected images - use external control when provided
    const [internalSelectedImages, setInternalSelectedImages] = React.useState<
      string[]
    >([]);
    const selectedImages = defaultImages ?? internalSelectedImages;
    const setSelectedImages =
      onDefaultImagesChange ?? setInternalSelectedImages;
    // State for image upload menu
    const [showImageUploadMenu, setShowImageUploadMenu] = React.useState(false);
    const [showWorkspaceMenu, setShowWorkspaceMenu] = React.useState(false);
    const [workspaceEntries, setWorkspaceEntries] = React.useState<
      WorkspaceEntry[]
    >([]);
    const [workspaceFiles, setWorkspaceFiles] = React.useState<
      WorkspaceEntry[]
    >([]);
    const [workspaceStatus, setWorkspaceStatus] = React.useState('');
    const [cwdDialogVisible, setCwdDialogVisible] = React.useState(false);
    const [cwdDraft, setCwdDraft] = React.useState(
      chatSessionStore.workspaceCwd,
    );
    // State for showing "model not loaded" helper text
    const [showModelWarning, setShowModelWarning] = React.useState(false);
    const isEditMode = chatSessionStore.isEditMode;
    const isAgentMode = chatSessionStore.chatMode === 'agent';
    const workspaceCwd = chatSessionStore.workspaceCwd || '/';
    const isVoicePlaying =
      ttsStore.playbackState.mode === 'playing' ||
      ttsStore.playbackState.mode === 'streaming';
    const shouldShowVoiceChip = !isAgentMode || isVoicePlaying;

    const styles = createStyles({theme, isEditMode});

    // For camera input, use promptText if provided
    const isVideoCapable =
      currentActivePal && hasVideoCapability(currentActivePal);
    const value =
      isVideoCapable && promptText !== undefined
        ? promptText
        : (textInputProps?.value ?? text);

    React.useEffect(() => {
      if (isEditMode) {
        // Animate edit bar height
        Animated.spring(editBarHeight, {
          toValue: 28,
          useNativeDriver: false,
          friction: 8,
        }).start();
        // Focus input
        inputRef.current?.focus();
      } else {
        Animated.spring(editBarHeight, {
          toValue: 0,
          useNativeDriver: false,
          friction: 8,
        }).start();
        onCancelEdit?.();
      }
    }, [isEditMode, editBarHeight, onCancelEdit]);

    React.useEffect(() => {
      Animated.spring(iconRotation, {
        toValue: isPickerVisible ? 1 : 0,
        useNativeDriver: true,
        friction: 8,
      }).start();
    }, [isPickerVisible, iconRotation]);

    const handleChangeText = (newText: string) => {
      if (isVideoCapable && onPromptTextChange) {
        onPromptTextChange(newText);
      } else {
        setText(newText);
        textInputProps?.onChangeText?.(newText);
      }
    };

    const handleSend = () => {
      const trimmedValue = value.trim();
      if (trimmedValue) {
        // Check if model is loaded before sending
        if (!hasActiveModel) {
          // Trigger haptic feedback to indicate the action is blocked
          ReactNativeHapticFeedback.trigger(
            'notificationWarning',
            hapticOptions,
          );
          // Show warning helper text
          setShowModelWarning(true);
          // Auto-hide after 3 seconds
          setTimeout(() => setShowModelWarning(false), 3000);
          return;
        }

        // Include imageUris in the message object
        onSendPress({
          text: trimmedValue,
          type: 'text',
          imageUris: selectedImages.length > 0 ? selectedImages : undefined,
        });
        setText('');
        // Clear selected images after sending
        setSelectedImages([]);
      }
    };

    const refreshWorkspaceMenu = React.useCallback(async () => {
      try {
        const [entries, files] = await Promise.all([
          workspaceFileSystem.list('.', workspaceCwd),
          workspaceFileSystem.listFiles('', '', {maxEntries: 40}),
        ]);
        setWorkspaceEntries(entries);
        setWorkspaceFiles(files);
        setWorkspaceStatus('');
      } catch (error) {
        setWorkspaceStatus(
          error instanceof Error ? error.message : 'Could not read workspace',
        );
      }
    }, [workspaceCwd]);

    const openWorkspaceMenu = () => {
      setShowWorkspaceMenu(true);
      refreshWorkspaceMenu();
    };

    const addWorkspaceNote = async (
      text: string,
      metadata: Record<string, any>,
    ) => {
      if (!user) {
        return;
      }
      const message: MessageType.Text = {
        id: randId(),
        type: 'text',
        text,
        author: user,
        createdAt: Date.now(),
        status: 'sent',
        metadata,
      };
      await chatSessionStore.addMessageToCurrentSession(message);
    };

    const changeWorkspaceCwd = async (path: string) => {
      try {
        const next = await workspaceFileSystem.assertDirectory(
          path || '/',
          workspaceCwd,
        );
        chatSessionStore.setWorkspaceCwd(next);
        setCwdDraft(next);
        setWorkspaceStatus(`CWD set to ${next}`);
        setShowWorkspaceMenu(false);
      } catch (error) {
        setWorkspaceStatus(
          error instanceof Error ? error.message : 'Could not change directory',
        );
      }
    };

    const handleImportWorkspaceFiles = async () => {
      try {
        setShowWorkspaceMenu(false);
        const picked = await pick({
          mode: 'import',
          allowMultiSelection: true,
          type: Platform.OS === 'ios' ? 'public.data' : [types.allFiles],
        });
        const imported: WorkspaceEntry[] = [];
        for (const file of picked) {
          const name = sanitizeWorkspaceFileName(file.name);
          const target = await workspaceFileSystem.getAvailablePath(
            name,
            workspaceCwd,
          );
          const result = await workspaceFileSystem.importFile(file.uri, target);
          imported.push({
            name: result.path.split('/').pop() ?? result.path,
            path: result.path,
            type: 'file',
            size: result.size,
          });
        }

        if (imported.length > 0) {
          await addWorkspaceNote(
            [
              `Imported ${imported.length} workspace file(s) into ${workspaceCwd}:`,
              '',
              ...imported.map(
                entry => `- ${entry.path} (${formatBytes(entry.size)})`,
              ),
            ].join('\n'),
            {
              source: 'workspace_import',
              workspacePaths: imported.map(entry => entry.path),
            },
          );

          for (const entry of imported.filter(item =>
            isReadableWorkspacePath(item.path),
          )) {
            try {
              const result = await workspaceFileSystem.readFile(
                entry.path,
                '',
                256 * 1024,
              );
              await addWorkspaceNote(
                formatDocumentForChat({
                  path: result.path,
                  content: result.content,
                  language: languageForWorkspacePath(result.path),
                }),
                {
                  source: 'workspace_import_attachment',
                  workspacePath: result.path,
                },
              );
            } catch {
              // Keep the import itself successful even if extraction fails.
            }
          }
          setWorkspaceStatus(`Imported ${imported.length} file(s).`);
        }
        await refreshWorkspaceMenu();
      } catch (error) {
        if (
          isErrorWithCode(error) &&
          error.code === errorCodes.OPERATION_CANCELED
        ) {
          return;
        }
        setWorkspaceStatus('Import failed.');
      }
    };

    const handleCloneWorkspaceFile = async (entry: WorkspaceEntry) => {
      if (!isReadableWorkspacePath(entry.path)) {
        setWorkspaceStatus(
          'Only text-like files and PDFs can be cloned into chat.',
        );
        return;
      }
      try {
        const result = await workspaceFileSystem.readFile(
          entry.path,
          '',
          256 * 1024,
        );
        await addWorkspaceNote(
          formatDocumentForChat({
            path: result.path,
            content: result.content,
            language: languageForWorkspacePath(result.path),
          }),
          {
            source: 'workspace_document_clone',
            workspacePath: result.path,
          },
        );
        setWorkspaceStatus(`Cloned ${entry.path} into chat.`);
        setShowWorkspaceMenu(false);
      } catch (error) {
        setWorkspaceStatus(
          error instanceof Error ? error.message : 'Could not clone file',
        );
      }
    };

    const handleExportWorkspaceFile = async (entry: WorkspaceEntry) => {
      try {
        const {absolutePath} = workspaceFileSystem.resolve(entry.path);
        await Share.open({
          title: entry.name,
          url: absolutePath.startsWith('file://')
            ? absolutePath
            : `file://${absolutePath}`,
          failOnCancel: false,
        });
        setWorkspaceStatus('');
        setShowWorkspaceMenu(false);
      } catch {
        setWorkspaceStatus('Could not export file.');
      }
    };

    // Handle plus button press to show image upload menu
    const handlePlusButtonPress = () => {
      setShowImageUploadMenu(true);
    };

    // Need to figure this out:
    // Handle taking a photo with the camera using react-native-image-picker
    // but with permission checking from react-native-vision-camera
    const handleTakePhoto = async () => {
      try {
        if (!hasPermission) {
          const permissionResult = await requestPermission();
          if (!permissionResult) {
            Alert.alert(
              l10n.camera.permissionTitle,
              l10n.camera.permissionMessage,
            );
            setShowImageUploadMenu(false);
            return;
          }
        }

        // Disable auto-release during camera operation
        // this is only needed on Android.
        modelStore.disableAutoRelease('camera-photo');

        const result = await launchCamera({
          mediaType: 'photo',
          quality: 0.8,
        });

        if (result.assets && result.assets.length > 0 && result.assets[0].uri) {
          const newImages = [...selectedImages, result.assets[0].uri];
          setSelectedImages(newImages);
        }
        setShowImageUploadMenu(false);
      } catch (error) {
        console.error('Error taking photo:', error);
        Alert.alert(
          l10n.errors.cameraErrorTitle,
          l10n.errors.cameraErrorMessage,
        );
      } finally {
        // Re-enable auto-release after camera operation
        modelStore.enableAutoRelease('camera-photo');
      }
    };

    // Handle selecting images from the gallery
    const handleSelectImages = async () => {
      try {
        // Disable auto-release during gallery operation
        // this is only needed on Android.
        modelStore.disableAutoRelease('image-gallery');

        const result = await launchImageLibrary({
          mediaType: 'photo',
          selectionLimit: 5, // Allow multiple images
          quality: 0.8,
        });

        if (result.assets && result.assets.length > 0) {
          const newUris = result.assets
            .filter(asset => asset.uri)
            .map(asset => asset.uri as string);

          if (newUris.length > 0) {
            const newImages = [...selectedImages, ...newUris];
            setSelectedImages(newImages);
          }
        }
        setShowImageUploadMenu(false);
      } catch (error) {
        console.error('Error selecting images:', error);
        Alert.alert(
          l10n.errors.galleryErrorTitle,
          l10n.errors.galleryErrorMessage,
        );
      } finally {
        // Re-enable auto-release after gallery operation
        modelStore.enableAutoRelease('image-gallery');
      }
    };

    // Remove an image from the selection
    const handleRemoveImage = (index: number) => {
      const newImages = [...selectedImages];
      newImages.splice(index, 1);
      setSelectedImages(newImages);
    };

    const handleCancel = () => {
      setText('');
      onCancelEdit?.();
    };

    const isSendButtonVisible =
      !isStreaming &&
      !isStopVisible &&
      user &&
      !isVideoCapable && // Hide send button for video-capable pals
      (sendButtonVisibilityMode === 'always' || value.trim());
    const isSendButtonEnabled = value.trim().length > 0 && hasActiveModel;
    const sendButtonOpacity = isSendButtonEnabled ? 1 : 0.4;

    const rotateInterpolate = iconRotation.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '180deg'],
    });

    const onSurfaceColor = currentActivePal?.color?.[0] || theme.colors.text;
    const onSurfaceColorVariant = onSurfaceColor + '55'; // for disabled state or placeholder text
    // // Plus button state
    const isPlusButtonEnabled = !isStreaming && isVisionEnabled;
    const plusColor = isPlusButtonEnabled
      ? onSurfaceColor
      : onSurfaceColorVariant;
    const isModeToggleDisabled = isStreaming || !!isStopVisible;
    const setChatMode = (mode: 'chat' | 'agent') => {
      if (!isModeToggleDisabled) {
        chatSessionStore.setChatMode(mode);
      }
    };
    const currentDirectories = workspaceEntries
      .filter(entry => entry.type === 'directory')
      .slice(0, 8);
    const recentFiles = workspaceFiles.slice(0, 12);
    const cloneableFiles = workspaceFiles
      .filter(entry => isReadableWorkspacePath(entry.path))
      .slice(0, 12);
    const parentRel = dirname(workspaceCwd);
    const parentPath = parentRel ? `/${parentRel}` : '/';
    const shortCwd =
      workspaceCwd.length > 24 ? `…${workspaceCwd.slice(-23)}` : workspaceCwd;

    return (
      <View style={styles.container}>
        <View style={styles.inputContainer}>
          {/* Edit Bar (when in edit mode) */}
          {isEditMode && (
            <Animated.View
              style={[
                styles.editBar,
                {
                  height: editBarHeight,
                },
              ]}>
              <Text variant="labelSmall" style={styles.editBarText}>
                Editing message
              </Text>
              <IconButton
                icon="close"
                size={16}
                onPress={handleCancel}
                style={styles.editBarButton}
                iconColor={theme.colors.onSurfaceVariant}
              />
            </Animated.View>
          )}

          {/* Image Preview Section */}
          {selectedImages.length > 0 && (
            <View
              style={[
                styles.imagePreviewContainer,
                isEditMode && styles.imagePreviewContainerEditMode,
              ]}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.imageScrollContent}>
                {selectedImages.map((uri, index) => (
                  <View key={`${uri}-${index}`} style={styles.imageContainer}>
                    <Image
                      source={{uri}}
                      style={styles.previewImage}
                      accessibilityLabel={`Image preview ${index + 1} of ${
                        selectedImages.length
                      }`}
                    />
                    <IconButton
                      icon="close-circle"
                      size={20}
                      iconColor={theme.colors.error}
                      style={styles.removeImageButton}
                      onPress={() => handleRemoveImage(index)}
                      accessibilityLabel={`Remove image ${index + 1}`}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Text Input Area (Top Row) */}
          <View
            style={[
              styles.textInputArea,
              {
                paddingTop: isEditMode
                  ? selectedImages.length > 0
                    ? 8 // Reduced padding when images present in edit mode
                    : 48 // Edit bar height (28px) + normal padding (20px)
                  : selectedImages.length > 0
                    ? 0
                    : 20,
              },
            ]}>
            {/* Subtle Prompt Label for Video Pals */}
            {isVideoCapable && (
              <Text
                variant="labelSmall"
                style={[styles.promptLabel, {color: onSurfaceColorVariant}]}>
                {l10n.palsScreen.prompt}:
              </Text>
            )}
            <TextInput
              ref={inputRef}
              multiline
              placeholder={
                isVideoCapable
                  ? l10n.video.promptPlaceholder
                  : l10n.components.chatInput.inputPlaceholder
              }
              placeholderTextColor={onSurfaceColorVariant}
              underlineColorAndroid="transparent"
              {...textInputProps}
              style={[
                styles.input,
                textInputProps?.style,
                {
                  color: onSurfaceColor,
                },
                isVideoCapable && styles.inputWithLabel,
              ]}
              onChangeText={handleChangeText}
              value={value}
              editable={
                isVideoCapable
                  ? !isStreaming && !isCameraActive
                  : textInputProps?.editable !== false
              }
              testID="chat-input"
              accessibilityLabel="Message input"
            />
          </View>

          {/* Control Bar (Bottom Row) */}
          <View style={styles.controlBar}>
            {/* Left Controls */}
            <View style={styles.leftControls}>
              {/* Plus Button for Image Upload (only for regular chat) */}
              {showImageUpload && !isVideoCapable && (
                <Menu
                  visible={showImageUploadMenu}
                  onDismiss={() => setShowImageUploadMenu(false)}
                  anchorPosition="top"
                  anchor={
                    <TouchableOpacity
                      style={styles.plusButton}
                      disabled={!isPlusButtonEnabled}
                      onPress={
                        isPlusButtonEnabled ? handlePlusButtonPress : () => {}
                      }
                      accessibilityLabel="Add image"
                      accessibilityRole="button">
                      <PlusIcon width={20} height={20} stroke={plusColor} />
                    </TouchableOpacity>
                  }>
                  <Menu.Item
                    label={l10n.camera?.takePhoto || 'Camera'}
                    icon="camera"
                    onPress={handleTakePhoto}
                  />
                  <Menu.Item
                    label={l10n.common?.gallery || 'Gallery'}
                    icon="image"
                    onPress={handleSelectImages}
                  />
                </Menu>
              )}

              {/* Workspace Menu */}
              <View style={styles.palSelector}>
                <Menu
                  visible={showWorkspaceMenu}
                  onDismiss={() => setShowWorkspaceMenu(false)}
                  anchorPosition="top"
                  anchor={
                    <TouchableOpacity
                      style={[
                        styles.palBtn,
                        {
                          backgroundColor:
                            uiStore.colorScheme === 'dark'
                              ? theme.colors.inverseOnSurface
                              : theme.colors.inverseSurface,
                        },
                      ]}
                      onPress={openWorkspaceMenu}
                      accessibilityLabel="Chat workspace menu"
                      accessibilityRole="button"
                      testID="chat-workspace-menu-button">
                      <Animated.View
                        style={{
                          transform: [{rotate: rotateInterpolate}],
                        }}>
                        <ChevronUpIcon stroke={inputBackgroundColor} />
                      </Animated.View>
                    </TouchableOpacity>
                  }>
                  <Menu.Item
                    label={`CWD ${workspaceCwd}`}
                    icon="folder-outline"
                    disabled
                  />
                  <Menu.Item
                    label="Import files"
                    icon="file-import-outline"
                    onPress={handleImportWorkspaceFiles}
                  />
                  <Menu.Item
                    label="Clone file into chat"
                    icon="file-document-outline"
                    disabled={cloneableFiles.length === 0}
                    submenu={cloneableFiles.map(entry => (
                      <Menu.Item
                        key={`clone-${entry.path}`}
                        label={entry.path}
                        onPress={() => handleCloneWorkspaceFile(entry)}
                      />
                    ))}
                  />
                  <Menu.Item
                    label="Export file"
                    icon="export-variant"
                    disabled={recentFiles.length === 0}
                    submenu={recentFiles.map(entry => (
                      <Menu.Item
                        key={`export-${entry.path}`}
                        label={entry.path}
                        onPress={() => handleExportWorkspaceFile(entry)}
                      />
                    ))}
                  />
                  <Menu.Item
                    label="Change directory"
                    icon="folder-sync-outline"
                    submenu={[
                      <Menu.Item
                        key="root"
                        label="/"
                        onPress={() => changeWorkspaceCwd('/')}
                      />,
                      <Menu.Item
                        key="parent"
                        label="Parent"
                        disabled={workspaceCwd === '/'}
                        onPress={() => changeWorkspaceCwd(parentPath)}
                      />,
                      ...currentDirectories.map(entry => (
                        <Menu.Item
                          key={`dir-${entry.path}`}
                          label={entry.path}
                          onPress={() => changeWorkspaceCwd(entry.path)}
                        />
                      )),
                      <Menu.Item
                        key="custom"
                        label="Type path…"
                        onPress={() => {
                          setCwdDraft(workspaceCwd);
                          setShowWorkspaceMenu(false);
                          setCwdDialogVisible(true);
                        }}
                      />,
                    ]}
                  />
                  {workspaceStatus ? (
                    <Menu.Item label={workspaceStatus} disabled />
                  ) : null}
                </Menu>
                <Text
                  style={[styles.workspaceCwdChip, {color: onSurfaceColor}]}
                  numberOfLines={1}>
                  {shortCwd}
                </Text>
              </View>

              {!isVideoCapable && (
                <View
                  style={[
                    styles.modeToggle,
                    {borderColor: onSurfaceColorVariant},
                    isModeToggleDisabled && styles.modeToggleDisabled,
                  ]}
                  testID="chat-mode-toggle">
                  <TouchableOpacity
                    style={[
                      styles.modeToggleSegment,
                      !isAgentMode && {
                        backgroundColor: onSurfaceColor,
                      },
                    ]}
                    disabled={isModeToggleDisabled}
                    onPress={() => setChatMode('chat')}
                    accessibilityLabel="Use Chat mode"
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: !isAgentMode,
                      disabled: isModeToggleDisabled,
                    }}
                    testID="chat-mode-chat">
                    <Icon
                      name="message-text-outline"
                      size={13}
                      color={
                        !isAgentMode ? inputBackgroundColor : onSurfaceColor
                      }
                    />
                    <Text
                      style={[
                        styles.modeToggleText,
                        {
                          color: !isAgentMode
                            ? inputBackgroundColor
                            : onSurfaceColor,
                        },
                      ]}>
                      Chat
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modeToggleSegment,
                      isAgentMode && {
                        backgroundColor: onSurfaceColor,
                      },
                    ]}
                    disabled={isModeToggleDisabled}
                    onPress={() => setChatMode('agent')}
                    accessibilityLabel="Use Agent mode"
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: isAgentMode,
                      disabled: isModeToggleDisabled,
                    }}
                    testID="chat-mode-agent">
                    <Icon
                      name="robot-outline"
                      size={13}
                      color={
                        isAgentMode ? inputBackgroundColor : onSurfaceColor
                      }
                    />
                    <Text
                      style={[
                        styles.modeToggleText,
                        {
                          color: isAgentMode
                            ? inputBackgroundColor
                            : onSurfaceColor,
                        },
                      ]}>
                      Agent
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Thinking Toggle Button */}
              {showThinkingToggle && !isCameraActive && (
                <TouchableOpacity
                  style={[
                    styles.thinkingToggleLeft,
                    isThinkingEnabled && {backgroundColor: onSurfaceColor},
                    {borderColor: onSurfaceColorVariant},
                  ]}
                  onPress={() => onThinkingToggle?.(!isThinkingEnabled)}
                  accessibilityLabel={
                    isThinkingEnabled
                      ? l10n.components.chatInput.thinkingToggle.disableThinking
                      : l10n.components.chatInput.thinkingToggle.enableThinking
                  }
                  accessibilityRole="button">
                  <AtomIcon
                    width={14}
                    height={14}
                    stroke={
                      isThinkingEnabled
                        ? inputBackgroundColor
                        : onSurfaceColorVariant
                    }
                    strokeWidth={2}
                  />
                  <Text
                    style={[
                      styles.thinkingToggleText,
                      isThinkingEnabled
                        ? {color: inputBackgroundColor}
                        : {color: onSurfaceColorVariant},
                    ]}>
                    {l10n.components.chatInput.thinkingToggle.thinkText}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Right Controls */}
            <View style={styles.rightControls}>
              {/* Helper text for model not loaded */}
              {showModelWarning && !hasActiveModel && (
                <View style={styles.helperTextContainer}>
                  <Text variant="bodySmall" style={styles.helperText}>
                    {l10n.chat.cannotSendWithoutModel}
                  </Text>
                </View>
              )}

              {/* In Agent mode the tool controls need the width. Keep the
                  audio stop affordance visible only while speech is active. */}
              {shouldShowVoiceChip && (
                <View style={styles.voiceChipContainer}>
                  <VoiceChip compact={isAgentMode} />
                </View>
              )}

              {/* Send/Stop Button */}
              {isStopVisible ? (
                <StopButton color={onSurfaceColor} onPress={onStopPress} />
              ) : isVideoCapable && !isCameraActive ? (
                /* Compact Start Video Button for Video Pals */
                <TouchableOpacity
                  style={[
                    styles.compactVideoButton,
                    {
                      backgroundColor: onSurfaceColor,
                    },
                  ]}
                  onPress={onStartCamera}
                  accessibilityLabel="Start video analysis"
                  accessibilityRole="button">
                  <VideoRecorderIcon
                    width={16}
                    height={16}
                    stroke="white"
                    strokeWidth={2}
                  />
                  <Text style={styles.compactButtonText}>
                    {l10n.video.startCamera}
                  </Text>
                </TouchableOpacity>
              ) : (
                isSendButtonVisible && (
                  <View style={{opacity: sendButtonOpacity}}>
                    <SendButton color={onSurfaceColor} onPress={handleSend} />
                  </View>
                )
              )}
            </View>
          </View>
        </View>
        <Modal
          visible={cwdDialogVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCwdDialogVisible(false)}>
          <View style={styles.cwdDialogBackdrop}>
            <View
              style={[
                styles.cwdDialog,
                {backgroundColor: theme.colors.surface},
              ]}>
              <Text style={styles.cwdDialogTitle}>Set workspace directory</Text>
              <TextInput
                value={cwdDraft}
                onChangeText={setCwdDraft}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="/"
                placeholderTextColor={theme.colors.onSurfaceVariant}
                style={[
                  styles.cwdDialogInput,
                  {
                    color: theme.colors.onSurface,
                    borderColor: theme.colors.outlineVariant,
                  },
                ]}
              />
              <View style={styles.cwdDialogActions}>
                <TouchableOpacity
                  onPress={() => setCwdDialogVisible(false)}
                  style={styles.cwdDialogButton}>
                  <Text style={{color: theme.colors.onSurfaceVariant}}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setCwdDialogVisible(false);
                    changeWorkspaceCwd(cwdDraft);
                  }}
                  style={[
                    styles.cwdDialogButton,
                    {backgroundColor: theme.colors.primaryContainer},
                  ]}>
                  <Text
                    style={{
                      color: theme.colors.onPrimaryContainer,
                      fontWeight: '700',
                    }}>
                    Set
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  },
);
