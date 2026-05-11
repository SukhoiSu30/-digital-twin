import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { MeetingsList } from "@/pages/MeetingsList";
import { MeetingDetail } from "@/pages/MeetingDetail";
import { ActionItems } from "@/pages/ActionItems";
import { Settings } from "@/pages/Settings";
import { AuthCallback } from "@/pages/AuthCallback";

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    // Default to dark mode; user can toggle to light
    return true;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  return (
    <BrowserRouter>
      <Routes>
        {/* Auth callback pages — no sidebar */}
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/auth/error" element={<AuthCallback />} />

        {/* Main app pages — with sidebar */}
        <Route
          path="*"
          element={
            <AppLayout darkMode={darkMode} onToggleDarkMode={toggleDarkMode}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/meetings" element={<MeetingsList />} />
                <Route path="/meetings/:id" element={<MeetingDetail />} />
                <Route path="/actions" element={<ActionItems />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </AppLayout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
