import { useEffect, useRef, useState, useCallback } from "react";
import { io as socketIo, Socket } from "socket.io-client";

interface TranscriptEvent {
  meetingId: string;
  speaker: string;
  text: string;
  isFinal: boolean;
  confidence: number;
  timestamp: number;
}

interface MeetingStatusEvent {
  meetingId: string;
  status: string;
  botJoinedAt?: string;
  error?: string;
}

interface SummaryReadyEvent {
  meetingId: string;
  overview: string;
  actionItemCount: number;
}

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = socketIo("/", {
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      console.log("[WebSocket] Connected:", socket.id);
      setConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("[WebSocket] Disconnected");
      setConnected(false);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinMeetingRoom = useCallback((meetingId: string) => {
    socketRef.current?.emit("join:meeting", meetingId);
  }, []);

  const leaveMeetingRoom = useCallback((meetingId: string) => {
    socketRef.current?.emit("leave:meeting", meetingId);
  }, []);

  const onTranscript = useCallback((callback: (data: TranscriptEvent) => void) => {
    socketRef.current?.on("transcript:live", callback);
    return () => {
      socketRef.current?.off("transcript:live", callback);
    };
  }, []);

  const onMeetingStatus = useCallback((callback: (data: MeetingStatusEvent) => void) => {
    socketRef.current?.on("meeting:status", callback);
    return () => {
      socketRef.current?.off("meeting:status", callback);
    };
  }, []);

  const onSummaryReady = useCallback((callback: (data: SummaryReadyEvent) => void) => {
    socketRef.current?.on("summary:ready", callback);
    return () => {
      socketRef.current?.off("summary:ready", callback);
    };
  }, []);

  return {
    connected,
    joinMeetingRoom,
    leaveMeetingRoom,
    onTranscript,
    onMeetingStatus,
    onSummaryReady,
  };
}
