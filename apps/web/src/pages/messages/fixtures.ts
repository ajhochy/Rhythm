export type MessageThreadType = 'direct' | 'group';

export interface MessageParticipant {
  id: string;
  name: string;
  email: string;
  initials: string;
}

export interface MessageFixture {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface MessageThreadFixture {
  id: string;
  title: string;
  type: MessageThreadType;
  participants: MessageParticipant[];
  messages: MessageFixture[];
  lastMessage: string;
  updatedAt: string;
  unreadCount: number;
}

export const currentMessageUser: MessageParticipant = {
  id: 'user-aj-hochhalter',
  name: 'AJ Hochhalter',
  email: 'aj@rhythm.local',
  initials: 'AJ',
};

export const messageRecipients: MessageParticipant[] = [
  { id: 'morgan-lee', name: 'Morgan Lee', email: 'morgan.lee@example.test', initials: 'ML' },
  { id: 'visalia-crc', name: 'Visalia CRC', email: 'office@visalia-crc.example.test', initials: 'VC' },
  { id: 'riley-chen', name: 'Riley Chen', email: 'riley.chen@example.test', initials: 'RC' },
  { id: 'ana-torres', name: 'Ana Torres', email: 'ana.torres@example.test', initials: 'AT' },
];

const [morgan, visalia, riley, ana] = messageRecipients;

export const seededMessageThreads: MessageThreadFixture[] = [
  {
    id: 'thread-weekend-team',
    title: 'Weekend Team',
    type: 'group',
    participants: [morgan, visalia, currentMessageUser],
    updatedAt: '2026-08-12T15:42:00-07:00',
    unreadCount: 1,
    lastMessage: 'Final volunteer positions are ready.',
    messages: [
      { id: 'message-weekend-1', senderId: morgan.id, senderName: morgan.name, body: 'Final volunteer positions are ready.', createdAt: '2026-08-12T15:36:00-07:00' },
      { id: 'message-weekend-2', senderId: visalia.id, senderName: visalia.name, body: '礼拝チーム引き継ぎ 🎵', createdAt: '2026-08-12T15:42:00-07:00' },
    ],
  },
  {
    id: 'thread-facilities-handoff',
    title: 'Facilities handoff and access planning for the late summer gathering',
    type: 'group',
    participants: [riley, visalia, currentMessageUser],
    updatedAt: '2026-08-12T14:58:00-07:00',
    unreadCount: 1,
    lastMessage: 'Facilities access code is in the private runbook.',
    messages: [{ id: 'message-facilities-1', senderId: riley.id, senderName: riley.name, body: 'Facilities access code is in the private runbook.', createdAt: '2026-08-12T14:58:00-07:00' }],
  },
  {
    id: 'thread-care-coordinators', title: 'Care coordinators', type: 'group', participants: [ana, morgan, currentMessageUser],
    updatedAt: '2026-08-12T13:30:00-07:00', unreadCount: 1, lastMessage: 'I can take the first follow-up.',
    messages: [{ id: 'message-care-1', senderId: ana.id, senderName: ana.name, body: 'I can take the first follow-up.', createdAt: '2026-08-12T13:30:00-07:00' }],
  },
  {
    id: 'thread-riley-chen', title: 'Riley Chen', type: 'direct', participants: [riley, currentMessageUser],
    updatedAt: '2026-08-12T12:12:00-07:00', unreadCount: 1, lastMessage: 'The room diagram is updated.',
    messages: [{ id: 'message-riley-1', senderId: riley.id, senderName: riley.name, body: 'The room diagram is updated.', createdAt: '2026-08-12T12:12:00-07:00' }],
  },
  {
    id: 'thread-morgan-lee', title: 'Morgan Lee', type: 'direct', participants: [morgan, currentMessageUser],
    updatedAt: '2026-08-12T11:44:00-07:00', unreadCount: 1, lastMessage: 'Sunday notes look good.',
    messages: [{ id: 'message-morgan-1', senderId: morgan.id, senderName: morgan.name, body: 'Sunday notes look good.', createdAt: '2026-08-12T11:44:00-07:00' }],
  },
  {
    id: 'thread-multilingual-worship', title: '礼拝 planning · equipo de adoración 🎵', type: 'group', participants: [ana, visalia, currentMessageUser],
    updatedAt: '2026-08-12T10:17:00-07:00', unreadCount: 1, lastMessage: 'La lista está lista para revisar.',
    messages: [{ id: 'message-multilingual-1', senderId: ana.id, senderName: ana.name, body: 'La lista está lista para revisar.', createdAt: '2026-08-12T10:17:00-07:00' }],
  },
  {
    id: 'thread-budget-review', title: 'August budget review', type: 'group', participants: [morgan, riley, currentMessageUser],
    updatedAt: '2026-08-11T16:20:00-07:00', unreadCount: 0, lastMessage: 'Approved for the next meeting.',
    messages: [{ id: 'message-budget-1', senderId: currentMessageUser.id, senderName: currentMessageUser.name, body: 'Approved for the next meeting.', createdAt: '2026-08-11T16:20:00-07:00' }],
  },
  {
    id: 'thread-ana-torres', title: 'Ana Torres', type: 'direct', participants: [ana, currentMessageUser],
    updatedAt: '2026-08-11T09:05:00-07:00', unreadCount: 0, lastMessage: 'Thank you - I have everything I need.',
    messages: [{ id: 'message-ana-1', senderId: ana.id, senderName: ana.name, body: 'Thank you - I have everything I need.', createdAt: '2026-08-11T09:05:00-07:00' }],
  },
];

export const cloneSeededMessageThreads = () => structuredClone(seededMessageThreads) as MessageThreadFixture[];
export const initialMessageReceipts = ['GET /message-threads → 200'];
