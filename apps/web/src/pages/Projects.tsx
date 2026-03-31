import { Plus, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useProjectInstances } from "@/hooks/useApi";
import { motion } from "framer-motion";

const statusColors: Record<string, string> = {
  active: "bg-success/10 text-success",
  planning: "bg-info/10 text-info",
  complete: "bg-secondary text-secondary-foreground",
};

interface ApiStep {
  id: number;
  title: string;
  dueDate: string;
  status: "open" | "done";
}

interface ApiProject {
  id: number;
  name: string;
  status: "active" | "complete";
  anchorDate: string;
  templateId: number;
  steps: ApiStep[];
}

export default function Projects() {
  const { data: projects, isLoading, isError } = useProjectInstances();

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

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">Failed to load projects. Please try again.</p>
      )}

      {!isLoading && !isError && (
        <div className="space-y-4">
          {(projects as ApiProject[])?.map((project) => {
            const steps: ApiStep[] = project.steps ?? [];
            const stepsTotal = steps.length;
            const stepsComplete = steps.filter((s) => s.status === "done").length;
            const progress = stepsTotal > 0 ? Math.round((stepsComplete / stepsTotal) * 100) : 0;
            const nextStep = steps.find((s) => s.status === "open");

            return (
              <Card key={project.id} className="shadow-sm border-border/60 hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-foreground truncate">{project.name}</h3>
                      {project.anchorDate && (
                        <p className="text-xs text-muted-foreground">
                          Due {new Date(project.anchorDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                      )}
                    </div>
                    <Badge className={`${statusColors[project.status] ?? "bg-secondary text-secondary-foreground"} text-[10px] font-medium border-0 shrink-0 capitalize`}>
                      {project.status}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{stepsComplete} of {stepsTotal} steps</span>
                      <span className="font-medium text-foreground">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  {nextStep && (
                    <div className="mt-3 px-3 py-2 rounded-lg bg-accent/50 border border-accent">
                      <p className="text-xs text-muted-foreground">
                        Next step: <span className="font-medium text-foreground">{nextStep.title}</span>
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {!projects?.length && (
            <p className="text-sm text-muted-foreground text-center py-8">No projects yet.</p>
          )}
        </div>
      )}
    </motion.div>
  );
}
