import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export interface Task {
  id: string;
  title: string;
  dueDate: string;
  status: "not_started" | "in_progress" | "complete";
  assignee: { name: string; initials: string };
  source?: "manual" | "gmail" | "planning_center";
  project?: string;
}

const statusColors: Record<Task["status"], string> = {
  not_started: "bg-secondary text-secondary-foreground",
  in_progress: "bg-accent text-accent-foreground",
  complete: "bg-success/10 text-success",
};

const statusLabels: Record<Task["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
};

const sourceLabels: Record<string, string> = {
  gmail: "Gmail",
  planning_center: "PCO",
};

export function TaskItem({ task }: { task: Task }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-secondary/50 transition-colors group">
      <Checkbox
        checked={task.status === "complete"}
        className="h-5 w-5 rounded-md border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${task.status === "complete" ? "line-through text-muted-foreground" : "text-foreground"}`}>
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">{task.dueDate}</span>
          {task.source && task.source !== "manual" && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
              {sourceLabels[task.source]}
            </Badge>
          )}
          {task.project && (
            <span className="text-xs text-primary font-medium truncate">{task.project}</span>
          )}
        </div>
      </div>
      <Badge className={`${statusColors[task.status]} text-[10px] font-medium border-0 shrink-0`}>
        {statusLabels[task.status]}
      </Badge>
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="text-[10px] font-semibold bg-secondary text-secondary-foreground">
          {task.assignee.initials}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}
