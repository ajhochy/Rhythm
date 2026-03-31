import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  RefreshCw,
  MessageCircle,
  Building2,
  Leaf,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Tasks", url: "/tasks", icon: CheckSquare },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Rhythms", url: "/rhythms", icon: RefreshCw },
  { title: "Messages", url: "/messages", icon: MessageCircle, badge: 3 },
  { title: "Facilities", url: "/facilities", icon: Building2 },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const isMobile = useIsMobile();

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary/20 shrink-0">
            <Leaf className="h-5 w-5 text-sidebar-primary" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-base font-bold text-sidebar-accent-foreground tracking-tight">
                Grafting
              </h1>
              <p className="text-[11px] text-sidebar-muted-foreground leading-none mt-0.5">
                Visalia CRC
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      onClick={handleNavClick}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" />
                      {!collapsed && (
                        <span className="flex-1 text-sm">{item.title}</span>
                      )}
                      {!collapsed && item.badge && (
                        <Badge
                          variant="default"
                          className="h-5 min-w-5 px-1.5 text-[10px] font-semibold bg-sidebar-primary text-sidebar-primary-foreground border-0"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-sidebar-primary/20 text-sidebar-primary text-xs font-semibold">
              JD
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium text-sidebar-accent-foreground truncate">
                John Doe
              </p>
              <p className="text-[11px] text-sidebar-muted-foreground truncate">
                Lead Pastor
              </p>
            </div>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
