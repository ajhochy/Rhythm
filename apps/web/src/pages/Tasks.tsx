import { Plus, Filter, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { TaskItem } from "@/components/TaskItem";
import type { Task } from "@/components/TaskItem";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { useTasks } from "@/hooks/useApi";

function mapApiTask(t: any): Task {
  return {
    id: String(t.id),
    title: t.title ?? "",
    dueDate: t.dueDate ?? t.scheduledDate ?? "",
    status:
      t.status === "done"
        ? "complete"
        : t.status === "in_progress"
        ? "in_progress"
        : "not_started",
    assignee: { name: "Me", initials: "ME" },
    source:
      t.sourceType === "gmail"
        ? "gmail"
        : t.sourceType === "planning_center"
        ? "planning_center"
        : "manual",
  };
}

export default function Tasks() {
  const { data: rawTasks, isLoading, isError, error } = useTasks();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm font-medium">
            Failed to load tasks: {(error as Error)?.message ?? "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  const allTasks: Task[] = (rawTasks ?? []).map(mapApiTask);
  const myTasks = allTasks;
  const activeTasks = allTasks.filter((t) => t.status !== "complete");
  const completeTasks = allTasks.filter((t) => t.status === "complete");

  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <PageHeader title="Tasks" description="Manage your personal and team tasks.">
        <Button variant="outline" size="sm">
          <Filter className="h-4 w-4 mr-1.5" /> Filter
        </Button>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> New Task
        </Button>
      </PageHeader>

      <Tabs defaultValue="mine">
        <TabsList className="bg-secondary/60">
          <TabsTrigger value="mine">My Tasks ({myTasks.length})</TabsTrigger>
          <TabsTrigger value="all">All ({activeTasks.length})</TabsTrigger>
          <TabsTrigger value="complete">Complete ({completeTasks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          <Card className="shadow-sm border-border/60">
            <CardContent className="p-2">
              <div className="divide-y divide-border/50">
                {myTasks.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
                {myTasks.length === 0 && (
                  <p className="text-sm text-muted-foreground p-4 text-center">No tasks found.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <Card className="shadow-sm border-border/60">
            <CardContent className="p-2">
              <div className="divide-y divide-border/50">
                {activeTasks.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
                {activeTasks.length === 0 && (
                  <p className="text-sm text-muted-foreground p-4 text-center">No active tasks.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="complete" className="mt-4">
          <Card className="shadow-sm border-border/60">
            <CardContent className="p-2">
              <div className="divide-y divide-border/50">
                {completeTasks.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
                {completeTasks.length === 0 && (
                  <p className="text-sm text-muted-foreground p-4 text-center">No completed tasks.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
