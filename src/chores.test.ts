import { expect, it } from "vitest";
import type { Chore, Member } from "./core";
import {
  choreCatalog,
  nextChoreDue,
  validateChore,
  makeChoreCompletion,
  undoChoreCompletion,
  choreAssignee,
} from "./chores";
const members: Member[] = [
  { id: "a", user_id: "ua", name: "Alex" },
  { id: "b", user_id: "ub", name: "Jordan" },
  { id: "c", user_id: "uc", name: "Sam" },
];
const chore = (extra: Partial<Chore> = {}): Chore => ({
  id: "chore",
  household_id: "house",
  catalog_id: null,
  name: "Water plants",
  frequency: "Weekly",
  assignment_mode: "rotate",
  member_ids: ["a", "b", "c"],
  assigned_to: "a",
  next_due_date: "2026-01-01",
  archived: false,
  version: 1,
  created_at: "2026-01-01",
  ...extra,
});
const log = (
  item = chore(),
  history: any[] = [],
  date = "2026-01-01",
  user = "ua",
  id = "entry",
) =>
  makeChoreCompletion(
    item,
    history,
    members,
    user,
    id,
    date,
    item.version,
    "UTC",
    "2026-12-31",
  );
it("imports all 19 spreadsheet chores and preserves the original spelling as provenance", () => {
  expect(choreCatalog).toHaveLength(19);
  expect(new Set(choreCatalog.map((c) => c.id)).size).toBe(19);
  expect(
    choreCatalog.find((c) => c.id === "clean-out-refrigerator"),
  ).toMatchObject({
    name: "Clean out Refrigerator",
    source_name: "Clean out Refridgerator",
  });
});
it.each([
  ["2026-03-07", "Daily", "2026-03-08"],
  ["2026-12-28", "Weekly", "2027-01-04"],
  ["2026-12-28", "Biweekly", "2027-01-11"],
  ["2026-01-31", "Monthly", "2026-02-28"],
  ["2028-01-31", "Monthly", "2028-02-29"],
  ["2026-12-31", "Monthly", "2027-01-31"],
] as const)("calculates %s %s as %s", (day, freq, next) =>
  expect(nextChoreDue(day, freq)).toBe(next),
);
it("keeps fixed ownership even when a roommate helps", () => {
  const r = log(
    chore({ assignment_mode: "fixed", member_ids: ["b"], assigned_to: "b" }),
  );
  expect(r.chore.assigned_to).toBe("b");
  expect(r.completion.completed_by).toBe("a");
  expect(r.chore.next_due_date).toBe("2026-01-08");
});
it("rotates after the actual completer and skips departed roommates", () => {
  const departed = members.map((m) =>
    m.id === "b" ? { ...m, left_at: "2026-01-01" } : m,
  );
  const r = makeChoreCompletion(
    chore(),
    [],
    departed,
    "ua",
    "x",
    "2026-01-01",
    1,
    "UTC",
    "2026-12-31",
  );
  expect(r.chore.assigned_to).toBe("c");
  expect(choreAssignee(chore({ assigned_to: "b" }), departed)).toBe("a");
});
it("backfills history without changing the current turn or due date", () => {
  const first = log(chore(), [], "2026-01-10");
  const older = log(
    first.chore,
    [first.completion],
    "2026-01-02",
    "ub",
    "older",
  );
  expect(older.chore.assigned_to).toBe("b");
  expect(older.chore.next_due_date).toBe("2026-01-17");
  expect(older.completion.advanced_schedule).toBe(false);
});
it("rejects duplicate days, future/invalid dates, outsiders, archived chores, and stale saves", () => {
  const first = log();
  expect(() =>
    log(first.chore, [first.completion], "2026-01-01", "ub", "another"),
  ).toThrow(/already/);
  expect(() => log(chore(), [], "2027-01-01")).toThrow(/today/);
  expect(() => log(chore(), [], "2026-02-30")).toThrow(/valid/);
  expect(() => log(chore(), [], "2026-01-01", "outsider")).toThrow(/Join/);
  expect(() => log(chore({ archived: true }))).toThrow(/Restore/);
  expect(() =>
    makeChoreCompletion(chore(), [], members, "ua", "x", "2026-01-01", 0),
  ).toThrow(/changed/);
});
it("retries idempotently and allows only the author to undo an unchanged chore", () => {
  const r = log();
  expect(log(r.chore, [r.completion]).replayed).toBe(true);
  expect(() => undoChoreCompletion(r.chore, r.completion, "ub")).toThrow(/own/);
  expect(() =>
    undoChoreCompletion({ ...r.chore, version: 3 }, r.completion, "ua"),
  ).toThrow(/changed/);
  const undone = undoChoreCompletion(r.chore, r.completion, "ua");
  expect(undone.chore.assigned_to).toBe("a");
  expect(undone.chore.next_due_date).toBe("2026-01-01");
  expect(undone.completion.voided_at).toBeTruthy();
  expect(
    log(undone.chore, [undone.completion], "2026-01-01", "ua", "new").replayed,
  ).toBe(false);
});
it("requires valid frequency, real member choices, names and rotation rosters", () => {
  for (const extra of [
    { name: " " },
    { frequency: "Yearly" },
    { member_ids: ["a", "a"] },
    { member_ids: ["foreign"] },
    { member_ids: ["a"] },
    { assigned_to: "foreign" },
  ])
    expect(() => validateChore(chore(extra as any), members)).toThrow();
  validateChore(chore(), members);
});
