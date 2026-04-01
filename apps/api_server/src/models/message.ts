export interface MessageThread {
  id: number;
  title: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string | null;
  unreadCount: number;
  isUnread: boolean;
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
  title?: string | null;
  createdBy: number;
  participantIds: number[];
}

export interface CreateMessageDto {
  body: string;
}
