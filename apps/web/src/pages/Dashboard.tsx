import { CheckSquare, FolderKanban, MessageCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { TaskItem } from "@/components/TaskItem";
import { mockTasks, mockProjects, mockMessages } from "@/data/mockData";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export default function Dashboard() {
  const myTasks = mockTasks.filter((t) => t.assignee.initials === "JD" && t.status !== "complete");
  const activeProjects = mockProjects.filter((p) => p.status === "active");
  const unreadMessages = mockMessages.filter((m) => m.unread);

  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={item}>
        <PageHeader title="Good morning, John" description="Here's what needs your attention today." />
      </motion.div>

      {/* Stats */}
      <motion.div variants={item} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={CheckSquare} title="My Tasks" value={myTasks.length} subtitle="Due this week" />
        <StatCard icon={FolderKanban} title="Active Projects" value={activeProjects.length} subtitle={`${mockProjects.length} total`} />
        <StatCard icon={MessageCircle} title="Unread" value={unreadMessages.length} subtitle="Messages" />
        <StatCard icon={Clock} title="Rhythms" value={3} subtitle="Due this week" />
      </motion.div>

      <div className="grid lg:grid-cols-5 gap-4 sm:gap-6">
        {/* My Tasks */}
        <motion.div variants={item} className="lg:col-span-3">
          <Card className="shadow-sm border-border/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">My Tasks</CardTitle>
                <Button variant="ghost" size="sm" className="text-primary text-xs" asChild>
                  <Link to="/tasks">View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="divide-y divide-border/50">
                {myTasks.slice(0, 4).map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Projects + Messages */}
        <motion.div variants={item} className="lg:col-span-2 space-y-4 sm:space-y-6">
          <Card className="shadow-sm border-border/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Projects</CardTitle>
                <Button variant="ghost" size="sm" className="text-primary text-xs" asChild>
                  <Link to="/projects">View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              {activeProjects.map((project) => (
                <div key={project.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{project.title}</p>
                    <span className="text-xs text-muted-foreground">{project.progress}%</span>
                  </div>
                  <Progress value={project.progress} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">
                    Next: <span className="text-foreground font-medium">{project.nextStep}</span>
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Messages</CardTitle>
                <Button variant="ghost" size="sm" className="text-primary text-xs" asChild>
                  <Link to="/messages">View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {unreadMessages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer">
                  <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                    <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">
                      {msg.sender.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{msg.sender.name}</p>
                      {msg.projectName && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal shrink-0">
                          {msg.projectName}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.preview}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{msg.timestamp}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
