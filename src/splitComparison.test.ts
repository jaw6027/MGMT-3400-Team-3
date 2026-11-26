import { describe, expect, it } from "vitest";
import { compareSplits } from "./splitComparison";
import type { SplitTemplate } from "./splitTemplates";

const members = [
  { id: "a", name: "Alex", user_id: "alex" },
  { id: "b", name: "Jordan", user_id: "jordan" },
  { id: "c", name: "Sam", user_id: "sam" },
];
const template: SplitTemplate = {
  id: "utilities",
  household_id: "home",
  name: "Utilities",
  version: 1,
  allocations: [
    { member_id: "a", percentage: "60" },
    { member_id: "c", percentage: "40" },
  ],
};

describe("split comparison", () => {
  it("computes custom-dollar differences from the actual rounded equal shares", () => {
    const option = {
      mode: "custom" as const,
      amounts: { a: "6.01", b: "4.00" },
    };
    const result = compareSplits(1001, ["b", "a"], option, members);
    expect(result.preferred).toEqual(option);
    expect(result.rows).toEqual([
      {
        memberId: "b",
        includedInEqual: true,
        includedInAlternative: true,
        equalCents: 500,
        alternativeCents: 400,
        difference: -100,
      },
      {
        memberId: "a",
        includedInEqual: true,
        includedInAlternative: true,
        equalCents: 501,
        alternativeCents: 601,
        difference: 100,
      },
    ]);

    const changed = compareSplits(1002, ["b", "a"], option, members);
    expect(changed.alternative.error).toContain("must add up");
    expect(changed.preferred).toBeUndefined();
    expect(changed.rows[0]).toMatchObject({
      equalCents: 501,
      difference: null,
    });
  });

  it("validates each allocation and disables application without a valid total", () => {
    const option = {
      mode: "percentage" as const,
      allocations: template.allocations,
    };
    const invalid = {
      ...option,
      allocations: [{ member_id: "a", percentage: "99.99" }],
    };
    const result = compareSplits(1001, ["a"], invalid, members);
    expect(result.alternative.error).toContain("exactly 100%");
    expect(result.preferred).toBeUndefined();
    expect(
      compareSplits(0, ["a", "c"], option, members).preferred,
    ).toBeUndefined();
    expect(
      compareSplits(1001, [], { mode: "custom", amounts: {} }, members)
        .preferred,
    ).toBeUndefined();
    const malformed = compareSplits(
      1001,
      ["a"],
      { mode: "custom", amounts: { a: "bad" } },
      members,
    );
    expect(malformed.alternative.error).toContain("two decimal places");
  });

  it("recalculates percentage shares and differences when the expense changes", () => {
    const option = {
      mode: "percentage" as const,
      allocations: template.allocations,
    };
    expect(
      compareSplits(1001, ["a", "c"], option, members).rows.map(
        (row) => row.difference,
      ),
    ).toEqual([100, -100]);
    expect(
      compareSplits(2001, ["a", "c"], option, members).rows.map(
        (row) => row.difference,
      ),
    ).toEqual([200, -200]);
  });

  it("compares both sets of roommates and preserves the template allocations", () => {
    const snapshot = JSON.stringify(template);
    const result = compareSplits(
      1001,
      ["a", "b"],
      { mode: "template", template },
      members,
    );
    expect(result.rows).toEqual([
      {
        memberId: "a",
        includedInEqual: true,
        includedInAlternative: true,
        equalCents: 501,
        alternativeCents: 601,
        difference: 100,
      },
      {
        memberId: "b",
        includedInEqual: true,
        includedInAlternative: false,
        equalCents: 500,
        alternativeCents: 0,
        difference: -500,
      },
      {
        memberId: "c",
        includedInEqual: false,
        includedInAlternative: true,
        equalCents: 0,
        alternativeCents: 400,
        difference: 400,
      },
    ]);
    expect(result.preferred).toEqual({
      mode: "percentage",
      allocations: template.allocations,
    });
    expect(JSON.stringify(template)).toBe(snapshot);
    const zeroShare = {
      ...template,
      allocations: [
        { member_id: "a", percentage: "100" },
        { member_id: "c", percentage: "0" },
      ],
    };
    expect(
      compareSplits(
        1001,
        ["a", "b"],
        { mode: "template", template: zeroShare },
        members,
      ).rows[2],
    ).toMatchObject({
      includedInEqual: false,
      includedInAlternative: true,
      alternativeCents: 0,
    });
    const former = [
      ...members.slice(0, 2),
      { ...members[2], left_at: "2026-11-23" },
    ];
    const unavailable = compareSplits(
      1001,
      ["a", "b"],
      { mode: "template", template },
      former,
    );
    expect(unavailable.alternative.error).toContain("former roommate");
    expect(unavailable.preferred).toBeUndefined();
    expect(
      compareSplits(
        1001,
        ["a"],
        { mode: "template", template: undefined },
        members,
      ).preferred,
    ).toBeUndefined();
  });
});
