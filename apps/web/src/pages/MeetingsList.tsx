import { useState } from "react";
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

// Demo data — replaced by API calls once authenticated
const DEMO_MEETINGS = [
  {
    id: "1",
    title: "Sprint Planning — Q3 Roadmap",
    startTime: new Date(Date.now() + 30 * 60000).toISOString(),
    endTime: new Date(Date.now() + 90 * 60000).toISOString(),
    status: "SCHEDULED",
    zoomJoinUrl: "https://zoom.us/j/1234567890",
    actionItemCount: 0,
  },
  {
    id: "2",
    title: "Client Sync — Digital Twin Demo",
    startTime: new Date(Date.now() + 120 * 60000).toISOString(),
    endTime: new Date(Date.now() + 150 * 60000).toISOString(),
    status: "DISCOVERED",
    zoomJoinUrl: "https://zoom.us/j/9876543210",
    actionItemCount: 0,
  },
  {
    id: "3",
    title: "Engineering Stand-up",
    startTime: new Date(Date.now() - 60 * 60000).toISOString(),
    endTime: new Date(Date.now() - 30 * 60000).toISOString(),
    status: "COMPLETED",
    zoomJoinUrl: "https://zoom.us/j/5555555555",
    actionItemCount: 3,
  },
  {
    id: "4",
    title: "Design Review — Dashboard UI",
    startTime: new Date(Date.now() - 180 * 60000).toISOString(),
    endTime: new Date(Date.now() - 120 * 60000).toISOString(),
    status: "COMPLETED",
    zoomJoinUrl: "https://zoom.us/j/4444444444",
    actionItemCount: 5,
  },
  {
    id: "5",
    title: "Weekly All-Hands",
    startTime: new Date(Date.now() + 240 * 60000).toISOString(),
    endTime: new Date(Date.now() + 300 * 60000).toISOString(),
    status: "DISCOVERED",
    zoomJoinUrl: "https://zoom.us/j/3333333333",
    actionItemCount: 0,
  },
];

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
  const [filter, setFilter] = useState<string>("all");

  const filtered =
    filter === "all"
      ? DEMO_MEETINGS
      : DEMO_MEETINGS.filter((m) => m.status === filter);

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

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No meetings found with this filter.</p>
        </div>
      )}
    </div>
  );
}
