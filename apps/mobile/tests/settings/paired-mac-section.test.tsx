import { fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { PairedMacSection } from '@/components/settings/paired-mac-section';
import { Colors } from '@/constants/theme';

describe('signed-in account bootstrap recovery', () => {
  test.each(['unsupported', 'retryableError', 'error', 'noAuthorizedComputer'] as const)(
    '%s offers only an explicit safe retry',
    (bootstrapState) => {
      const retry = jest.fn();
      const pair = jest.fn();
      const screen = render(
        <PaperProvider>
          <PairedMacSection
            bootstrapState={bootstrapState}
            host={null}
            message="Sanitized bootstrap failure"
            onForget={jest.fn()}
            onPair={pair}
            onRefresh={jest.fn()}
            onRetryBootstrap={retry}
            onRevoke={jest.fn()}
            palette={Colors.light}
            state="unpaired"
          />
        </PaperProvider>,
      );

      expect(screen.getByText('Sanitized bootstrap failure')).toBeTruthy();
      expect(retry).not.toHaveBeenCalled();
      fireEvent.press(screen.getByRole('button', { name: 'Retry connection' }));
      expect(retry).toHaveBeenCalledTimes(1);
      expect(pair).not.toHaveBeenCalled();
      // Recovery never removes the manual escape hatch, it just stops being the answer.
      fireEvent.press(screen.getByRole('button', { name: 'Pair a Mac' }));
      expect(pair).toHaveBeenCalledTimes(1);
      expect(retry).toHaveBeenCalledTimes(1);
    },
  );

  test('a stale cached host still leaves the retry action pressable', () => {
    const retry = jest.fn();
    const screen = render(
      <PaperProvider>
        <PairedMacSection
          bootstrapState="retryableError"
          host={{
            deviceId: 'device-1',
            deviceName: 'Rhythm iPhone',
            features: [],
            gatewayUrl: 'https://api.vcrcapps.com/relay',
            hostId: 'host-1',
            pairedAt: '2026-09-15T00:00:00.000Z',
          } as never}
          message="Could not reach Rhythm Cloud. Retry the secure connection."
          onForget={jest.fn()}
          onPair={jest.fn()}
          onRefresh={jest.fn()}
          onRetryBootstrap={retry}
          onRevoke={jest.fn()}
          palette={Colors.light}
          state="unpaired"
        />
      </PaperProvider>,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Retry connection' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
