import { describe, expect, it } from "vitest";
import { mergeHistory } from "./historyMerge";

interface Row {
  date: string;
  value: number;
}

describe("mergeHistory", () => {
  it("appends new dates onto existing history, sorted chronologically", () => {
    const existing: Row[] = [{ date: "2026-01-01", value: 1 }];
    const fresh: Row[] = [{ date: "2026-01-03", value: 3 }, { date: "2026-01-02", value: 2 }];
    expect(mergeHistory(existing, fresh, 400)).toEqual([
      { date: "2026-01-01", value: 1 },
      { date: "2026-01-02", value: 2 },
      { date: "2026-01-03", value: 3 },
    ]);
  });

  it("overwrites an existing row when fresh has the same date", () => {
    const existing: Row[] = [{ date: "2026-01-01", value: 1 }];
    const fresh: Row[] = [{ date: "2026-01-01", value: 999 }];
    expect(mergeHistory(existing, fresh, 400)).toEqual([{ date: "2026-01-01", value: 999 }]);
  });

  it("caps the merged result to the most recent capDays rows", () => {
    const existing: Row[] = Array.from({ length: 5 }, (_, i) => ({ date: `2026-01-0${i + 1}`, value: i }));
    expect(mergeHistory(existing, [], 3)).toEqual([
      { date: "2026-01-03", value: 2 },
      { date: "2026-01-04", value: 3 },
      { date: "2026-01-05", value: 4 },
    ]);
  });

  it("returns existing unchanged (aside from cap) when fresh is empty", () => {
    const existing: Row[] = [{ date: "2026-01-01", value: 1 }];
    expect(mergeHistory(existing, [], 400)).toEqual(existing);
  });
});
