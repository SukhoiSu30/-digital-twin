/**
 * Zoom Bot Manager
 *
 * Handles joining Zoom meetings. Currently supports:
 * - Bot status tracking via database
 * - Meeting lifecycle management
 *
 * The bot joining feature requires running the local bot script
 * (bot-local.js) on a machine with Chrome installed.
 */

import { EventEmitter } from "events";
import { prisma } from "../lib/prisma";

const activeBots = new Map<string, ZoomBotSession>();

export interface ZoomBotSession {
  meetingId: string;
  dbMeetingId: string;
  status: "connecting" | "waiting" | "active" | "disconnected" | "error";
  joinedAt: Date | null;
  emitter: EventEmitter;
}

export interface BotJoinParams {
  dbMeetingId: string;
  zoomMeetingId: string;
  zoomJoinUrl: string;
  zoomPasscode?: string | null;
  botName?: string;
}

/**
 * Initiate bot join — marks the meeting as JOINING
 * The actual browser-based joining is handled by the local bot script
 */
export async function joinMeeting(params: BotJoinParams): Promise<ZoomBotSession> {
  const { dbMeetingId, zoomMeetingId } = params;

  const emitter = new EventEmitter();

  const session: ZoomBotSession = {
    meetingId: zoomMeetingId,
    dbMeetingId,
    status: "connecting",
    joinedAt: null,
    emitter,
  };

  activeBots.set(dbMeetingId, session);

  await prisma.botSession.upsert({
    where: { meetingId: dbMeetingId },
    create: { meetingId: dbMeetingId, status: "connecting" },
    update: { status: "connecting", errorLog: null },
  });

  await prisma.meeting.update({
    where: { id: dbMeetingId },
    data: { status: "JOINING" },
  });

  console.log(`[ZoomBot] Meeting ${dbMeetingId} marked as JOINING — waiting for local bot to pick it up`);

  return session;
}

/**
 * Leave a meeting
 */
export async function leaveMeeting(dbMeetingId: string): Promise<void> {
  activeBots.delete(dbMeetingId);

  await prisma.botSession.update({
    where: { meetingId: dbMeetingId },
    data: { status: "disconnected", leftAt: new Date() },
  }).catch(console.error);

  await prisma.meeting.update({
    where: { id: dbMeetingId },
    data: { status: "PROCESSING" },
  }).catch(console.error);

  console.log(`[ZoomBot] Meeting ${dbMeetingId} — bot disconnected`);
}

/**
 * Get bot status
 */
export function getBotStatus(dbMeetingId: string): ZoomBotSession | null {
  return activeBots.get(dbMeetingId) || null;
}

/**
 * Get all active bot sessions
 */
export function getAllActiveBots(): Map<string, ZoomBotSession> {
  return activeBots;
}
