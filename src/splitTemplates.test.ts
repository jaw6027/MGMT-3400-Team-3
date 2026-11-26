import { describe, expect, it } from "vitest";
import {
  deleteLocalSplitTemplate,
  inactiveTemplateMembers,
  saveLocalSplitTemplate,
  validateSplitTemplate,
  type SplitTemplate,
} from "./splitTemplates";

const members = [
  { id: "alex", user_id: "a", name: "Alex" },
  { id: "sam", user_id: "s", name: "Sam" },
];
const template: SplitTemplate = {
  id: "rent",
  household_id: "home",
  name: " Rent ",
  version: 0,
  allocations: [
    { member_id: "sam", percentage: " 35.25 " },
    { member_id: "alex", percentage: "64.75" },
  ],
};

describe("split templates", () => {
  it("normalizes a valid template, keeps entry order, and copies the allocations", () => {
    const saved = validateSplitTemplate(template, members);
    expect(saved.name).toBe("Rent");
    expect(saved.allocations.map(({ member_id }) => member_id)).toEqual([
      "sam",
      "alex",
    ]);
    expect(saved.allocations[0].percentage).toBe("35.25");
    saved.allocations[0].percentage = "40";
    expect(template.allocations[0].percentage).toBe(" 35.25 ");
  });

  it("checks names, unique active participants, and an exact 100 percent total", () => {
    const [sam, alex] = template.allocations;
    expect(() =>
      validateSplitTemplate({ ...template, name: " " }, members),
    ).toThrow("template name");
    expect(() =>
      validateSplitTemplate({ ...template, allocations: [sam, sam] }, members),
    ).toThrow("unique roommates");
    expect(() =>
      validateSplitTemplate(
        { ...template, allocations: [sam, { ...alex, percentage: "64.74" }] },
        members,
      ),
    ).toThrow("exactly 100%");
    const afterDeparture = [
      members[0],
      { ...members[1], left_at: "2026-11-23" },
    ];
    expect(
      inactiveTemplateMembers(template.allocations, afterDeparture),
    ).toEqual([sam]);
    expect(() => validateSplitTemplate(template, afterDeparture)).toThrow(
      "current roommates",
    );
    expect(inactiveTemplateMembers(template.allocations, [members[0]])).toEqual(
      [sam],
    );
  });

  it("versions local changes and rejects stale edits, stale deletions, and cross-household writes", () => {
    const [created] = saveLocalSplitTemplate([], template, members);
    const [updated] = saveLocalSplitTemplate(
      [created],
      { ...created, name: "Utilities" },
      members,
    );
    expect(updated).toMatchObject({ name: "Utilities", version: 2 });
    expect(() => saveLocalSplitTemplate([updated], created, members)).toThrow(
      "changed",
    );
    expect(() =>
      saveLocalSplitTemplate(
        [updated],
        { ...updated, household_id: "other" },
        members,
      ),
    ).toThrow("changed");
    expect(() => deleteLocalSplitTemplate([updated], created)).toThrow(
      "changed",
    );
    expect(() =>
      deleteLocalSplitTemplate([updated], {
        ...updated,
        household_id: "other",
      }),
    ).toThrow("changed");
    expect(deleteLocalSplitTemplate([updated], updated)).toEqual([]);
    expect(() => saveLocalSplitTemplate([], updated, members)).toThrow(
      "changed",
    );
  });
});
