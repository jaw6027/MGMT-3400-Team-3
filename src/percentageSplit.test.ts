import { describe, expect, it } from "vitest";
import { percentageSplit } from "./percentageSplit";

const entries = (...values: string[]) =>
  values.map((percentage, index) => ({ member_id: String(index), percentage }));

describe("percentageSplit", () => {
  it("accepts hundredths of a percent and zero shares", () => {
    expect(percentageSplit(10000, entries("33.33", "66.67", "0"))).toEqual([
      { member_id: "0", cents: 3333 },
      { member_id: "1", cents: 6667 },
      { member_id: "2", cents: 0 },
    ]);
  });

  it.each([
    ["33.33", "66.66"],
    ["50", "50.01"],
  ])("rejects totals other than 100%% (%s and %s)", (first, second) => {
    expect(() => percentageSplit(100, entries(first, second))).toThrow(
      "must total exactly 100%",
    );
  });

  it.each(["", "-1", "50.001", "101"])(
    "rejects an invalid percentage (%s)",
    (value) => {
      expect(() => percentageSplit(100, entries(value, "100"))).toThrow(
        /valid percentage|between 0 and 100/,
      );
    },
  );

  it("allocates the remainder by fractional cent, breaking ties in entry order", () => {
    expect(
      percentageSplit(101, entries("33.33", "33.33", "33.34")).map(
        (s) => s.cents,
      ),
    ).toEqual([34, 33, 34]);
    expect(percentageSplit(1, entries("50", "50")).map((s) => s.cents)).toEqual(
      [1, 0],
    );
  });
});
