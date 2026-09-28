import { fireEvent, render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { McpSection } from '@/components/settings/mcp-section';
import { AiDefaultsSection, ConnectionSection } from '@/components/settings/settings-sections';
import { Colors } from '@/constants/theme';

test('slice4-c4-c5: connection and model settings preserve inputs and wrap caller IDs', () => {
  // Regression caught: grouped presentation drops connection test IDs or hides stable model IDs.
  const longModelId = 'provider/model-with-a-very-long-stable-identifier-that-must-wrap';
  const screen = render(
    <PaperProvider>
      <ConnectionSection
        connection={{ status: 'error', message: 'Offline. Local availability only.' }}
        isConnecting={false}
        onReconnect={jest.fn()}
        palette={Colors.light}
        settings={{ directory: '', serverUrl: 'http://localhost:4096', username: 'user', password: 'secret' }}
        updateSettings={jest.fn()}
      />
      <AiDefaultsSection
        availableModels={[{ id: longModelId, label: 'Long model', providerID: 'provider', supportsReasoning: true }] as never}
        availableProviders={[{ configured: true, id: 'provider', label: 'Provider' }] as never}
        chatPreferences={{} as never}
        configuredProviders={[{ configured: true, id: 'provider', label: 'Provider' }] as never}
        enabledModelIds={new Set([longModelId])}
        expandedProviderId="provider"
        onExpandedProviderChange={jest.fn()}
        onModelToggle={jest.fn()}
        onRemoveProvider={jest.fn()}
        onStartProviderConfiguration={jest.fn()}
        palette={Colors.light}
      />
    </PaperProvider>,
  );

  expect(screen.getByTestId('settings-server-url-input')).toBeTruthy();
  expect(screen.getByTestId('settings-username-input')).toBeTruthy();
  expect(screen.getByTestId('settings-password-input')).toBeTruthy();
  expect(screen.getByTestId('settings-reconnect-button')).toBeTruthy();
  expect(screen.getByText('Offline. Local availability only.')).toBeTruthy();
  expect(screen.getByText(`${longModelId} · Reasoning supported`).props.numberOfLines).toBe(0);
});

test('slice4-c6: MCP rows separate status dimensions and keep technical targets visible', () => {
  // Regression caught: one ambiguous status chip replaces auth, enablement, and configuration detail.
  const longUrl = 'https://example.com/a/very/long/model-context-protocol/server/path';
  const screen = render(
    <PaperProvider>
      <McpSection
        configs={{ docs: { enabled: true, type: 'remote', url: longUrl } }}
        mcpStatuses={{ docs: { status: 'needs_auth' } as never }}
        onAdd={jest.fn()}
        onCompleteOAuth={jest.fn()}
        onConnect={jest.fn()}
        onDisconnect={jest.fn()}
        onRefresh={jest.fn()}
        onSetEnabled={jest.fn()}
        onStartOAuth={jest.fn()}
        palette={Colors.light}
      />
    </PaperProvider>,
  );

  expect(screen.getByText('Reachability')).toBeTruthy();
  expect(screen.getByText('Authentication')).toBeTruthy();
  expect(screen.getByText('Enablement')).toBeTruthy();
  expect(screen.getByText('Configuration')).toBeTruthy();
  expect(screen.getByText(longUrl).props.numberOfLines).toBe(0);
  expect(screen.getByTestId('settings-mcp-name')).toBeTruthy();
  expect(screen.getByTestId('settings-mcp-target')).toBeTruthy();
  expect(screen.getByTestId('settings-mcp-add')).toBeTruthy();
});

test('configured provider label is the remove button name with a removal hint', () => {
  // Regression caught: grouped provider rows rename the established OpenRouter removal control.
  const onRemoveProvider = jest.fn();
  const screen = render(
    <PaperProvider>
      <AiDefaultsSection
        availableModels={[]}
        availableProviders={[{ configured: true, id: 'openrouter', label: 'OpenRouter' }] as never}
        chatPreferences={{} as never}
        configuredProviders={[{ configured: true, id: 'openrouter', label: 'OpenRouter' }] as never}
        enabledModelIds={new Set()}
        onExpandedProviderChange={jest.fn()}
        onModelToggle={jest.fn()}
        onRemoveProvider={onRemoveProvider}
        onStartProviderConfiguration={jest.fn()}
        palette={Colors.light}
      />
    </PaperProvider>,
  );

  const remove = screen.getByRole('button', { name: 'OpenRouter' });
  expect(remove.props.accessibilityHint).toBe('Removes provider');
  fireEvent.press(remove);
  expect(onRemoveProvider).toHaveBeenCalledWith('openrouter');
});
