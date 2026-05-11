import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Calendar,
  Clock,
  Video,
  Bot,
  FileText,
  ChevronRight,
  Filter,
} from "lucide-react";
import { api } from "@/lib/api";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  DISCOVERED: { label: "Discovered", variant: "secondary" },
  SCHEDULED: { label: "Scheduled", variant: "default" },
  JOINING: { label: "Joining", variant: "warning" },
  IN_PROGRESS: { label: "Live", variant: "success" },
  PROCESSING: { label: "Processing", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
  SKIPPED: { label: "Skipped", variant: "outline" },
};

export function MeetingsList() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const fetchMeetings = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (filter !== "all") params.status = filter;
      const response = await api.getMeetings(params);
      if (response.data && Array.isArray(response.data)) {
        setMeetings(response.data as any[]);
      }
    } catch (error) {
      console.error("Failed to fetch meetings:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, [filter]);

  const filtered =
    filter === "all"
      ? meetings
      : meetings.filter((m) => m.status === filter);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Meetings</h1>
          <p className="text-sm text-muted-foreground">
            All meetings discovered from your calendar
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {["all", "DISCOVERED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "FAILED"].map(
          (f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "All"
                : statusConfig[f]?.label || f}
            </Button>
          )
        )}
      </div>

      {/* Meeting list */}
      <div className="space-y-3">
        {filtered.map((meeting) => {
          const start = new Date(meeting.startTime);
          const end = new Date(meeting.endTime);
          const duration = Math.round(
            (end.getTime() - start.getTime()) / 60000
          );
          const status = statusConfig[meeting.status] || {
            label: meeting.status,
            variant: "outline" as const,
          };
          const isLive = meeting.status === "IN_PROGRESS";

          return (
            <Card
              key={meeting.id}
              className={`cursor-pointer transition-all hover:shadow-md ${
                isLive ? "border-green-500 shadow-green-100 shadow-sm" : ""
              }`}
              onClick={() => navigate(`/meetings/${meeting.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold">{meeting.title}</h3>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {start.toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {start.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        —{" "}
                        {end.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>({duration} min)</span>
                      {meeting.zoomJoinUrl && (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Video className="h-3.5 w-3.5" />
                          Zoom
                        </span>
                      )}
                      {meeting.status === "IN_PROGRESS" && (
                        <span className="flex items-center gap-1 text-green-600">
                          <Bot className="h-3.5 w-3.5" />
                          Bot active
                        </span>
                      )}
                      {meeting.actionItemCount > 0 && (
                        <span className="flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" />
                          {meeting.actionItemCount} actions
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Loading meetings...</p>
        </div>
      ) : filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No meetings found. Sync your calendar to discover meetings.</p>
        </div>
      )}
    </div>
  );
}
