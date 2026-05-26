import { describe, expect, it } from "vitest";

import {
  nextOccurrence,
  recurrenceLabel,
  RECURRENCE_PRESETS,
} from "@/lib/server/recurrence";

/**
 * RRULE arithmetic is the floor of the recurrence feature — a silent
 * off-by-one would mean every recurring task drifts an hour or a day
 * with no visible error. These tests pin the arithmetic before it ships.
 *
 * Times use UTC ISO strings so the tests don't depend on the runner's
 * local TZ.
 */
describe("nextOccurrence", () => {
  it("FREQ=DAILY: 22:00 today → 22:00 tomorrow", () => {
    const from = new Date("2026-05-26T22:00:00Z");
    const next = nextOccurrence("FREQ=DAILY", from);
    expect(next?.toISOString()).toBe("2026-05-27T22:00:00.000Z");
  });

  it("FREQ=WEEKLY: 09:00 Monday → 09:00 next Monday (7d)", () => {
    // 2026-05-25 is a Monday.
    const from = new Date("2026-05-25T09:00:00Z");
    const next = nextOccurrence("FREQ=WEEKLY", from);
    expect(next?.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("FREQ=MONTHLY: 26 May → 26 June", () => {
    const from = new Date("2026-05-26T22:00:00Z");
    const next = nextOccurrence("FREQ=MONTHLY", from);
    expect(next?.toISOString()).toBe("2026-06-26T22:00:00.000Z");
  });

  it("FREQ=YEARLY: 26 May 2026 → 26 May 2027", () => {
    const from = new Date("2026-05-26T22:00:00Z");
    const next = nextOccurrence("FREQ=YEARLY", from);
    expect(next?.toISOString()).toBe("2027-05-26T22:00:00.000Z");
  });

  it("FREQ=WEEKLY;BYDAY=MO,WE,FR from a Monday picks Wednesday", () => {
    // 2026-05-25 Monday 09:00 → next occurrence among MO/WE/FR is
    // Wednesday 2026-05-27 09:00.
    const from = new Date("2026-05-25T09:00:00Z");
    const next = nextOccurrence("FREQ=WEEKLY;BYDAY=MO,WE,FR", from);
    expect(next?.toISOString()).toBe("2026-05-27T09:00:00.000Z");
  });

  it("FREQ=WEEKLY;BYDAY=MO from a Tuesday picks next Monday", () => {
    // 2026-05-26 is a Tuesday. Next Monday is 2026-06-01.
    const from = new Date("2026-05-26T09:00:00Z");
    const next = nextOccurrence("FREQ=WEEKLY;BYDAY=MO", from);
    expect(next?.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("returns null on malformed rule", () => {
    const from = new Date("2026-05-26T22:00:00Z");
    expect(nextOccurrence("not-a-rule", from)).toBeNull();
    expect(nextOccurrence("", from)).toBeNull();
  });

  it("returns null when UNTIL= clause is already in the past", () => {
    const from = new Date("2026-05-26T22:00:00Z");
    // UNTIL must precede `from` so there's no next occurrence.
    const next = nextOccurrence(
      "FREQ=DAILY;UNTIL=20260101T000000Z",
      from,
    );
    expect(next).toBeNull();
  });

  it("advances correctly across a month boundary", () => {
    const from = new Date("2026-05-31T22:00:00Z");
    const next = nextOccurrence("FREQ=DAILY", from);
    expect(next?.toISOString()).toBe("2026-06-01T22:00:00.000Z");
  });

  it("advances correctly across a year boundary", () => {
    const from = new Date("2026-12-31T22:00:00Z");
    const next = nextOccurrence("FREQ=DAILY", from);
    expect(next?.toISOString()).toBe("2027-01-01T22:00:00.000Z");
  });
});

describe("recurrenceLabel", () => {
  it("returns 'Tekrar yok' / 'No repeat' for null", () => {
    expect(recurrenceLabel(null, "tr")).toBe("Tekrar yok");
    expect(recurrenceLabel(null, "en")).toBe("No repeat");
  });

  it("recognizes the four presets in tr and en", () => {
    expect(recurrenceLabel(RECURRENCE_PRESETS.daily, "tr")).toBe("Günlük");
    expect(recurrenceLabel(RECURRENCE_PRESETS.daily, "en")).toBe("Daily");
    expect(recurrenceLabel(RECURRENCE_PRESETS.weekly, "tr")).toBe("Haftalık");
    expect(recurrenceLabel(RECURRENCE_PRESETS.monthly, "tr")).toBe("Aylık");
    expect(recurrenceLabel(RECURRENCE_PRESETS.yearly, "tr")).toBe("Yıllık");
  });

  it("normalises whitespace and case before matching", () => {
    expect(recurrenceLabel(" freq=daily ", "tr")).toBe("Günlük");
    expect(recurrenceLabel("FREQ=Weekly", "en")).toBe("Weekly");
  });

  it("falls back to 'Özel' / 'Custom' for non-preset rules", () => {
    expect(recurrenceLabel("FREQ=WEEKLY;BYDAY=MO,WE,FR", "tr")).toBe("Özel");
    expect(recurrenceLabel("FREQ=DAILY;INTERVAL=3", "en")).toBe("Custom");
  });
});
