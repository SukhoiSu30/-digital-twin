import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { MeetingCard } from "@/components/dashboard/MeetingCard";
import { RefreshCw, LogIn } from "lucide-react";
import { api } from "@/lib/api";

export function Dashboard() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [isAuthenticated] = useState(() => !!api.getToken());

  const fetchMeetings = async () => {
    try {
      const response = await api.getMeetings();
      if (response.data && Array.isArray(response.data)) {
        setMeetings(response.data as any[]);
      }
    } catch (error) {
      console.error("Failed to fetch meetings:", error);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchMeetings();
    }
  }, [isAuthenticated]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncCalendar();
      // Wait a moment for sync to complete, then fetch meetings
      setTimeout(async () => {
        await fetchMeetings();
        setSyncing(false);
      }, 3000);
    } catch (error) {
      console.error("Sync failed:", error);
      setSyncing(false);
    }
  };

  const handleLogin = () => {
    window.location.href = api.getAuthUrl("microsoft");
  };

  const activeBots = meetings.filter((m) => m.status === "IN_PROGRESS").length;
  const completedSummaries = meetings.filter(
    (m) => m.status === "COMPLETED"
  ).length;
  const pendingActions = meetings
    .flatMap((m) => m.actionItems || [])
    .filter((a) => a.status === "pending").length;

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Your meetings at a glance
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isAuthenticated ? (
            <Button onClick={handleLogin}>
              <LogIn className="h-4 w-4 mr-2" />
              Connect Microsoft Account
            </Button>
          ) : (
            <Button
              onClick={handleSync}
              disabled={syncing}
              variant="outline"
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing ? "Syncing..." : "Sync Calendar"}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <StatsBar
        totalMeetings={meetings.length}
        activeBots={activeBots}
        completedSummaries={completedSummaries}
        pendingActions={pendingActions}
      />

      {/* Today's Meetings */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Today's Meetings</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              onJoin={async (id) => { await api.joinMeeting(id); fetchMeetings(); }}
              onLeave={async (id) => { await api.leaveMeeting(id); fetchMeetings(); }}
              onCancel={async (id) => { await api.cancelBot(id); fetchMeetings(); }}
              onViewDetails={(id) => navigate(`/meetings/${id}`)}
            />
          ))}
        </div>
      </div>

      {meetings.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground text-lg">
            No meetings found for today.
          </p>
          <p className="text-muted-foreground text-sm mt-1">
            Connect your Microsoft account and sync your calendar to get
            started.
          </p>
        </div>
      )}
    </div>
  );
}
