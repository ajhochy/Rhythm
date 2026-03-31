import type { Task } from "@/components/TaskItem";

export const mockTasks: Task[] = [
  { id: "1", title: "Finalize Sunday sermon outline", dueDate: "Today", status: "in_progress", assignee: { name: "John Doe", initials: "JD" }, source: "manual" },
  { id: "2", title: "Review volunteer schedules for Easter", dueDate: "Tomorrow", status: "not_started", assignee: { name: "John Doe", initials: "JD" }, source: "planning_center" },
  { id: "3", title: "Reply to building rental inquiry", dueDate: "Mar 29", status: "not_started", assignee: { name: "Sarah Kim", initials: "SK" }, source: "gmail" },
  { id: "4", title: "Order communion supplies", dueDate: "Mar 30", status: "not_started", assignee: { name: "Mike Chen", initials: "MC" }, source: "manual" },
  { id: "5", title: "Update church website events page", dueDate: "Mar 31", status: "in_progress", assignee: { name: "Lisa Park", initials: "LP" }, source: "manual", project: "Website Refresh" },
  { id: "6", title: "Send weekly staff prayer email", dueDate: "Today", status: "complete", assignee: { name: "John Doe", initials: "JD" }, source: "manual" },
  { id: "7", title: "Coordinate sound team for special event", dueDate: "Apr 2", status: "not_started", assignee: { name: "Tom Wilson", initials: "TW" }, source: "planning_center" },
  { id: "8", title: "Prep small group curriculum for spring", dueDate: "Apr 5", status: "not_started", assignee: { name: "Amy Rivera", initials: "AR" }, source: "manual", project: "Spring Groups" },
];

export interface Project {
  id: string;
  title: string;
  owner: { name: string; initials: string };
  progress: number;
  stepsTotal: number;
  stepsComplete: number;
  nextStep: string;
  nextStepAssignee: string;
  dueDate: string;
  status: "active" | "planning" | "complete";
}

export const mockProjects: Project[] = [
  { id: "1", title: "Easter Service Planning", owner: { name: "John Doe", initials: "JD" }, progress: 60, stepsTotal: 10, stepsComplete: 6, nextStep: "Confirm guest musicians", nextStepAssignee: "Tom Wilson", dueDate: "Apr 12", status: "active" },
  { id: "2", title: "Website Refresh", owner: { name: "Lisa Park", initials: "LP" }, progress: 35, stepsTotal: 8, stepsComplete: 3, nextStep: "Finalize homepage mockup", nextStepAssignee: "Lisa Park", dueDate: "Apr 20", status: "active" },
  { id: "3", title: "Spring Small Groups Launch", owner: { name: "Amy Rivera", initials: "AR" }, progress: 15, stepsTotal: 6, stepsComplete: 1, nextStep: "Draft leader guide", nextStepAssignee: "Amy Rivera", dueDate: "Apr 30", status: "planning" },
  { id: "4", title: "VBS 2026 Preparation", owner: { name: "Sarah Kim", initials: "SK" }, progress: 10, stepsTotal: 12, stepsComplete: 1, nextStep: "Choose curriculum theme", nextStepAssignee: "Sarah Kim", dueDate: "Jun 1", status: "planning" },
];

export interface Rhythm {
  id: string;
  title: string;
  frequency: "weekly" | "monthly" | "annual";
  assignee: { name: string; initials: string };
  nextDue: string;
  paused: boolean;
}

export const mockRhythms: Rhythm[] = [
  { id: "1", title: "Staff meeting agenda prep", frequency: "weekly", assignee: { name: "John Doe", initials: "JD" }, nextDue: "Mon", paused: false },
  { id: "2", title: "Facility walkthrough inspection", frequency: "monthly", assignee: { name: "Mike Chen", initials: "MC" }, nextDue: "Apr 1", paused: false },
  { id: "3", title: "Newsletter content deadline", frequency: "monthly", assignee: { name: "Lisa Park", initials: "LP" }, nextDue: "Apr 15", paused: false },
  { id: "4", title: "Budget review with elder board", frequency: "monthly", assignee: { name: "John Doe", initials: "JD" }, nextDue: "Apr 10", paused: false },
  { id: "5", title: "Annual insurance renewal", frequency: "annual", assignee: { name: "Sarah Kim", initials: "SK" }, nextDue: "Jul 1", paused: false },
  { id: "6", title: "Update emergency contact list", frequency: "annual", assignee: { name: "Mike Chen", initials: "MC" }, nextDue: "Sep 1", paused: true },
];

export interface Message {
  id: string;
  sender: { name: string; initials: string };
  preview: string;
  timestamp: string;
  unread: boolean;
  type: "direct" | "project";
  projectName?: string;
}

export const mockMessages: Message[] = [
  { id: "1", sender: { name: "Sarah Kim", initials: "SK" }, preview: "Can we move the staff meeting to Thursday this week?", timestamp: "10:32 AM", unread: true, type: "direct" },
  { id: "2", sender: { name: "Tom Wilson", initials: "TW" }, preview: "Sound system quote came in — see attached.", timestamp: "9:15 AM", unread: true, type: "project", projectName: "Easter Service" },
  { id: "3", sender: { name: "Amy Rivera", initials: "AR" }, preview: "Small group leader training materials are ready for review.", timestamp: "Yesterday", unread: true, type: "project", projectName: "Spring Groups" },
  { id: "4", sender: { name: "Lisa Park", initials: "LP" }, preview: "Homepage design v2 is uploaded to the shared drive.", timestamp: "Yesterday", unread: false, type: "direct" },
  { id: "5", sender: { name: "Mike Chen", initials: "MC" }, preview: "Fellowship hall AC unit needs servicing before summer.", timestamp: "Mar 26", unread: false, type: "direct" },
];

export interface FacilitySpace {
  id: string;
  name: string;
  capacity: number;
  reservations: { title: string; time: string; bookedBy: string }[];
}

export const mockFacilities: FacilitySpace[] = [
  { id: "1", name: "Sanctuary", capacity: 350, reservations: [{ title: "Sunday Worship", time: "Sun 9:00–11:30 AM", bookedBy: "John Doe" }, { title: "Good Friday Rehearsal", time: "Thu 6:00–8:00 PM", bookedBy: "Tom Wilson" }] },
  { id: "2", name: "Fellowship Hall", capacity: 120, reservations: [{ title: "Staff Lunch", time: "Wed 12:00–1:00 PM", bookedBy: "Sarah Kim" }] },
  { id: "3", name: "Youth Room", capacity: 40, reservations: [{ title: "Youth Group", time: "Wed 6:30–8:30 PM", bookedBy: "Amy Rivera" }] },
  { id: "4", name: "Conference Room", capacity: 14, reservations: [{ title: "Elder Board Meeting", time: "Tue 7:00–9:00 PM", bookedBy: "John Doe" }, { title: "Staff Meeting", time: "Mon 9:00–10:00 AM", bookedBy: "John Doe" }] },
  { id: "5", name: "Kitchen", capacity: 8, reservations: [] },
  { id: "6", name: "Nursery", capacity: 20, reservations: [{ title: "Sunday Childcare", time: "Sun 9:00–11:30 AM", bookedBy: "Lisa Park" }] },
];
