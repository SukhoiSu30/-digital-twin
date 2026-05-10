import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  CalendarDays,
  ListChecks,
  Settings,
  Bot,
  Moon,
  Sun,
} from "lucide-react";

interface SidebarProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/meetings", label: "Meetings", icon: CalendarDays },
  { path: "/actions", label: "Action Items", icon: ListChecks },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ darkMode, onToggleDarkMode }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="w-64 border-r bg-card h-screen flex flex-col fixed left-0 top-0">
      {/* Logo / Brand */}
      <div className="p-6 border-b">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Digital Twin</h1>
            <p className="text-xs text-muted-foreground">AI Meeting Agent</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <Button
            key={item.path}
            variant={isActive(item.path) ? "secondary" : "ghost"}
            className={`w-full justify-start gap-3 ${
              isActive(item.path) ? "font-semibold" : "font-normal"
            }`}
            onClick={() => navigate(item.path)}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Button>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="p-4 border-t space-y-3">
        {/* Active bots indicator */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-muted-foreground">System Online</span>
        </div>

        {/* Dark mode toggle */}
        <Button
          variant="ghost"
          className="w-full justify-start gap-3"
          onClick={onToggleDarkMode}
        >
          {darkMode ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          {darkMode ? "Light Mode" : "Dark Mode"}
        </Button>
      </div>
    </aside>
  );
}
