import { Sidebar } from "./Sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function AppLayout({ children, darkMode, onToggleDarkMode }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen">
      <Sidebar darkMode={darkMode} onToggleDarkMode={onToggleDarkMode} />
      <main className="flex-1 ml-64 bg-background">
        {children}
      </main>
    </div>
  );
}
