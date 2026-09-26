// Ported from apps/web/src/icons.tsx — the shared Lucide icon-name vocabulary used across
// every non-agent screen (search, filters, menus, dialogs, quick actions). Only the subset
// actually referenced by the ten workspace screens is kept; the source app's agent-surface
// icon names (agents, terminal, worktree, etc.) are intentionally not carried over.
import * as Icons from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';

export type IconName = keyof typeof iconSet;

const iconSet = {
  activity: Icons.Activity,
  archive: Icons.Archive,
  attach: Icons.Paperclip,
  bell: Icons.Bell,
  book: Icons.BookOpen,
  calendar: Icons.Calendar,
  check: Icons.Check,
  chevronDown: Icons.ChevronDown,
  chevronRight: Icons.ChevronRight,
  close: Icons.X,
  copy: Icons.Copy,
  delete: Icons.Trash2,
  download: Icons.Download,
  filter: Icons.ListFilter,
  history: Icons.History,
  link: Icons.Link,
  mail: Icons.Mail,
  menu: Icons.Menu,
  more: Icons.Ellipsis,
  plus: Icons.Plus,
  refresh: Icons.RefreshCw,
  rename: Icons.Pencil,
  search: Icons.Search,
  settings: Icons.Settings2,
  sliders: Icons.SlidersHorizontal,
  sparkles: Icons.Sparkles,
  upload: Icons.Upload,
  users: Icons.Users,
  warning: Icons.TriangleAlert,
} satisfies Record<string, LucideIcon>;

export function Icon({ name, size = 17, ...props }: { name: IconName } & LucideProps) {
  const Component = iconSet[name];
  return <Component aria-hidden="true" size={size} strokeWidth={1.8} {...props} />;
}
