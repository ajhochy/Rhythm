import { PenSquare, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { mockMessages } from "@/data/mockData";
import { motion } from "framer-motion";

export default function Messages() {
  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <PageHeader title="Messages" description="Direct messages and project threads.">
        <Button size="sm">
          <PenSquare className="h-4 w-4 mr-1.5" /> New Message
        </Button>
      </PageHeader>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search messages..." className="pl-9 bg-card" />
      </div>

      <Card className="shadow-sm border-border/60">
        <CardContent className="p-2">
          <div className="divide-y divide-border/50">
            {mockMessages.map((msg) => (
              <div
                key={msg.id}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer"
              >
                <div className="relative shrink-0">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                      {msg.sender.initials}
                    </AvatarFallback>
                  </Avatar>
                  {msg.unread && (
                    <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary border-2 border-card" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm truncate ${msg.unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>
                      {msg.sender.name}
                    </p>
                    {msg.projectName && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal shrink-0">
                        {msg.projectName}
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap shrink-0">
                      {msg.timestamp}
                    </span>
                  </div>
                  <p className={`text-xs mt-0.5 truncate ${msg.unread ? "text-foreground" : "text-muted-foreground"}`}>
                    {msg.preview}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
