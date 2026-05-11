import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { MeetingCard } from "@/components/dashboard/MeetingCard";
import { RefreshCw, LogIn } from "lucide-react";
import { api } from "@/lib/api";

// Placeholder data — replaced by real API calls once authenticated
const DEMO_MEETINGS = [
  {
    id: "1",
    title: "Sprint Planning — Q3 Roadmap",
    startTime: new Date(Date.now() + 30 * 60000).toISOString(),
    endTime: new Date(Date.now() + 90 * 60000).toISOString(),
    status: "DISCOVERED",
    autoJoin: true,
    zoomJoinUrl: "https://zoom.us/j/1234567890",
    botSession: null,
    summary: null,
    actionItems: [],
  },
  {
    id: "2",
    title: "Client Sync — Digital Twin Demo",
    startTime: new Date(Date.now() + 120 * 60000).toISOString(),
    endTime: new Date(Date.now() + 150 * 60000).toISOString(),
    status: "SCHEDULED",
    autoJoin: true,
    zoomJoinUrl: "https://zoom.us/j/9876543210",
    botSession: null,
    summary: null,
    actionItems: [],
  },
  {
    id: "3",
    title: "Engineering Stand-up",
    startTime: new Date(Date.now() - 60 * 60000).toISOString(),
    endTime: new Date(Date.now() - 30 * 60000).toISOString(),
    status: "COMPLETED",
    autoJoin: true,
    zoomJoinUrl: "https://zoom.us/j/5555555555",
    botSession: null,
    summary: {
      overview:
        "Discussed progress on the digital twin project. Backend API routes are 80% complete. Frontend scaffold ready for review.",
    },
    actionItems: [
      { id: "a1", title: "Finalize Zoom SDK integration", status: "pending" },
      { id: "a2", title: "Set up Deepgram streaming", status: "pending" },
    ],
  },
];

export function Dashboard() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState(DEMO_MEETINGS);
  const [syncing, setSyncing] = useState(false);
  const [isAuthenticated] = useState(() => !!api.getToken());

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncCalendar();
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
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
              onJoin={(id) => api.joinMeeting(id)}
              onLeave={(id) => api.leaveMeeting(id)}
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
