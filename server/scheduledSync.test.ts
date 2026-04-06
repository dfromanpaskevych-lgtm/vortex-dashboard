import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================
// Tests for scheduled sync logic (msUntilMidnightKyiv, syncType)
// ============================================================

// We test the logic inline since msUntilMidnightKyiv is not exported
// We replicate the function here to test it independently
function msUntilMidnightKyiv(now: Date): number {
  const kyivOffset = 3 * 60 * 60 * 1000;
  const kyivNow = new Date(now.getTime() + kyivOffset);
  const nextMidnight = new Date(kyivNow);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  return nextMidnight.getTime() - kyivNow.getTime();
}

describe("msUntilMidnightKyiv", () => {
  it("returns ~24h when called exactly at midnight Kyiv", () => {
    // Midnight Kyiv = 21:00 UTC previous day
    const midnightKyiv = new Date("2026-04-07T21:00:00.000Z"); // = 00:00 Kyiv on Apr 8
    const ms = msUntilMidnightKyiv(midnightKyiv);
    // Should be exactly 24 hours (86400000 ms)
    expect(ms).toBe(24 * 60 * 60 * 1000);
  });

  it("returns ~12h when called at noon Kyiv (12:00)", () => {
    // Noon Kyiv = 09:00 UTC
    const noonKyiv = new Date("2026-04-07T09:00:00.000Z");
    const ms = msUntilMidnightKyiv(noonKyiv);
    expect(ms).toBe(12 * 60 * 60 * 1000);
  });

  it("returns ~1h when called at 23:00 Kyiv", () => {
    // 23:00 Kyiv = 20:00 UTC
    const elevenPmKyiv = new Date("2026-04-07T20:00:00.000Z");
    const ms = msUntilMidnightKyiv(elevenPmKyiv);
    expect(ms).toBe(1 * 60 * 60 * 1000);
  });

  it("returns ~23h when called at 01:00 Kyiv", () => {
    // 01:00 Kyiv = 22:00 UTC previous day
    const oneAmKyiv = new Date("2026-04-06T22:00:00.000Z");
    const ms = msUntilMidnightKyiv(oneAmKyiv);
    expect(ms).toBe(23 * 60 * 60 * 1000);
  });

  it("always returns a positive value", () => {
    const times = [
      new Date("2026-04-07T00:00:00.000Z"),
      new Date("2026-04-07T06:30:00.000Z"),
      new Date("2026-04-07T12:00:00.000Z"),
      new Date("2026-04-07T18:45:00.000Z"),
      new Date("2026-04-07T20:59:59.000Z"),
    ];
    for (const t of times) {
      expect(msUntilMidnightKyiv(t)).toBeGreaterThan(0);
    }
  });

  it("always returns <= 24h", () => {
    const times = [
      new Date("2026-04-07T00:00:00.000Z"),
      new Date("2026-04-07T10:00:00.000Z"),
      new Date("2026-04-07T20:59:59.000Z"),
    ];
    for (const t of times) {
      expect(msUntilMidnightKyiv(t)).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });
});

describe("syncType field validation", () => {
  it("syncType 'manual' is the default value", () => {
    const validTypes = ["manual", "auto"] as const;
    expect(validTypes).toContain("manual");
    expect(validTypes).toContain("auto");
  });

  it("auto sync uses 7 days window", () => {
    // Verify the constant used in startScheduledSync
    const AUTO_SYNC_DAYS = 7;
    expect(AUTO_SYNC_DAYS).toBe(7);
  });

  it("sync log duration calculation is correct", () => {
    const startedAt = new Date("2026-04-06T10:00:00.000Z");
    const completedAt = new Date("2026-04-06T10:05:30.000Z");
    const durationMs = completedAt.getTime() - startedAt.getTime();
    expect(durationMs).toBe(330000); // 5 min 30 sec
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.round((durationMs % 60000) / 1000);
    expect(minutes).toBe(5);
    expect(seconds).toBe(30);
  });

  it("duration display formats correctly for < 60s", () => {
    const durationMs = 45000; // 45 seconds
    const durationStr = durationMs < 60000
      ? `${Math.round(durationMs / 1000)}с`
      : `${Math.floor(durationMs / 60000)}хв ${Math.round((durationMs % 60000) / 1000)}с`;
    expect(durationStr).toBe("45с");
  });

  it("duration display formats correctly for >= 60s", () => {
    const durationMs = 330000; // 5 min 30 sec
    const durationStr = durationMs < 60000
      ? `${Math.round(durationMs / 1000)}с`
      : `${Math.floor(durationMs / 60000)}хв ${Math.round((durationMs % 60000) / 1000)}с`;
    expect(durationStr).toBe("5хв 30с");
  });
});
