import { fireEvent, render, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { PairedMacSection } from '@/components/settings/paired-mac-section';
import { Colors } from '@/constants/theme';

describe('signed-in account bootstrap recovery', () => {
  test('direct connection hides gateway addresses and uses the established copy', () => {
    // Regression caught: direct mode exposes host.gatewayUrl and changes the visible connection label.
    const screen = render(
      <PaperProvider>
        <PairedMacSection
          bootstrapState="idle"
          host={{
            deviceId: 'device-1',
            deviceName: 'Rhythm iPhone',
            features: [],
            gatewayUrl: 'https://private.gateway.invalid',
            hostId: 'host-1',
            pairedAt: '2026-09-15T00:00:00.000Z',
            rhythmVersion: '1',
            gatewayVersion: '1',
            opencodeVersion: '1',
          } as never}
          message="Connected"
          onForget={jest.fn()}
          onPair={jest.fn()}
          onRefresh={jest.fn()}
          onRetryBootstrap={jest.fn()}
          onRevoke={jest.fn()}
          palette={Colors.light}
          state="connected"
        />
      </PaperProvider>,
    );

    expect(screen.getByText('Secure Mac connection')).toBeTruthy();
    expect(screen.queryByText('Address')).toBeNull();
    expect(screen.queryByText('https://private.gateway.invalid')).toBeNull();
  });

  test('relay connection renders only its relay address', () => {
    // Regression caught: the relay row falls back to host.gatewayUrl.
    const screen = render(
      <PaperProvider>
        <PairedMacSection
          bootstrapState="idle"
          host={{
            deviceId: 'device-1',
            deviceName: 'Rhythm iPhone',
            features: [],
            gatewayUrl: 'https://private.gateway.invalid',
            relayUrl: 'https://relay.example.test',
            hostId: 'host-1',
            pairedAt: '2026-09-15T00:00:00.000Z',
            rhythmVersion: '1',
            gatewayVersion: '1',
            opencodeVersion: '1',
          } as never}
          message="Connected"
          onForget={jest.fn()}
          onPair={jest.fn()}
          onRefresh={jest.fn()}
          onRetryBootstrap={jest.fn()}
          onRevoke={jest.fn()}
          palette={Colors.light}
          state="connected"
        />
      </PaperProvider>,
    );

    expect(screen.getByText('Address')).toBeTruthy();
    expect(screen.getByText('https://relay.example.test')).toBeTruthy();
    expect(screen.queryByText('https://private.gateway.invalid')).toBeNull();
  });

  test('status summary remains a separate VoiceOver stop from its actions', () => {
    // Regression caught: making the whole card a summary hides nested action buttons from VoiceOver.
    const screen = render(
      <PaperProvider>
        <PairedMacSection
          bootstrapState="idle"
          host={null}
          message="Ready to pair"
          onForget={jest.fn()}
          onPair={jest.fn()}
          onRefresh={jest.fn()}
          onRetryBootstrap={jest.fn()}
          onRevoke={jest.fn()}
          palette={Colors.light}
          state="unpaired"
        />
      </PaperProvider>,
    );

    const summary = screen.getByLabelText('Paired Mac status: Not paired');
    expect(summary.props.accessibilityRole).toBe('summary');
    expect(within(summary).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pair a Mac' })).toBeTruthy();
    expect(screen.getByText('Mac connection').props.maxFontSizeMultiplier).toBeUndefined();
  });

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
