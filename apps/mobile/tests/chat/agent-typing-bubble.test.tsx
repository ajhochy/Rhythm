import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { AgentTypingBubble } from '@/components/chat/agent-typing-bubble';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'dark' }));

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

let motionPreference: Deferred<boolean>;
let reduceMotionListener: ((enabled: boolean) => void) | undefined;
const removeReduceMotionListener = jest.fn();
const startAnimation = jest.fn();
const stopAnimation = jest.fn();

beforeEach(() => {
  motionPreference = deferred<boolean>();
  reduceMotionListener = undefined;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => motionPreference.promise);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(
    ((event: string, listener: (enabled: boolean) => void) => {
      expect(event).toBe('reduceMotionChanged');
      reduceMotionListener = listener;
      return { remove: removeReduceMotionListener };
    }) as never,
  );
  jest.spyOn(Animated, 'loop').mockReturnValue({
    start: startAnimation,
    stop: stopAnimation,
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('typing bubble stays static until the asynchronous reduced-motion preference is known', async () => {
  const screen = render(<AgentTypingBubble />);

  expect(screen.getByLabelText('Agent working')).toBeTruthy();
  expect(screen.getAllByLabelText('Agent working')).toHaveLength(1);
  expect(screen.getByLabelText('Agent working').props.accessibilityElementsHidden).toBeUndefined();
  expect(screen.getByLabelText('Agent working').props.importantForAccessibility).toBeUndefined();
  expect(screen.UNSAFE_getByProps({ accessibilityElementsHidden: true }).props.importantForAccessibility)
    .toBe('no-hide-descendants');
  const dots = [0, 1, 2].map((index) =>
    screen.UNSAFE_getByProps({ testID: `agent-typing-dot-${index}` }),
  );
  expect(dots.every((dot) => dot.props.accessible === false)).toBe(true);
  expect(StyleSheet.flatten(dots[0].props.style))
    .toEqual(expect.objectContaining({ backgroundColor: '#FFFFFF' }));
  expect(Animated.loop).not.toHaveBeenCalled();

  await act(async () => {
    motionPreference.resolve(false);
    await Promise.resolve();
  });

  expect(startAnimation).toHaveBeenCalledTimes(1);
  screen.unmount();
});

test('typing bubble honors reduced motion changes and cleans up its listener and animation on unmount', async () => {
  const screen = render(<AgentTypingBubble />);

  await act(async () => {
    motionPreference.resolve(false);
    await Promise.resolve();
  });
  expect(startAnimation).toHaveBeenCalledTimes(1);

  act(() => reduceMotionListener?.(true));
  expect(stopAnimation).toHaveBeenCalled();

  screen.unmount();
  expect(removeReduceMotionListener).toHaveBeenCalledTimes(1);
  expect(stopAnimation).toHaveBeenCalled();
});

test('typing bubble remains static when reduced motion is enabled', async () => {
  const screen = render(<AgentTypingBubble />);

  await act(async () => {
    motionPreference.resolve(true);
    await Promise.resolve();
  });
  expect(Animated.loop).not.toHaveBeenCalled();

  screen.unmount();
});

test('a newer enabled reduced-motion event wins over a late startup false preference', async () => {
  const screen = render(<AgentTypingBubble />);

  act(() => reduceMotionListener?.(true));
  await act(async () => {
    motionPreference.resolve(false);
    await Promise.resolve();
  });

  expect(Animated.loop).not.toHaveBeenCalled();
  expect(startAnimation).not.toHaveBeenCalled();
  screen.unmount();
});

test('a newer motion event also wins when the startup preference query fails', async () => {
  const screen = render(<AgentTypingBubble />);

  act(() => reduceMotionListener?.(false));
  expect(startAnimation).toHaveBeenCalledTimes(1);

  await act(async () => {
    motionPreference.reject(new Error('system preference unavailable'));
    await Promise.resolve();
  });

  expect(startAnimation).toHaveBeenCalledTimes(1);
  expect(stopAnimation).not.toHaveBeenCalled();
  screen.unmount();
});

test('typing bubble falls back to static dots when the motion preference cannot be read', async () => {
  const screen = render(<AgentTypingBubble />);

  await act(async () => {
    motionPreference.reject(new Error('system preference unavailable'));
    await Promise.resolve();
  });

  expect(Animated.loop).not.toHaveBeenCalled();
  screen.unmount();
});
