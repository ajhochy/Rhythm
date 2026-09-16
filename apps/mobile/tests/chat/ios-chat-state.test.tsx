import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useEffect, useRef, useState } from 'react';
import { Button, Text, TextInput } from 'react-native';

import { createSessionDraftStore } from '@/components/chat/chat-drafts';
import { createSessionFetchTracker } from '@/lib/opencode/messages';

type Deferred = { promise: Promise<string>; resolve: (value: string) => void };

function deferred(): Deferred {
  let resolve!: (value: string) => void;
  return { promise: new Promise((done) => { resolve = done; }), resolve };
}

function HistoryHarness({ load, sessionId }: {
  load: (sessionId: string) => Promise<string>;
  sessionId: string;
}) {
  const tracker = useRef(createSessionFetchTracker());
  const activeSession = useRef(sessionId);
  const [history, setHistory] = useState('');
  activeSession.current = sessionId;
  useEffect(() => {
    const token = tracker.current.start(sessionId);
    void load(sessionId).then((next) => {
      if (
        activeSession.current === sessionId &&
        tracker.current.isLatest(sessionId, token)
      ) {
        setHistory(next);
      }
    });
  }, [load, sessionId]);
  return <Text testID="visible-history">{`${sessionId}:${history}`}</Text>;
}

function DraftHarness() {
  const store = useRef(createSessionDraftStore());
  const attempt = useRef<ReturnType<typeof store.current.beginSend> | undefined>(undefined);
  const [sessionId, setSessionId] = useState('A');
  const [, rerender] = useState(0);
  const draft = store.current.get(sessionId).draft;
  return <>
    <Button title="A" onPress={() => setSessionId('A')} />
    <Button title="B" onPress={() => setSessionId('B')} />
    <TextInput
      accessibilityLabel="Draft"
      value={draft}
      onChangeText={(value) => {
        store.current.updateDraft(sessionId, value);
        rerender((value) => value + 1);
      }}
    />
    <Button title="Send" onPress={() => {
      attempt.current = store.current.beginSend(sessionId);
      rerender((value) => value + 1);
    }} />
    <Button title="Fail send" onPress={() => {
      if (attempt.current) store.current.restoreFailedSend(attempt.current);
      rerender((value) => value + 1);
    }} />
  </>;
}

test('ios-chat-integration-c9: stale equal-length A→B→A history cannot replace the latest A response', async () => {
  const firstA = deferred();
  const b = deferred();
  const latestA = deferred();
  const queues = { A: [firstA, latestA], B: [b] };
  const load = jest.fn((sessionId: string) => queues[sessionId as 'A' | 'B'].shift()!.promise);
  const screen = render(<HistoryHarness load={load} sessionId="A" />);
  screen.rerender(<HistoryHarness load={load} sessionId="B" />);
  screen.rerender(<HistoryHarness load={load} sessionId="A" />);

  await act(async () => latestA.resolve('new'));
  await waitFor(() => expect(screen.getByTestId('visible-history').props.children).toBe('A:new'));
  await act(async () => firstA.resolve('old'));
  expect(screen.getByTestId('visible-history').props.children).toBe('A:new');
});

test('ios-chat-integration-c3: drafts are session-keyed and failed send preserves newer typing', () => {
  const screen = render(<DraftHarness />);
  fireEvent.changeText(screen.getByLabelText('Draft'), 'original A');
  fireEvent.press(screen.getByText('Send'));
  fireEvent.changeText(screen.getByLabelText('Draft'), 'new typing');
  fireEvent.press(screen.getByText('B'));
  fireEvent.changeText(screen.getByLabelText('Draft'), 'draft B');
  fireEvent.press(screen.getByText('A'));
  fireEvent.press(screen.getByText('Fail send'));
  expect(screen.getByLabelText('Draft').props.value).toBe('original A\nnew typing');
  fireEvent.press(screen.getByText('B'));
  expect(screen.getByLabelText('Draft').props.value).toBe('draft B');
});
