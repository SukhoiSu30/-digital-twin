import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Radio } from "lucide-react";

interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

interface LiveTranscriptProps {
  meetingId: string;
  isLive: boolean;
}

const speakerColors: Record<string, string> = {
  "Speaker 0": "text-blue-600",
  "Speaker 1": "text-green-600",
  "Speaker 2": "text-purple-600",
  "Speaker 3": "text-orange-600",
  "Speaker 4": "text-pink-600",
  Unknown: "text-gray-500",
};

export function LiveTranscript({ meetingId, isLive }: LiveTranscriptProps) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { joinMeetingRoom, leaveMeetingRoom, onTranscript, connected } = useWebSocket();

  useEffect(() => {
    if (!isLive || !connected) return;

    joinMeetingRoom(meetingId);

    const cleanup = onTranscript((data) => {
      if (data.meetingId !== meetingId) return;

      setLines((prev) => {
        // For interim results, update the last line from the same speaker
        if (!data.isFinal) {
          const lastIndex = prev.findLastIndex(
            (l) => l.speaker === data.speaker && !l.isFinal
          );
          if (lastIndex >= 0) {
            const updated = [...prev];
            updated[lastIndex] = {
              ...updated[lastIndex],
              text: data.text,
            };
            return updated;
          }
        }

        // Add new line
        return [
          ...prev.filter((l) => l.isFinal), // Remove old interim lines
          {
            id: `${data.timestamp}-${Date.now()}`,
            speaker: data.speaker,
            text: data.text,
            isFinal: data.isFinal,
            timestamp: data.timestamp,
          },
        ];
      });
    });

    return () => {
      cleanup();
      leaveMeetingRoom(meetingId);
    };
  }, [meetingId, isLive, connected, joinMeetingRoom, leaveMeetingRoom, onTranscript]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const formatTimestamp = (ms: number) => {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Live Transcript</CardTitle>
          {isLive && (
            <Badge variant="success" className="flex items-center gap-1">
              <Radio className="h-3 w-3 animate-pulse" />
              Live
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="h-[500px] overflow-y-auto space-y-3 pr-2 scroll-smooth"
        >
          {lines.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {isLive
                ? "Waiting for speech..."
                : "No transcript available yet"}
            </div>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className={`flex gap-3 ${!line.isFinal ? "opacity-60" : ""}`}
              >
                <span className="text-xs text-muted-foreground w-10 shrink-0 pt-0.5">
                  {formatTimestamp(line.timestamp)}
                </span>
                <div>
                  <span
                    className={`text-sm font-semibold ${
                      speakerColors[line.speaker] || "text-gray-600"
                    }`}
                  >
                    {line.speaker}:
                  </span>
                  <span className="text-sm ml-1">{line.text}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
