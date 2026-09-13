import { describe, expect, it } from "vitest";
import { chunkArray } from "./concurrency";

describe("chunkArray", () => {
  it("splits an array into groups of at most `size`", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size >= length", () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns one empty chunk for an empty array, not zero chunks", () => {
    expect(chunkArray([], 10)).toEqual([[]]);
  });
});
