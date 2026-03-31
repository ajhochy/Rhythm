import { Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { mockProjects } from "@/data/mockData";
import { motion } from "framer-motion";

const statusColors: Record<string, string> = {
  active: "bg-success/10 text-success",
  planning: "bg-info/10 text-info",
  complete: "bg-secondary text-secondary-foreground",
};

export default function Projects() {
  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <PageHeader title="Projects" description="Track collaborative work across the team.">
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> New Project
        </Button>
      </PageHeader>

      <div className="space-y-4">
        {mockProjects.map((project) => (
          <Card key={project.id} className="shadow-sm border-border/60 hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                      {project.owner.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground truncate">{project.title}</h3>
                    <p className="text-xs text-muted-foreground">Owned by {project.owner.name} · Due {project.dueDate}</p>
                  </div>
                </div>
                <Badge className={`${statusColors[project.status]} text-[10px] font-medium border-0 shrink-0 capitalize`}>
                  {project.status}
                </Badge>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{project.stepsComplete} of {project.stepsTotal} steps</span>
                  <span className="font-medium text-foreground">{project.progress}%</span>
                </div>
                <Progress value={project.progress} className="h-2" />
              </div>

              <div className="mt-3 px-3 py-2 rounded-lg bg-accent/50 border border-accent">
                <p className="text-xs text-muted-foreground">
                  Next step: <span className="font-medium text-foreground">{project.nextStep}</span>
                  <span className="text-muted-foreground"> — {project.nextStepAssignee}</span>
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </motion.div>
  );
}
