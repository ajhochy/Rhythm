import * as Icons from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';

export type IconName = keyof typeof iconSet;

const iconSet = {
  activity: Icons.Activity,
  agents: Icons.Bot,
  archive: Icons.Archive,
  artifact: Icons.LayoutDashboard,
  attach: Icons.Paperclip,
  background: Icons.RadioTower,
  bell: Icons.Bell,
  book: Icons.BookOpen,
  brain: Icons.Brain,
  branch: Icons.GitBranch,
  cancel: Icons.Square,
  check: Icons.Check,
  chevronDown: Icons.ChevronDown,
  chevronRight: Icons.ChevronRight,
  close: Icons.X,
  collapse: Icons.PanelLeftClose,
  command: Icons.TerminalSquare,
  copy: Icons.Copy,
  delete: Icons.Trash2,
  diff: Icons.GitCompareArrows,
  endpoint: Icons.Network,
  expand: Icons.PanelLeftOpen,
  file: Icons.FileCode2,
  filter: Icons.ListFilter,
  fork: Icons.GitFork,
  history: Icons.History,
  gallery: Icons.Images,
  mail: Icons.Mail,
  menu: Icons.Menu,
  moon: Icons.Moon,
  more: Icons.Ellipsis,
  plus: Icons.Plus,
  profile: Icons.UserRoundCog,
  playbook: Icons.NotebookTabs,
  refresh: Icons.RefreshCw,
  rename: Icons.Pencil,
  report: Icons.ClipboardCheck,
  review: Icons.Inbox,
  resume: Icons.Play,
  search: Icons.Search,
  send: Icons.ArrowUp,
  settings: Icons.Settings2,
  sliders: Icons.SlidersHorizontal,
  spark: Icons.Sparkles,
  sun: Icons.Sun,
  terminal: Icons.SquareTerminal,
  todo: Icons.ListChecks,
  tools: Icons.Wrench,
  undo: Icons.Undo2,
  worktree: Icons.FolderGit2,
  webhook: Icons.Webhook,
} satisfies Record<string, LucideIcon>;

export function Icon({ name, size = 17, ...props }: { name: IconName } & LucideProps) {
  const Component = iconSet[name];
  return <Component aria-hidden="true" size={size} strokeWidth={1.8} {...props} />;
}
