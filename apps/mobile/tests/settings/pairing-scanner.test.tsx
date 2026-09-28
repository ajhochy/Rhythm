import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { PaperProvider, Text } from 'react-native-paper';

import { PairingScanner } from '@/components/settings/pairing-scanner';

function renderScanner(overrides: Partial<ComponentProps<typeof PairingScanner>> = {}) {
  const props: ComponentProps<typeof PairingScanner> = {
    cameraHeight: 260,
    cameraPermission: 'denied',
    manualPayload: '',
    onManualPair: jest.fn(),
    onManualPayloadChange: jest.fn(),
    onOpenSettings: jest.fn(),
    onOpenSystemSettings: jest.fn(),
    onRequestCamera: jest.fn(),
    pairing: false,
    showManualEntry: true,
    signedIn: true,
    ...overrides,
  };
  return { props, screen: render(<PaperProvider><PairingScanner {...props} /></PaperProvider>) };
}

test('slice-b-pairing: denied camera access keeps retry and manual callbacks available', () => {
  // Regression caught: extracting pairing presentation swallows permission recovery or moves pairing logic into the component.
  const { props, screen } = renderScanner({ manualPayload: 'one-time-code' });

  expect(screen.getByText(/retry the permission request/i)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Allow camera for QR pairing' }));
  fireEvent.press(screen.getByRole('button', { name: 'Pair securely' }));
  expect(props.onRequestCamera).toHaveBeenCalledTimes(1);
  expect(props.onManualPair).toHaveBeenCalledTimes(1);
});

test('slice-b-pairing: granted camera access renders the callback-owned scanner frame', () => {
  // Regression caught: the reusable presentation replaces the route-owned camera scanner or its accessible framing.
  const { screen } = renderScanner({
    cameraPermission: 'granted',
    scanner: <Text>Camera scanner slot</Text>,
    showManualEntry: false,
  });

  expect(screen.getByLabelText('QR code scanner')).toBeTruthy();
  expect(screen.getByText('Camera scanner slot')).toBeTruthy();
  expect(screen.getByText('Scan the code from Rhythm on your Mac').props.numberOfLines).toBeUndefined();
});

test('slice-b-pairing-repair-c1: manual entry remains available when the camera UI is native', () => {
  // Regression caught: iOS loses its only fallback when QR scanning is unavailable.
  const { screen } = renderScanner({ showManualEntry: false });

  expect(screen.getByLabelText('Pairing payload')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Pair securely' })).toBeTruthy();
});

test('slice-b-pairing-repair-c2: permanently blocked camera access opens system settings', () => {
  // Regression caught: a permanently denied camera permission loops on an ineffective request action.
  const onOpenSystemSettings = jest.fn();
  const { screen } = renderScanner({
    cameraPermission: 'blocked',
    onOpenSystemSettings,
  });

  fireEvent.press(screen.getByRole('button', { name: 'Open iOS Settings' }));
  expect(onOpenSystemSettings).toHaveBeenCalledTimes(1);
});

test('slice-b-pairing-repair-c5: pairing progress and errors expose status and alert semantics', () => {
  // Regression caught: VoiceOver receives neither progress context nor an interrupting pairing error.
  const { screen } = renderScanner({ error: 'Could not pair safely.', pairing: true });

  expect(screen.getByRole('summary')).toHaveTextContent('Pairing securely…');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not pair safely.');
});
