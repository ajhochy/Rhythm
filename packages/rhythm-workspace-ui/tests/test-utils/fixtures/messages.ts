import type { MessagesGateway, RhythmMessageThread, RhythmWorkspaceMember } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

export const fixtureMessagesMembers: RhythmWorkspaceMember[] = [
  { id: 'user-aj-hochhalter', name: 'AJ Hochhalter', initials: 'AH' },
  { id: 'morgan-lee', name: 'Morgan Lee', initials: 'ML' },
  { id: 'riley-chen', name: 'Riley Chen', initials: 'RC' },
];

function seedThreads(): RhythmMessageThread[] {
  const [aj, morgan, riley] = fixtureMessagesMembers as [RhythmWorkspaceMember, RhythmWorkspaceMember, RhythmWorkspaceMember];
  return [
    {
      id: 'thread-weekend-team', title: 'Weekend Team', type: 'group', participants: [morgan, riley, aj], updatedAt: '2026-08-12T15:42:00-07:00', unreadCount: 1,
      lastMessage: 'Final volunteer positions are ready.',
      messages: [{ id: 'message-weekend-1', senderId: morgan.id, senderName: morgan.name, body: 'Final volunteer positions are ready.', createdAt: '2026-08-12T15:36:00-07:00' }],
    },
    {
      id: 'thread-riley-chen', title: 'Riley Chen', type: 'direct', participants: [riley, aj], updatedAt: '2026-08-12T12:12:00-07:00', unreadCount: 0,
      lastMessage: 'The room diagram is updated.',
      messages: [{ id: 'message-riley-1', senderId: riley.id, senderName: riley.name, body: 'The room diagram is updated.', createdAt: '2026-08-12T12:12:00-07:00' }],
    },
  ];
}

export function fixtureMessagesGateway(): MessagesGateway {
  let threads = seedThreads();
  const members = fixtureMessagesMembers;
  return {
    list: async () => threads,
    members: async () => members,
    createThread: async (input) => {
      const participants = members.filter((member) => input.participantIds.includes(member.id));
      const created: RhythmMessageThread = { id: `thread-${threads.length + 1}`, title: input.title ?? participants.map((p) => p.name).join(', '), type: input.type, participants, messages: [], lastMessage: '', updatedAt: '2026-08-12T15:48:00-07:00', unreadCount: 0 };
      threads = [...threads, created];
      return created;
    },
    send: async (threadId, body) => {
      const thread = threads.find((item) => item.id === threadId);
      if (!thread) throw new RhythmGatewayError('not_found', `unknown thread ${threadId}`);
      const message = { id: `message-${thread.messages.length + 1}`, senderId: 'user-aj-hochhalter', senderName: 'AJ Hochhalter', body, createdAt: '2026-08-12T15:48:00-07:00' };
      threads = threads.map((item) => (item.id === threadId ? { ...item, messages: [...item.messages, message], lastMessage: body } : item));
      return message;
    },
    markRead: async (threadId) => {
      threads = threads.map((item) => (item.id === threadId ? { ...item, unreadCount: 0 } : item));
    },
    markUnread: async (threadId) => {
      threads = threads.map((item) => (item.id === threadId ? { ...item, unreadCount: Math.max(1, item.unreadCount) } : item));
    },
  };
}

export function failingMessagesGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): MessagesGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { list: fail, members: fail, createThread: fail, send: fail, markRead: fail, markUnread: fail };
}

export function emptyMessagesGateway(): MessagesGateway {
  const gateway = fixtureMessagesGateway();
  return { ...gateway, list: async () => [] };
}
