import { expect, it } from "vitest";
import { equalSplit } from "./core";
import { percentageSplit } from "./percentageSplit";
import { analyzeSplitFairness } from "./splitFairness";

const ids = ["a", "b"];

it("uses actual rounded equal cents and treats equal intent as even for a one-cent purchase", () => {
  const result = analyzeSplitFairness(
    1,
    ids,
    equalSplit(1, ids),
    null,
    "equal",
  );
  expect(result.error).toBeNull();
  expect(
    result.rows.map(({ amount, percentage, difference, comparison }) => [
      amount,
      percentage,
      difference,
      comparison,
    ]),
  ).toEqual([
    [1, 50, 0, null],
    [0, 50, 0, null],
  ]);
});

it("preserves entered percentages and identifies high and low allocations after rounding", () => {
  const entries = [
    { member_id: "a", percentage: "60" },
    { member_id: "b", percentage: "40" },
  ];
  const result = analyzeSplitFairness(
    101,
    ids,
    percentageSplit(101, entries),
    entries,
    "percentage",
  );
  expect(
    result.rows.map(({ amount, percentage, difference, comparison }) => [
      amount,
      percentage,
      difference,
      comparison,
    ]),
  ).toEqual([
    [61, 60, 10, "high"],
    [40, 40, -10, "low"],
  ]);
});

it("keeps intentional zero in the split and suppresses notices for custom rounding alone", () => {
  const uneven = analyzeSplitFairness(
    2,
    ids,
    [
      { member_id: "a", cents: 2 },
      { member_id: "b", cents: 0 },
    ],
    null,
    "custom",
  );
  expect(uneven.rows[1]).toMatchObject({
    amount: 0,
    percentage: 0,
    difference: -1,
    comparison: "low",
  });
  const rounded = analyzeSplitFairness(
    1,
    ids,
    [
      { member_id: "a", cents: 0 },
      { member_id: "b", cents: 1 },
    ],
    null,
    "custom",
  );
  expect(rounded.rows.map(({ comparison }) => comparison)).toEqual([
    null,
    null,
  ]);
});

it("separates invalid and unfinished allocations from uneven splits", () => {
  const shares = [
    { member_id: "a", cents: 60 },
    { member_id: "b", cents: 40 },
  ];
  expect(analyzeSplitFairness(101, ids, shares, null, "custom")).toEqual({
    rows: [],
    error: "Shares must add up to the purchase total.",
  });
  expect(
    analyzeSplitFairness(
      100,
      ids,
      [],
      [],
      "percentage",
      "Roommate percentages must total exactly 100%.",
    ),
  ).toEqual({
    rows: [],
    error: "Roommate percentages must total exactly 100%.",
  });
  expect(analyzeSplitFairness(0, ids, [], null, "equal").rows).toEqual([]);
});
