import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Dialog } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DIALOG_EDGE_GUTTER = 16;
const DIALOG_HORIZONTAL_GUTTER = 26;
export const TOOL_DIALOG_ACTION_MIN_HEIGHT = 56;

export function getToolDialogHorizontalMargin(
  leftInset: number,
  rightInset: number,
) {
  return Math.max(leftInset, rightInset, DIALOG_HORIZONTAL_GUTTER);
}

export function getToolDialogKeyboardOverlap(
  windowHeight: number,
  keyboardScreenY: number,
) {
  return Math.max(0, windowHeight - keyboardScreenY);
}

export function getToolDialogMaxHeight(
  windowHeight: number,
  topInset: number,
  bottomInset: number,
  keyboardOverlap = 0,
) {
  return Math.max(
    1,
    windowHeight -
      topInset -
      bottomInset -
      keyboardOverlap -
      DIALOG_EDGE_GUTTER * 2,
  );
}

/**
 * Paper centers its dialog inside the safe-area wrapper. When iOS overlays a
 * keyboard rather than resizing the window, reducing the height alone leaves
 * the centered footer under the keyboard. Shift half of the overlap as well:
 * at the maximum dialog height its lower edge remains above the keyboard.
 */
export function getToolDialogViewport(
  windowHeight: number,
  topInset: number,
  bottomInset: number,
  keyboardOverlap: number,
) {
  return {
    maxHeight: getToolDialogMaxHeight(
      windowHeight,
      topInset,
      bottomInset,
      keyboardOverlap,
    ),
    translateY: keyboardOverlap > 0 ? -keyboardOverlap / 2 : 0,
  };
}

function overlapForKeyboardEvent(windowHeight: number, event: KeyboardEvent) {
  return getToolDialogKeyboardOverlap(windowHeight, event.endCoordinates.screenY);
}

type ToolDialogProps = {
  actions: readonly ReactNode[];
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  onDismiss: () => void;
  testID?: string;
  title: ReactNode;
  visible: boolean;
};

/**
 * Keeps long tool forms inside the usable viewport while leaving their
 * dismissal and action affordances outside the scrolling content.
 */
export function ToolDialog({
  actions,
  children,
  contentStyle,
  onDismiss,
  testID,
  title,
  visible,
}: ToolDialogProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);

  useEffect(() => {
    if (!visible) {
      setKeyboardOverlap(0);
      return undefined;
    }

    const updateKeyboardOverlap = (event: KeyboardEvent) => {
      setKeyboardOverlap(overlapForKeyboardEvent(height, event));
    };
    const resetKeyboardOverlap = () => setKeyboardOverlap(0);
    const metrics = Keyboard.metrics?.();
    if (metrics) {
      setKeyboardOverlap(getToolDialogKeyboardOverlap(height, metrics.screenY));
    }

    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
      updateKeyboardOverlap,
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      resetKeyboardOverlap,
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [height, visible]);

  const viewport = getToolDialogViewport(
    height,
    insets.top,
    insets.bottom,
    keyboardOverlap,
  );

  return (
    <Dialog
      onDismiss={onDismiss}
      style={[
        {
          marginHorizontal: getToolDialogHorizontalMargin(insets.left, insets.right),
          maxHeight: viewport.maxHeight,
          transform: [{ translateY: viewport.translateY }],
        },
      ]}
      testID={testID}
      visible={visible}>
      <Dialog.Title numberOfLines={2}>{title}</Dialog.Title>
      <>
        <Dialog.ScrollArea style={styles.scrollArea}>
          <ScrollView
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            style={styles.scroll}
            testID={testID ? `${testID}-scroll` : undefined}>
            {children}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions
          style={styles.actions}
          testID={testID ? `${testID}-actions` : undefined}>
          {actions}
        </Dialog.Actions>
      </>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexGrow: 0,
    flexShrink: 0,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    minHeight: TOOL_DIALOG_ACTION_MIN_HEIGHT,
  },
  content: { gap: 14, paddingBottom: 8, paddingTop: 8 },
  scroll: { flex: 1, minHeight: 0 },
  scrollArea: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
});
