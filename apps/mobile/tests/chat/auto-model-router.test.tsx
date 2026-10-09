import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { PaperProvider } from 'react-native-paper';

import { ChatComposer } from '@/components/chat/chat-composer';
import { SessionConfigurationSheet } from '@/components/chat/session-configuration-sheet';
import { Colors } from '@/constants/theme';
import {
  buildPromptExecutionPlan,
  defaultChatPreferences,
  getRouterPick,
  hydratePreferencesFromSession,
  routerPickLabel,
  type AgentOption,
  type ChatPreferences,
  type ModelOption,
  type SessionExecutionState,
} from '@/providers/opencode-provider-utils';

const secretary = {
  id: 'secretary',
  profileId: 'secretary',
  opencodeAgentId: 'secretary',
  label: 'Secretary',
} as AgentOption;

const model = {
  id: 'anthropic/claude-sonnet-4',
  label: 'Claude Sonnet 4',
  providerID: 'anthropic',
  providerLabel: 'Anthropic',
  modelID: 'claude-sonnet-4',
  supportsReasoning: true,
  supportsAttachments: true,
  inputModalities: ['text'],
  supportsToolCalls: true,
} as ModelOption;

const bound: SessionExecutionState = {
  profileId: 'secretary' as never,
  opencodeAgentId: 'secretary' as never,
  profileAvailability: 'available',
  providerId: 'anthropic',
  modelId: 'claude-sonnet-4',
  thinkingBudget: null,
  permissionMode: 'default',
};

function sheet(preferences: ChatPreferences, onCreate = jest.fn().mockResolvedValue(undefined)) {
  return (
    <PaperProvider>
      <SessionConfigurationSheet
        availableModels={[model]}
        availableProfiles={[secretary]}
        availableProviders={[{ id: 'anthropic', label: 'Anthropic', modelCount: 1, configured: true, connected: true }]}
        mode="create"
        onCreate={onCreate}
        onDismiss={jest.fn()}
        palette={Colors.light}
        preferences={preferences}
        visible
      />
    </PaperProvider>
  );
}

describe('Auto (router) model option', () => {
  afterEach(cleanup);

  test('new sessions default to Auto and the picker lists Auto first', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);
    const screen = render(sheet({ ...defaultChatPreferences, modelId: model.id, modelMode: 'fixed' }, onCreate));
    expect(screen.getByLabelText('Model, Auto (router)')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Model, Auto (router)'));
    const titles = screen.getAllByText(/Auto \(router\)|Claude Sonnet 4/).map((node) => node.props.children);
    expect(titles[0]).toBe('Auto (router)');
    expect(titles).toContain('Claude Sonnet 4');

    fireEvent.press(screen.getByText('Claude Sonnet 4'));
    expect(screen.getByLabelText('Model, Claude Sonnet 4')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Model, Claude Sonnet 4'));
    fireEvent.press(screen.getByLabelText('Auto (router)'));
    fireEvent.press(screen.getByText('Create'));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(undefined, expect.objectContaining({ modelMode: 'auto' })));
  });

  test('a concrete pick is created as fixed', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);
    const screen = render(sheet(defaultChatPreferences, onCreate));
    fireEvent.press(screen.getByLabelText('Model, Auto (router)'));
    fireEvent.press(screen.getByText('Claude Sonnet 4'));
    fireEvent.press(screen.getByText('Create'));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ modelMode: 'fixed', modelId: model.id }),
      ));
  });

  test('Auto omits model from the prompt body; a concrete model sends it', () => {
    const auto = buildPromptExecutionPlan(bound, { ...defaultChatPreferences, modelId: model.id, modelMode: 'auto' });
    expect(auto.persistAllowed).toBe(true);
    // promptAsync spreads `model` only when defined, so this is what reaches the wire.
    const body = (plan: typeof auto) => ({ sessionID: 's1', ...(plan.model !== undefined ? { model: plan.model } : {}), parts: [] });
    expect(body(auto)).not.toHaveProperty('model');

    const fixed = buildPromptExecutionPlan(bound, { ...defaultChatPreferences, modelId: model.id, modelMode: 'fixed' });
    expect(body(fixed).model).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-4' });
  });

  test('sessions with an explicit stored model keep it unless the server says auto', () => {
    expect(hydratePreferencesFromSession(bound, defaultChatPreferences).modelMode).toBe('fixed');
    expect(hydratePreferencesFromSession({ ...bound, modelMode: 'auto' }, defaultChatPreferences).modelMode).toBe('auto');
  });

  test('router pick label comes from the latest assistant message and hides for a concrete model', () => {
    const messages = [
      { info: { role: 'user' } },
      { info: { role: 'assistant', providerID: 'anthropic', modelID: 'claude-haiku-4' } },
      { info: { role: 'user' } },
      { info: { role: 'assistant', providerID: 'openai', modelID: 'gpt-5' } },
    ];
    expect(getRouterPick(messages)).toEqual({ providerID: 'openai', modelID: 'gpt-5' });
    expect(routerPickLabel({ modelMode: 'auto' }, messages)).toBe('Auto → gpt-5');
    expect(routerPickLabel({ modelMode: 'fixed' }, messages)).toBeUndefined();
    expect(routerPickLabel({ modelMode: 'auto' }, [{ info: { role: 'user' } }])).toBeUndefined();
  });

  test('composer renders the muted pick only when provided', () => {
    const props = {
      attachments: [], commands: [], connectionStatus: 'connected', conversation: { active: false, isListening: false, phase: 'off' },
      draft: '', insetsBottom: 0, isCreatingSession: false, isSpeechInputAvailable: false, isSpeechInputListening: false,
      isStoppingSession: false, palette: Colors.light, running: false, showSendAction: true,
      onAttach: jest.fn(), onCommandSelect: jest.fn(), onDraftChange: jest.fn(), onRemoveAttachment: jest.fn(),
      onSend: jest.fn(), onStop: jest.fn(), onToggleConversationMode: jest.fn(), onToggleDictation: jest.fn(),
    } as unknown as ComponentProps<typeof ChatComposer>;
    const screen = render(<PaperProvider><ChatComposer {...props} routerPick={'Auto → gpt-5'} /></PaperProvider>);
    expect(screen.getByTestId('router-pick-label').props.children).toBe('Auto → gpt-5');
    screen.rerender(<PaperProvider><ChatComposer {...props} /></PaperProvider>);
    expect(screen.queryByTestId('router-pick-label')).toBeNull();
  });
});
