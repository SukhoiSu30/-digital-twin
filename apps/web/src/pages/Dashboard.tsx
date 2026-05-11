import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { MeetingCard } from "@/components/dashboard/MeetingCard";
import { RefreshCw, LogIn } from "lucide-react";
import { api } from "@/lib/api";

// Group meetings by date label: "Today", "Tomorrow", or "Wed, May 14" etc.
function groupMeetingsByDate(meetings: any[]) {
  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toDateString();

  const groups: { label: string; sortKey: string; meetings: any[] }[] = [];
  const groupMap = new Map<string, any[]>();
  const labelMap = new Map<string, string>();

  // Sort meetings by startTime ascending
  const sorted = [...meetings].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  for (const meeting of sorted) {
    const meetingDate = new Date(meeting.startTime);
    const dateStr = meetingDate.toDateString();

    let label: string;
    if (dateStr === todayStr) {
      label = "Today";
    } else if (dateStr === tomorrowStr) {
      label = "Tomorrow";
    } else {
      label = meetingDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }

    if (!groupMap.has(dateStr)) {
      groupMap.set(dateStr, []);
      labelMap.set(dateStr, label);
    }
    groupMap.get(dateStr)!.push(meeting);
  }

  for (const [dateStr, meetingList] of groupMap) {
    groups.push({
      label: labelMap.get(dateStr)!,
      sortKey: dateStr,
      meetings: meetingList,
    });
  }

  return groups;
}

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

      // Auto-refresh every 30 seconds — keeps dashboard in sync
      // with Outlook deletions, expired meetings, and bot status changes
      const interval = setInterval(fetchMeetings, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncCalendar();
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

  const dateGroups = useMemo(() => groupMeetingsByDate(meetings), [meetings]);

  const renderCard = (meeting: any) => (
    <MeetingCard
      key={meeting.id}
      meeting={meeting}
      onJoin={async (id) => { await api.joinMeeting(id); fetchMeetings(); }}
      onLeave={async (id) => { await api.leaveMeeting(id); fetchMeetings(); }}
      onCancel={async (id) => { await api.cancelBot(id); fetchMeetings(); }}
      onDelete={async (id) => { await api.deleteMeeting(id); fetchMeetings(); }}
      onViewDetails={(id) => navigate(`/meetings/${id}`)}
    />
  );

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

      {/* Meetings grouped by date */}
      {dateGroups.map((group) => (
        <div key={group.sortKey}>
          <h2 className="text-xl font-semibold mb-4">{group.label}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.meetings.map(renderCard)}
          </div>
        </div>
      ))}

      {meetings.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground text-lg">
            No meetings found.
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
