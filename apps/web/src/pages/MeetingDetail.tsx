import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LiveTranscript } from "@/components/meetings/LiveTranscript";
import { SummaryPanel } from "@/components/meetings/SummaryPanel";
import { ArrowLeft, Bot, Calendar, Clock, Video, RefreshCw, XCircle } from "lucide-react";
import { api } from "@/lib/api";

interface MeetingData {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  status: string;
  autoJoin: boolean;
  zoomJoinUrl: string | null;
  botSession: { status: string; joinedAt: string | null } | null;
  summary: {
    overview: string;
    keyPoints: string[];
    decisions: string[];
    emailSentAt: string | null;
  } | null;
  actionItems: Array<{
    id: string;
    title: string;
    description: string | null;
    assignee: string | null;
    priority: string;
    status: string;
    dueDate: string | null;
  }>;
  transcriptSegments: Array<{
    id: string;
    speaker: string | null;
    content: string;
    startMs: number;
    isFinal: boolean;
  }>;
}

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  DISCOVERED: { label: "Discovered", variant: "secondary" },
  SCHEDULED: { label: "Bot Scheduled", variant: "default" },
  JOINING: { label: "Bot Joining...", variant: "warning" },
  IN_PROGRESS: { label: "Live — Bot in Meeting", variant: "success" },
  PROCESSING: { label: "Generating Summary...", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
  SKIPPED: { label: "Skipped", variant: "outline" },
};

export function MeetingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMeeting = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const response = await api.getMeeting(id);
      setMeeting(response.data as MeetingData);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load meeting");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeeting();

    // Poll for updates while meeting is active
    const interval = setInterval(() => {
      if (meeting && ["IN_PROGRESS", "PROCESSING", "JOINING"].includes(meeting.status)) {
        fetchMeeting();
      }
    }, 10000); // Every 10 seconds

    return () => clearInterval(interval);
  }, [id]);

  const handleJoinBot = async () => {
    if (!id) return;
    try {
      await api.joinMeeting(id);
      fetchMeeting();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCancelBot = async () => {
    if (!id) return;
    try {
      await api.cancelBot(id);
      fetchMeeting();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleLeaveBot = async () => {
    if (!id) return;
    try {
      await api.leaveMeeting(id);
      fetchMeeting();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleAction = async (actionId: string, status: string) => {
    try {
      await api.updateAction(actionId, { status });
      fetchMeeting();
    } catch (err: any) {
      console.error("Failed to update action:", err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading meeting...</div>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-destructive">{error || "Meeting not found"}</p>
        <Button variant="outline" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const isLive = meeting.status === "IN_PROGRESS";
  const statusInfo = statusLabels[meeting.status] || { label: meeting.status, variant: "outline" as const };
  const startTime = new Date(meeting.startTime);
  const endTime = new Date(meeting.endTime);
  const durationMin = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
          </div>
          <h1 className="text-2xl font-bold">{meeting.title}</h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {startTime.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — {endTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span>({durationMin} min)</span>
            {meeting.zoomJoinUrl && (
              <a href={meeting.zoomJoinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                <Video className="h-4 w-4" />
                Join Zoom Meeting
              </a>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-4">
            {["DISCOVERED", "SCHEDULED"].includes(meeting.status) && (
              <Button size="sm" onClick={handleJoinBot}>
                <Bot className="h-4 w-4 mr-1" />
                Send Bot Now
              </Button>
            )}
            {["JOINING", "SCHEDULED"].includes(meeting.status) && (
              <Button size="sm" variant="destructive" onClick={handleCancelBot}>
                <XCircle className="h-4 w-4 mr-1" />
                Cancel Bot
              </Button>
            )}
            {isLive && (
              <Button size="sm" variant="destructive" onClick={handleLeaveBot}>
                End & Generate Summary
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={fetchMeeting}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Transcript */}
          <div>
            {isLive ? (
              <LiveTranscript meetingId={meeting.id} isLive={true} />
            ) : meeting.transcriptSegments.length > 0 ? (
              <div className="bg-card border rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-4">Transcript</h2>
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {meeting.transcriptSegments.map((seg) => (
                    <div key={seg.id} className="flex gap-3">
                      <span className="text-xs text-muted-foreground w-10 shrink-0 pt-0.5">
                        {Math.floor(seg.startMs / 60000)}:{String(Math.floor((seg.startMs % 60000) / 1000)).padStart(2, "0")}
                      </span>
                      <div>
                        <span className="text-sm font-semibold text-blue-600">
                          {seg.speaker || "Unknown"}:
                        </span>
                        <span className="text-sm ml-1">{seg.content}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-card border rounded-lg p-12 text-center text-muted-foreground">
                <Bot className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p>Transcript will appear here during the meeting.</p>
                <p className="text-sm mt-1">Send the bot to start recording.</p>
              </div>
            )}
          </div>

          {/* Right: Summary + Action Items */}
          <div>
            <SummaryPanel
              summary={meeting.summary}
              actionItems={meeting.actionItems}
              onToggleAction={handleToggleAction}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
