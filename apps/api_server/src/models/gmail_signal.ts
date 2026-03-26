export interface GmailSignal {
  id: string;
  externalId: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string | null;
  isUnread: boolean;
  createdAt: string;
  updatedAt: string;
}
