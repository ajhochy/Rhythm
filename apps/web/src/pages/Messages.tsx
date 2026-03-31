import { useState } from "react";
import { PenSquare, Search, Send, Loader2, AlertCircle, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import {
  useMessageThreads,
  useCreateMessageThread,
  useThreadMessages,
  useSendMessage,
} from "@/hooks/useApi";

function formatTimestamp(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function isRecent(dateStr: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  return diffMs < 1000 * 60 * 60 * 24; // within 24 hours
}

interface ThreadPanelProps {
  thread: { id: number; title: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ThreadPanel({ thread, open, onOpenChange }: ThreadPanelProps) {
  const [replyBody, setReplyBody] = useState("");
  const [senderName, setSenderName] = useState("Me");

  const { data: messages, isLoading: messagesLoading } = useThreadMessages(
    thread?.id ?? null
  );
  const sendMessage = useSendMessage();

  function handleSend() {
    if (!thread || !replyBody.trim()) return;
    sendMessage.mutate(
      { threadId: thread.id, senderName, body: replyBody.trim() },
      {
        onSuccess: () => {
          setReplyBody("");
        },
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b border-border/60 shrink-0">
          <SheetTitle className="text-base">{thread?.title ?? ""}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
          {messagesLoading && (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!messagesLoading && messages && messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No messages yet. Start the conversation below.
            </p>
          )}
          {!messagesLoading &&
            messages &&
            messages.map((msg: { id: number; senderName: string; body: string; createdAt: string }) => (
              <div key={msg.id} className="flex gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                    {getInitials(msg.senderName ?? "?")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{msg.senderName}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatTimestamp(msg.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/90 mt-0.5 whitespace-pre-wrap break-words">
                    {msg.body}
                  </p>
                </div>
              </div>
            ))}
        </div>

        <div className="shrink-0 border-t border-border/60 px-6 py-4 space-y-2">
          <div className="flex gap-2 items-center">
            <Label htmlFor="sender-name" className="text-xs text-muted-foreground whitespace-nowrap">
              From:
            </Label>
            <Input
              id="sender-name"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="h-7 text-xs bg-secondary/50"
            />
          </div>
          <div className="flex gap-2 items-end">
            <Textarea
              placeholder="Write a reply… (Cmd+Enter to send)"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              onKeyDown={handleKeyDown}
              className="resize-none text-sm min-h-[72px]"
            />
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!replyBody.trim() || sendMessage.isPending}
              className="shrink-0 self-end"
            >
              {sendMessage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface NewThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function NewThreadDialog({ open, onOpenChange }: NewThreadDialogProps) {
  const [title, setTitle] = useState("");
  const createThread = useCreateMessageThread();

  function handleCreate() {
    if (!title.trim()) return;
    createThread.mutate(
      { title: title.trim() },
      {
        onSuccess: () => {
          setTitle("");
          onOpenChange(false);
        },
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Message Thread</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="thread-title">Thread title</Label>
            <Input
              id="thread-title"
              placeholder="e.g. Easter planning, Staff update…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!title.trim() || createThread.isPending}
          >
            {createThread.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : null}
            Create Thread
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Messages() {
  const { data: threads, isLoading, isError, error } = useMessageThreads();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedThread, setSelectedThread] = useState<{ id: number; title: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [newThreadDialogOpen, setNewThreadDialogOpen] = useState(false);

  function handleThreadClick(thread: { id: number; title: string }) {
    setSelectedThread(thread);
    setSheetOpen(true);
  }

  const filteredThreads = (threads ?? []).filter((t: { title: string }) =>
    t.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <PageHeader title="Messages" description="Direct messages and project threads.">
        <Button size="sm" onClick={() => setNewThreadDialogOpen(true)}>
          <PenSquare className="h-4 w-4 mr-1.5" /> New Message
        </Button>
      </PageHeader>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search threads..."
          className="pl-9 bg-card"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-destructive p-4">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            Failed to load messages: {(error as Error)?.message ?? "Unknown error"}
          </p>
        </div>
      )}

      {!isLoading && !isError && (
        <Card className="shadow-sm border-border/60">
          <CardContent className="p-2">
            {filteredThreads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                <MessageSquare className="h-8 w-8" />
                <p className="text-sm">
                  {searchQuery ? "No threads match your search." : "No message threads yet."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {filteredThreads.map(
                  (thread: {
                    id: number;
                    title: string;
                    updatedAt: string;
                    lastMessage?: { senderName: string; body: string; createdAt: string };
                  }) => {
                    const unread = thread.lastMessage
                      ? isRecent(thread.lastMessage.createdAt)
                      : false;
                    const senderInitials = thread.lastMessage?.senderName
                      ? getInitials(thread.lastMessage.senderName)
                      : "?";

                    return (
                      <div
                        key={thread.id}
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer"
                        onClick={() => handleThreadClick({ id: thread.id, title: thread.title })}
                      >
                        <div className="relative shrink-0">
                          <Avatar className="h-10 w-10">
                            <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                              {senderInitials}
                            </AvatarFallback>
                          </Avatar>
                          {unread && (
                            <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary border-2 border-card" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p
                              className={`text-sm truncate ${
                                unread
                                  ? "font-semibold text-foreground"
                                  : "font-medium text-muted-foreground"
                              }`}
                            >
                              {thread.lastMessage?.senderName ?? thread.title}
                            </p>
                            <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap shrink-0">
                              {formatTimestamp(thread.updatedAt)}
                            </span>
                          </div>
                          <p
                            className={`text-xs mt-0.5 truncate ${
                              unread ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {thread.lastMessage?.body ?? thread.title}
                          </p>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ThreadPanel
        thread={selectedThread}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

      <NewThreadDialog
        open={newThreadDialogOpen}
        onOpenChange={setNewThreadDialogOpen}
      />
    </motion.div>
  );
}
