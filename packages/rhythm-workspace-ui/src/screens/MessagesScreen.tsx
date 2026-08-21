import { useEffect, useState } from 'react';
import { useRhythmDomainGateway } from '../context';
import { ScreenRoot } from './ScreenRoot';
import type { RhythmMessageThread } from '../domain/types';

export function MessagesScreen() {
  const { messages } = useRhythmDomainGateway();
  const [items, setItems] = useState<RhythmMessageThread[]>([]);

  useEffect(() => {
    let cancelled = false;
    void messages.list().then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [messages]);

  return (
    <ScreenRoot screenName="Messages" testId="rhythm-messages-screen">
      <h1>Messages</h1>
      <ul data-testid="rhythm-threads-list">
        {items.map((thread) => (
          <li key={thread.id} data-testid={`rhythm-thread-row-${thread.id}`}>
            <span>{thread.subject}</span>
            <span> · {thread.lastSenderName}</span>
            {thread.unreadCount > 0 && <span aria-label={`${thread.unreadCount} unread`}> · {thread.unreadCount}</span>}
          </li>
        ))}
      </ul>
    </ScreenRoot>
  );
}
