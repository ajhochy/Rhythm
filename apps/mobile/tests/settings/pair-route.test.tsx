import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { PaperProvider } from 'react-native-paper';

import PairScreen from '@/app/pair';

const mockPair = jest.fn().mockResolvedValue(undefined);
let mockAccount: { state: 'signedIn' | 'signedOut'; user: { id: string } | null } = {
  state: 'signedIn',
  user: { id: 'user-1' },
};
let mockCameraPermission = { canAskAgain: true, granted: true, status: 'granted' };
let mockParams: { payload?: string } = {};

jest.mock('expo-camera', () => {
  const { View } = jest.requireActual('react-native');
  return {
    CameraView: () => <View testID="pair-camera-view" />,
    useCameraPermissions: () => [mockCameraPermission, jest.fn()],
  };
});

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@rhythm/mobile-runtime', () => ({
  mobileRuntimeVariant: {
    simulatedPairingPayload: () => 'simulated-payload',
    simulatedPairingTestId: 'pair-simulate-qr',
  },
}));

jest.mock('@/lib/pairing/paired-host-store', () => ({
  PairedHostError: class PairedHostError extends Error {
    kind = 'replacementRequired';
  },
}));

jest.mock('@/providers/paired-host-provider', () => ({
  usePairedHost: () => ({
    host: null,
    pair: mockPair,
    state: 'unpaired',
  }),
}));

jest.mock('@/providers/rhythm-account-provider', () => ({
  useRhythmAccount: () => mockAccount,
}));

const mockRouter = jest.requireMock('expo-router').router as {
  back: jest.Mock;
  replace: jest.Mock;
};

function renderRoute() {
  return render(
    <PaperProvider>
      <PairScreen />
    </PaperProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPair.mockResolvedValue(undefined);
  mockAccount = { state: 'signedIn', user: { id: 'user-1' } };
  mockCameraPermission = { canAskAgain: true, granted: true, status: 'granted' };
  mockParams = {};
});

test('pair route consumes a signed-in payload once and returns to Settings', async () => {
  mockParams = { payload: 'route-payload' };
  renderRoute();

  await waitFor(() => expect(mockPair).toHaveBeenCalledWith(
    'route-payload',
    { replaceExisting: false },
  ));
  await act(async () => {
    await mockPair.mock.results[0]?.value;
  });
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/settings');
});

test('pair route blocks every pairing input while signed out', () => {
  mockAccount = { state: 'signedOut', user: null };
  const screen = renderRoute();

  expect(screen.getByText(
    'Sign in to the same Rhythm account on this iPhone and Mac before pairing.',
  )).toBeTruthy();
  expect(screen.queryByLabelText('QR code scanner')).toBeNull();
  expect(screen.queryByTestId('pair-camera-view')).toBeNull();
  expect(screen.getByLabelText('Pairing payload')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Pair securely' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Scan test QR code' })).toBeDisabled();

  fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/settings');
  expect(mockPair).not.toHaveBeenCalled();
});
