import { fireEvent, render, within } from '@testing-library/react-native';
import { Keyboard, ScrollView, StyleSheet } from 'react-native';
import { Button, PaperProvider } from 'react-native-paper';

import {
  getToolDialogHorizontalMargin,
  getToolDialogKeyboardOverlap,
  getToolDialogMaxHeight,
  getToolDialogViewport,
  TOOL_DIALOG_ACTION_MIN_HEIGHT,
  ToolDialog,
} from '@/components/tools/tool-dialog';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 34, left: 59, right: 59, top: 47 }),
}));

const removeKeyboardListeners: jest.Mock[] = [];

beforeEach(() => {
  removeKeyboardListeners.length = 0;
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);
  jest.spyOn(Keyboard, 'addListener').mockImplementation((_event, _listener) => {
    const remove = jest.fn();
    removeKeyboardListeners.push(remove);
    return { remove } as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function dialog(visible: boolean, onDismiss: jest.Mock, onSave: jest.Mock) {
  return (
    <PaperProvider>
      <ToolDialog
        actions={[
          <Button key="cancel" onPress={onDismiss}>Cancel</Button>,
          <Button key="save" onPress={onSave}>Save profile</Button>,
        ]}
        onDismiss={onDismiss}
        testID="long-profile-dialog"
        title="Edit profile"
        visible={visible}>
        <Button>First field</Button>
        <Button>Long form field</Button>
      </ToolDialog>
    </PaperProvider>
  );
}

test('tool dialogs reserve a non-scrolling footer above an overlay keyboard at the maximum bounded height', () => {
  const onDismiss = jest.fn();
  const onSave = jest.fn();
  const screen = render(dialog(true, onDismiss, onSave));

  expect(getToolDialogMaxHeight(844, 47, 34)).toBe(731);
  expect(getToolDialogHorizontalMargin(0, 0)).toBe(26);
  expect(getToolDialogHorizontalMargin(59, 47)).toBe(59);
  expect(getToolDialogKeyboardOverlap(844, 508)).toBe(336);
  const viewport = getToolDialogViewport(844, 47, 34, 336);
  expect(viewport).toEqual({ maxHeight: 395, translateY: -168 });
  expect(viewport.maxHeight - TOOL_DIALOG_ACTION_MIN_HEIGHT).toBeGreaterThan(0);

  // Paper centers dialogs inside the safe viewport. This is the lower edge of
  // the largest allowed dialog after ToolDialog's keyboard translation.
  const footerBottom =
    47 +
    (844 - 47 - 34 - viewport.maxHeight) / 2 +
    viewport.translateY +
    viewport.maxHeight;
  expect(footerBottom).toBeLessThanOrEqual(844 - 336);

  const scroll = screen.getByTestId('long-profile-dialog-scroll');
  const actions = screen.getByTestId('long-profile-dialog-actions');
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(scroll.props.keyboardDismissMode).toBeDefined();
  expect(within(scroll).getByRole('button', { name: 'First field' })).toBeTruthy();
  expect(within(scroll).queryByRole('button', { name: 'Save profile' })).toBeNull();
  expect(within(actions).getByRole('button', { name: 'Save profile' })).toBeTruthy();
  expect(StyleSheet.flatten(actions.props.style)).toEqual(expect.objectContaining({
    flexGrow: 0,
    flexShrink: 0,
    minHeight: TOOL_DIALOG_ACTION_MIN_HEIGHT,
  }));
  expect(screen.getByRole('header', { name: 'Edit profile' }).props.numberOfLines).toBe(2);
  expect(screen.UNSAFE_getByType(ScrollView).props.showsVerticalScrollIndicator).toBe(true);

  fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
  fireEvent.press(screen.getByTestId('long-profile-dialog-backdrop'));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('tool dialogs release keyboard listeners after dismissal and attach fresh listeners when reopened', () => {
  const onDismiss = jest.fn();
  const onSave = jest.fn();
  const screen = render(dialog(true, onDismiss, onSave));

  expect(Keyboard.addListener).toHaveBeenCalledTimes(2);
  screen.rerender(dialog(false, onDismiss, onSave));
  expect(removeKeyboardListeners).toHaveLength(2);
  expect(removeKeyboardListeners.every((remove) => remove.mock.calls.length === 1)).toBe(true);

  screen.rerender(dialog(true, onDismiss, onSave));
  expect(Keyboard.addListener).toHaveBeenCalledTimes(4);
  screen.unmount();
  expect(removeKeyboardListeners.every((remove) => remove.mock.calls.length === 1)).toBe(true);
});
