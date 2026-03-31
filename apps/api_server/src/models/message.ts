export interface MessageThread {
  id: number;
  title: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string | null;
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
  title: string;
  created_by?: number | null;
}

export interface CreateMessageDto {
  sender_name: string;
  body: string;
  sender_id?: number | null;
}
