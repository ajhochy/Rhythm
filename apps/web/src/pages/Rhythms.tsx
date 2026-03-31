import { Plus, Pause, Play, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { mockRhythms } from "@/data/mockData";
import { motion } from "framer-motion";

const freqColors: Record<string, string> = {
  weekly: "bg-primary/10 text-primary",
  monthly: "bg-info/10 text-info",
  annual: "bg-warning/10 text-warning",
};

export default function Rhythms() {
  const active = mockRhythms.filter((r) => !r.paused);
  const paused = mockRhythms.filter((r) => r.paused);

  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <PageHeader title="Rhythms" description="Recurring tasks that auto-generate on schedule.">
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> New Rhythm
        </Button>
      </PageHeader>

      <div className="space-y-3">
        {active.map((rhythm) => (
          <Card key={rhythm.id} className="shadow-sm border-border/60">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent shrink-0">
                <RefreshCw className="h-5 w-5 text-accent-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{rhythm.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={`${freqColors[rhythm.frequency]} text-[10px] font-medium border-0 capitalize`}>
                    {rhythm.frequency}
                  </Badge>
                  <span className="text-xs text-muted-foreground">Next: {rhythm.nextDue}</span>
                </div>
              </div>
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-[10px] font-semibold bg-secondary text-secondary-foreground">
                  {rhythm.assignee.initials}
                </AvatarFallback>
              </Avatar>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground">
                <Pause className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {paused.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-muted-foreground pt-2">Paused</h2>
          <div className="space-y-3">
            {paused.map((rhythm) => (
              <Card key={rhythm.id} className="shadow-sm border-border/60 opacity-60">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary shrink-0">
                    <RefreshCw className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{rhythm.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className={`${freqColors[rhythm.frequency]} text-[10px] font-medium border-0 capitalize`}>
                        {rhythm.frequency}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-normal">Paused</Badge>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground">
                    <Play className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}
