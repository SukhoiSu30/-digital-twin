/**
 * Zoom URL Parser
 * Extracts meeting IDs, passcodes, and validates Zoom URLs
 */

import crypto from "crypto";

export interface ZoomMeetingInfo {
  meetingId: string;
  passcode: string | null;
  joinUrl: string;
}

/**
 * Extract Zoom meeting link from any text (email body, calendar event, etc.)
 */
export function extractZoomLink(text: string): string | null {
  if (!text) return null;

  const patterns = [
    // Standard Zoom meeting links
    /https?:\/\/[\w.-]*zoom\.us\/j\/(\d{9,11})(\?pwd=[\w%-]+)?/gi,
    // Personal meeting room links
    /https?:\/\/[\w.-]*zoom\.us\/my\/[\w.-]+/gi,
    // Zoom webinar links
    /https?:\/\/[\w.-]*zoom\.us\/w\/(\d{9,11})(\?pwd=[\w%-]+)?/gi,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return null;
}

/**
 * Parse a Zoom URL into its components
 */
export function parseZoomUrl(url: string): ZoomMeetingInfo {
  // Extract meeting ID
  const meetingIdMatch = url.match(/\/(?:j|w)\/(\d{9,11})/);
  const personalRoomMatch = url.match(/\/my\/([\w.-]+)/);

  let meetingId: string;
  if (meetingIdMatch) {
    meetingId = meetingIdMatch[1];
  } else if (personalRoomMatch) {
    meetingId = personalRoomMatch[1]; // personal room name as ID
  } else {
    throw new Error(`Cannot extract meeting ID from URL: ${url}`);
  }

  // Extract passcode
  const passcodeMatch = url.match(/[?&]pwd=([\w%-]+)/);
  const passcode = passcodeMatch ? decodeURIComponent(passcodeMatch[1]) : null;

  return {
    meetingId,
    passcode,
    joinUrl: url,
  };
}

/**
 * Validate that a string is a valid Zoom meeting URL
 */
export function isValidZoomUrl(url: string): boolean {
  return /https?:\/\/[\w.-]*zoom\.us\/(j\/\d{9,11}|my\/[\w.-]+|w\/\d{9,11})/.test(url);
}

/**
 * Generate a Zoom SDK signature for joining meetings
 * Uses HMAC-SHA256 to sign the meeting number with SDK credentials
 */
export function generateZoomSignature(params: {
  sdkKey: string;
  sdkSecret: string;
  meetingNumber: string;
  role: number; // 0 = participant, 1 = host
}): string {
  const { sdkKey, sdkSecret, meetingNumber, role } = params;

  const timestamp = new Date().getTime() - 30000;
  const msg = Buffer.from(`${sdkKey}${meetingNumber}${timestamp}${role}`).toString("base64");
  const hash = crypto.createHmac("sha256", sdkSecret).update(msg).digest("base64");
  const signature = Buffer.from(
    `${sdkKey}.${meetingNumber}.${timestamp}.${role}.${hash}`
  ).toString("base64");

  return signature;
}
