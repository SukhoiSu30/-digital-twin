/**
 * Unit Tests — Zoom URL Parser
 *
 * Run with: npx tsx tests/unit/zoom-url-parser.test.ts
 * (No test framework needed — uses simple assertions)
 */

import {
  extractZoomLink,
  parseZoomUrl,
  isValidZoomUrl,
} from "../../apps/server/src/utils/zoom-url-parser";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual: any, expected: any, label: string = "") {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${label ? ` (${label})` : ""}`
    );
  }
}

console.log("\n─── Zoom URL Parser Tests ───\n");

// ─── extractZoomLink ─────────────────────────────────────

console.log("extractZoomLink:");

test("extracts standard Zoom meeting link", () => {
  const text = "Join us at https://zoom.us/j/1234567890 for the meeting";
  assertEqual(extractZoomLink(text), "https://zoom.us/j/1234567890");
});

test("extracts Zoom link with password", () => {
  const text = "Meeting: https://zoom.us/j/1234567890?pwd=abc123DEF";
  assertEqual(extractZoomLink(text), "https://zoom.us/j/1234567890?pwd=abc123DEF");
});

test("extracts Zoom link from HTML body", () => {
  const html = '<p>Join: <a href="https://us02web.zoom.us/j/9876543210?pwd=xyz789">Click here</a></p>';
  const result = extractZoomLink(html);
  assert(result !== null, "Should find a link");
  assert(result!.includes("9876543210"), "Should contain meeting ID");
});

test("extracts personal meeting room link", () => {
  const text = "My room: https://zoom.us/my/john.doe";
  assertEqual(extractZoomLink(text), "https://zoom.us/my/john.doe");
});

test("returns null when no Zoom link present", () => {
  const text = "Let's meet on Google Meet instead: https://meet.google.com/abc-defg-hij";
  assertEqual(extractZoomLink(text), null);
});

test("returns null for empty string", () => {
  assertEqual(extractZoomLink(""), null);
});

test("returns null for null-ish input", () => {
  assertEqual(extractZoomLink(null as any), null);
});

test("handles subdomain variations", () => {
  const text = "https://us04web.zoom.us/j/1111111111?pwd=test123";
  const result = extractZoomLink(text);
  assert(result !== null, "Should find link with subdomain");
});

// ─── parseZoomUrl ────────────────────────────────────────

console.log("\nparseZoomUrl:");

test("parses standard meeting URL", () => {
  const result = parseZoomUrl("https://zoom.us/j/1234567890");
  assertEqual(result.meetingId, "1234567890");
  assertEqual(result.passcode, null);
});

test("parses URL with passcode", () => {
  const result = parseZoomUrl("https://zoom.us/j/1234567890?pwd=abc123");
  assertEqual(result.meetingId, "1234567890");
  assertEqual(result.passcode, "abc123");
});

test("parses URL with encoded passcode", () => {
  const result = parseZoomUrl("https://zoom.us/j/1234567890?pwd=abc%20123");
  assertEqual(result.meetingId, "1234567890");
  assertEqual(result.passcode, "abc 123");
});

test("parses personal room URL", () => {
  const result = parseZoomUrl("https://zoom.us/my/john.doe");
  assertEqual(result.meetingId, "john.doe");
  assertEqual(result.passcode, null);
});

test("parses webinar URL", () => {
  const result = parseZoomUrl("https://zoom.us/w/9876543210?pwd=webinar123");
  assertEqual(result.meetingId, "9876543210");
  assertEqual(result.passcode, "webinar123");
});

test("throws on invalid URL", () => {
  try {
    parseZoomUrl("https://google.com/meeting");
    throw new Error("Should have thrown");
  } catch (e: any) {
    assert(e.message.includes("Cannot extract meeting ID"), "Should throw meaningful error");
  }
});

// ─── isValidZoomUrl ──────────────────────────────────────

console.log("\nisValidZoomUrl:");

test("validates standard meeting URL", () => {
  assert(isValidZoomUrl("https://zoom.us/j/1234567890"), "Should be valid");
});

test("validates URL with subdomain", () => {
  assert(isValidZoomUrl("https://us02web.zoom.us/j/1234567890"), "Should be valid");
});

test("validates personal room URL", () => {
  assert(isValidZoomUrl("https://zoom.us/my/john.doe"), "Should be valid");
});

test("validates webinar URL", () => {
  assert(isValidZoomUrl("https://zoom.us/w/9876543210"), "Should be valid");
});

test("rejects non-Zoom URL", () => {
  assert(!isValidZoomUrl("https://meet.google.com/abc"), "Should be invalid");
});

test("rejects malformed Zoom URL", () => {
  assert(!isValidZoomUrl("https://zoom.us/pricing"), "Should be invalid");
});

// ─── Results ─────────────────────────────────────────────

console.log(`\n─── Results: ${passed} passed, ${failed} failed ───\n`);
process.exit(failed > 0 ? 1 : 0);
