import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ChatAttachment } from '@/components/chat/chat-drafts';
import {
  Colors,
  MinimumTouchTarget,
  Radii,
  Spacing,
} from '@/constants/theme';
import { MOBILE_ATTACHMENT_LIMIT_BYTES } from '@/lib/attachments/limits';

type CameraAttachmentSheetProps = {
  onCapture: (attachment: ChatAttachment) => void;
  onClose: () => void;
  palette: typeof Colors.light;
  visible: boolean;
};

function capturedPhotoName(now = new Date()) {
  const timestamp = now
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')
    .replaceAll(':', '-');
  return `Photo ${timestamp}.jpg`;
}

export function CameraAttachmentSheet({
  onCapture,
  onClose,
  palette,
  visible,
}: CameraAttachmentSheetProps) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const getPermissionRef = useRef(getPermission);
  const settingsRefreshPendingRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string>();
  getPermissionRef.current = getPermission;

  const showError = useCallback((message: string) => {
    setError(message);
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setCameraReady(false);
      setError(undefined);
      settingsRefreshPendingRef.current = false;
      return;
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !settingsRefreshPendingRef.current) return;
      settingsRefreshPendingRef.current = false;
      void getPermissionRef.current().catch((cause) => {
        showError(
          cause instanceof Error
            ? cause.message
            : 'Could not refresh camera access.',
        );
      });
    });
    return () => subscription.remove();
  }, [showError, visible]);

  async function capture() {
    if (!cameraReady || capturing || !cameraRef.current) return;
    setCapturing(true);
    setError(undefined);
    try {
      const photo = await cameraRef.current.takePictureAsync();
      let size: number | null = null;
      try {
        size = new File(photo.uri).size;
      } catch {
        // File metadata is best-effort; the send path still reads the capture.
      }
      if (typeof size === 'number' && size > MOBILE_ATTACHMENT_LIMIT_BYTES) {
        showError('Photo exceeds the 10 MB attachment limit.');
        return;
      }
      onCapture({
        filename: capturedPhotoName(),
        mime: 'image/jpeg',
        uri: photo.uri,
      });
      onClose();
    } catch (cause) {
      showError(
        cause instanceof Error ? cause.message : 'Could not take that photo.',
      );
    } finally {
      setCapturing(false);
    }
  }

  const permissionState = permission == null
    ? 'loading'
    : permission.granted
      ? 'granted'
      : permission.status === 'undetermined' || permission.canAskAgain
        ? 'requestable'
        : 'blocked';

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}>
      <SafeAreaView
        style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={[styles.header, { backgroundColor: palette.surface }]}>
          <Text variant="titleLarge" style={{ color: palette.text }}>
            Take Photo
          </Text>
          <Pressable
            accessibilityLabel="Close camera"
            accessibilityRole="button"
            hitSlop={Spacing.x2}
            onPress={onClose}
            style={styles.headerAction}
            testID="camera-close-button">
            <Text variant="labelLarge" style={{ color: palette.tint }}>
              Close
            </Text>
          </Pressable>
        </View>

        {permissionState === 'loading' ? (
          <View style={styles.centered} testID="camera-permission-loading">
            <ActivityIndicator color={palette.tint} />
            <Text variant="bodyLarge" style={{ color: palette.text }}>
              Checking camera access…
            </Text>
          </View>
        ) : permissionState === 'granted' ? (
          <View style={styles.cameraArea}>
            <CameraView
              facing="back"
              onCameraReady={() => setCameraReady(true)}
              ref={cameraRef}
              style={styles.camera}
            />
            <View
              style={[styles.captureBar, { backgroundColor: palette.surface }]}>
              {error ? (
                <Text
                  accessibilityLiveRegion="polite"
                  variant="bodyMedium"
                  style={{ color: palette.danger }}>
                  {error}
                </Text>
              ) : null}
              <Pressable
                accessibilityLabel="Take photo"
                accessibilityRole="button"
                disabled={!cameraReady || capturing}
                onPress={() => void capture()}
                style={({ pressed }) => [
                  styles.captureButton,
                  {
                    borderColor: palette.tint,
                    opacity: pressed || capturing ? 0.65 : 1,
                  },
                ]}
                testID="camera-capture-button">
                <View
                  style={[
                    styles.captureButtonCenter,
                    { backgroundColor: palette.tint },
                  ]}
                />
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centered}>
            <Text variant="headlineSmall" style={{ color: palette.text }}>
              Camera access needed
            </Text>
            <Text
              variant="bodyLarge"
              style={[styles.permissionCopy, { color: palette.muted }]}>
              Take a photo and attach it directly to this chat.
            </Text>
            {error ? (
              <Text
                accessibilityLiveRegion="polite"
                variant="bodyMedium"
                style={{ color: palette.danger }}>
                {error}
              </Text>
            ) : null}
            {permissionState === 'requestable' ? (
              <Pressable
                accessibilityLabel="Allow camera access"
                accessibilityRole="button"
                onPress={() => {
                  setError(undefined);
                  void requestPermission().catch((cause) => {
                    showError(
                      cause instanceof Error
                        ? cause.message
                        : 'Could not request camera access.',
                    );
                  });
                }}
                style={[
                  styles.permissionButton,
                  { backgroundColor: palette.tint },
                ]}
                testID="camera-permission-request">
                <Text
                  variant="labelLarge"
                  style={{ color: palette.onBubbleUser }}>
                  Allow Camera
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel="Open system settings"
                accessibilityRole="button"
                onPress={() => {
                  setError(undefined);
                  settingsRefreshPendingRef.current = true;
                  void Linking.openSettings().catch((cause) => {
                    settingsRefreshPendingRef.current = false;
                    showError(
                      cause instanceof Error
                        ? cause.message
                        : 'Could not open system Settings.',
                    );
                  });
                }}
                style={[
                  styles.permissionButton,
                  { backgroundColor: palette.tint },
                ]}
                testID="camera-permission-settings">
                <Text
                  variant="labelLarge"
                  style={{ color: palette.onBubbleUser }}>
                  Open Settings
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
  },
  cameraArea: {
    flex: 1,
  },
  captureBar: {
    alignItems: 'center',
    gap: Spacing.x2,
    minHeight: 116,
    paddingHorizontal: Spacing.x4,
    paddingVertical: Spacing.x3,
  },
  captureButton: {
    alignItems: 'center',
    borderRadius: Radii.pill,
    borderWidth: 3,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  captureButtonCenter: {
    borderRadius: Radii.pill,
    height: 56,
    width: 56,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.x4,
    justifyContent: 'center',
    padding: Spacing.x6,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: Spacing.x4,
  },
  headerAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MinimumTouchTarget,
    minWidth: MinimumTouchTarget,
  },
  permissionButton: {
    alignItems: 'center',
    borderRadius: Radii.control,
    justifyContent: 'center',
    minHeight: MinimumTouchTarget,
    paddingHorizontal: Spacing.x6,
  },
  permissionCopy: {
    maxWidth: 360,
    textAlign: 'center',
  },
  screen: {
    flex: 1,
  },
});
