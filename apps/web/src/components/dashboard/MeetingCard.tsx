import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Video, Bot, FileText, XCircle } from "lucide-react";

interface Meeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  autoJoin: boolean;
  zoomJoinUrl: string | null;
  botSession?: { status: string } | null;
  summary?: { overview: string } | null;
  actionItems?: { id: string; title: string; status: string }[];
}

interface MeetingCardProps {
  meeting: Meeting;
  onJoin?: (id: string) => void;
  onLeave?: (id: string) => void;
  onCancel?: (id: string) => void;
  onToggleAutoJoin?: (id: string, autoJoin: boolean) => void;
  onViewDetails?: (id: string) => void;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  DISCOVERED: { label: "Discovered", variant: "secondary" },
  SCHEDULED: { label: "Scheduled", variant: "default" },
  JOINING: { label: "Joining...", variant: "warning" },
  IN_PROGRESS: { label: "Live", variant: "success" },
  PROCESSING: { label: "Processing", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
  SKIPPED: { label: "Skipped", variant: "outline" },
};

export function MeetingCard({ meeting, onJoin, onLeave, onCancel, onViewDetails }: MeetingCardProps) {
  const start = new Date(meeting.startTime);
  const end = new Date(meeting.endTime);
  const now = new Date();
  const isUpcoming = start > now;
  const isLive = meeting.status === "IN_PROGRESS";
  const statusInfo = statusConfig[meeting.status] || { label: meeting.status, variant: "outline" as const };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const duration = Math.round((end.getTime() - start.getTime()) / 60000);

  return (
    <Card className={`transition-all ${isLive ? "border-green-500 shadow-green-100 shadow-md" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg leading-tight">{meeting.title}</CardTitle>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Time info */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {start.toLocaleDateString()}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {formatTime(start)} — {formatTime(end)}
            </span>
            <span className="text-xs">({duration} min)</span>
          </div>

          {/* Zoom link indicator */}
          {meeting.zoomJoinUrl && (
            <a href={meeting.zoomJoinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
              <Video className="h-4 w-4" />
              <span>Join Zoom Meeting</span>
            </a>
          )}

          {/* Summary preview if completed */}
          {meeting.summary && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="flex items-center gap-1 mb-1 font-medium">
                <FileText className="h-4 w-4" />
                Summary
              </div>
              <p className="text-muted-foreground line-clamp-2">{meeting.summary.overview}</p>
            </div>
          )}

          {/* Action items count */}
          {meeting.actionItems && meeting.actionItems.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {meeting.actionItems.filter((a) => a.status === "pending").length} pending action items
            </p>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {isUpcoming && meeting.status === "DISCOVERED" && onJoin && (
              <Button size="sm" onClick={() => onJoin(meeting.id)}>
                <Bot className="h-4 w-4 mr-1" />
                Send Bot
              </Button>
            )}
            {["JOINING", "SCHEDULED"].includes(meeting.status) && onCancel && (
              <Button size="sm" variant="destructive" onClick={() => onCancel(meeting.id)}>
                <XCircle className="h-4 w-4 mr-1" />
                Cancel Bot
              </Button>
            )}
            {isLive && onLeave && (
              <Button size="sm" variant="destructive" onClick={() => onLeave(meeting.id)}>
                End & Summarize
              </Button>
            )}
            {onViewDetails && (
              <Button size="sm" variant="outline" onClick={() => onViewDetails(meeting.id)}>
                View Details
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
