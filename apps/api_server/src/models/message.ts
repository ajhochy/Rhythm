export interface MessageThreadParticipant {
  id: number;
  name: string;
  email: string;
}

export interface MessageThread {
  id: number;
  title: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string | null;
  unreadCount: number;
  isUnread: boolean;
  participants: MessageThreadParticipant[];
}

export interface Message {
  id: number;
  threadId: number;
  senderId: number | null;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface CreateThreadDto {
  createdBy: number;
  participantIds: number[];
}

export interface CreateMessageDto {
  body: string;
}
