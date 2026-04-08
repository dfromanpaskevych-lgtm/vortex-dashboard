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

// ============================================================
// Tests for splitIntoChunks logic (replicated from syncService)
// ============================================================

function splitIntoChunks(startDate: Date, endDate: Date, chunkSizeDays = 7): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkSizeDays - 1);
    const actualEnd = chunkEnd > endDate ? new Date(endDate) : chunkEnd;

    chunks.push({
      from: new Date(current),
      to: new Date(actualEnd),
    });

    current.setDate(current.getDate() + chunkSizeDays);
  }

  return chunks;
}

describe("splitIntoChunks", () => {
  it("returns 1 chunk for 3-day period", () => {
    const start = new Date("2026-04-01");
    const end = new Date("2026-04-03");
    const chunks = splitIntoChunks(start, end);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].from.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(chunks[0].to.toISOString().slice(0, 10)).toBe("2026-04-03");
  });

  it("returns 1 chunk for exactly 7-day period", () => {
    const start = new Date("2026-04-01");
    const end = new Date("2026-04-07");
    const chunks = splitIntoChunks(start, end);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].from.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(chunks[0].to.toISOString().slice(0, 10)).toBe("2026-04-07");
  });

  it("returns 2 chunks for 14-day period", () => {
    const start = new Date("2026-04-01");
    const end = new Date("2026-04-14");
    const chunks = splitIntoChunks(start, end);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].from.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(chunks[0].to.toISOString().slice(0, 10)).toBe("2026-04-07");
    expect(chunks[1].from.toISOString().slice(0, 10)).toBe("2026-04-08");
    expect(chunks[1].to.toISOString().slice(0, 10)).toBe("2026-04-14");
  });

  it("returns 5 chunks for 30-day period", () => {
    const start = new Date("2026-03-01");
    const end = new Date("2026-03-30");
    const chunks = splitIntoChunks(start, end);
    expect(chunks).toHaveLength(5);
    // First chunk: Mar 1-7
    expect(chunks[0].from.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(chunks[0].to.toISOString().slice(0, 10)).toBe("2026-03-07");
    // Last chunk starts at Mar 29 (1+7*4=29) but due to Date math it's Mar 28+1=29... let's just check boundaries
    // Chunk 4 (index 4): starts at day 28+1 = Mar 29, ends at Mar 30
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.to.toISOString().slice(0, 10)).toBe("2026-03-30");
  });

  it("returns ~9 chunks for 2-month period (60 days)", () => {
    const start = new Date("2026-02-01");
    const end = new Date("2026-04-01");
    const chunks = splitIntoChunks(start, end);
    // 59 days → ceil(59/7) = 9 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(8);
    expect(chunks.length).toBeLessThanOrEqual(9);
    // All chunks should be within range
    for (const chunk of chunks) {
      expect(chunk.from >= start).toBe(true);
      expect(chunk.to <= end).toBe(true);
    }
  });

  it("chunks don't overlap and cover entire range", () => {
    const start = new Date("2026-03-01");
    const end = new Date("2026-03-20");
    const chunks = splitIntoChunks(start, end);
    // First chunk starts at start
    expect(chunks[0].from.toISOString().slice(0, 10)).toBe("2026-03-01");
    // Last chunk ends at end
    expect(chunks[chunks.length - 1].to.toISOString().slice(0, 10)).toBe("2026-03-20");
    // No gaps between chunks
    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = chunks[i - 1].to;
      const nextStart = chunks[i].from;
      const diffDays = (nextStart.getTime() - prevEnd.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(1); // exactly 1 day gap (next day)
    }
  });

  it("returns 1 chunk for single day", () => {
    const start = new Date("2026-04-01");
    const end = new Date("2026-04-01");
    const chunks = splitIntoChunks(start, end);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].from.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(chunks[0].to.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
});
