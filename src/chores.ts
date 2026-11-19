import type { Chore, ChoreCompletion, Member } from "./core";
import { today, validDate } from "./core";
import { choreCatalog } from "./choreCatalog";
export { choreCatalog };
export const choreFrequencies = [
  "Daily",
  "Weekly",
  "Biweekly",
  "Monthly",
] as const;
export function canonicalChoreName(name: string, catalogId: string | null) {
  if (catalogId) {
    const entry = choreCatalog.find((c) => c.id === catalogId);
    if (!entry) throw new Error("Choose a listed chore or add a custom chore.");
    return entry.name;
  }
  const value = name.trim().replace(/\s+/g, " ");
  if (!value || value.length > 120)
    throw new Error("Enter a chore name, up to 120 characters.");
  return value;
}
export function nextChoreDue(
  completedOn: string,
  frequency: Chore["frequency"],
) {
  if (!validDate(completedOn))
    throw new Error("Use a valid completion date in YYYY-MM-DD format.");
  if (!choreFrequencies.includes(frequency))
    throw new Error("Choose Daily, Weekly, Biweekly, or Monthly.");
  const d = new Date(completedOn + "T12:00:00Z");
  if (frequency === "Monthly") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else
    d.setUTCDate(
      d.getUTCDate() + { Daily: 1, Weekly: 7, Biweekly: 14 }[frequency],
    );
  return d.toISOString().slice(0, 10);
}
export function validateChore(chore: Chore, members: Member[]) {
  canonicalChoreName(chore.name, chore.catalog_id);
  if (!choreFrequencies.includes(chore.frequency))
    throw new Error("Choose Daily, Weekly, Biweekly, or Monthly.");
  if (!["fixed", "rotate"].includes(chore.assignment_mode))
    throw new Error("Choose a fixed member or a rotating assignment.");
  if (
    !Array.isArray(chore.member_ids) ||
    !chore.member_ids.length ||
    new Set(chore.member_ids).size !== chore.member_ids.length ||
    chore.member_ids.some(
      (id) => !members.some((m) => m.id === id && !m.left_at),
    )
  )
    throw new Error("Choose current household members for this chore.");
  if (chore.assignment_mode === "fixed" && chore.member_ids.length !== 1)
    throw new Error("Choose one fixed member.");
  if (chore.assignment_mode === "rotate" && chore.member_ids.length < 2)
    throw new Error("Choose at least two roommates to take turns.");
  if (!chore.member_ids.includes(chore.assigned_to))
    throw new Error("Choose whose turn comes first.");
  if (!validDate(chore.next_due_date))
    throw new Error("Use a valid due date in YYYY-MM-DD format.");
  if (!Number.isInteger(chore.version) || chore.version < 0)
    throw new Error("Refresh this chore and try again.");
}
export const activeChoreRoster = (chore: Chore, members: Member[]) =>
  chore.member_ids.filter((id) =>
    members.some((m) => m.id === id && !m.left_at),
  );
export function choreAssignee(chore: Chore, members: Member[]) {
  const active = activeChoreRoster(chore, members);
  return active.includes(chore.assigned_to)
    ? chore.assigned_to
    : active[0] || null;
}
export function lastChoreCompletion(
  choreId: string,
  history: ChoreCompletion[],
) {
  return (
    history
      .filter((c) => c.chore_id === choreId && !c.voided_at)
      .sort(
        (a, b) =>
          b.completed_on.localeCompare(a.completed_on) ||
          b.created_at.localeCompare(a.created_at) ||
          b.id.localeCompare(a.id),
      )[0] || null
  );
}
export function choreCompletionPreview(
  chore: Chore,
  completedOn: string,
  completedBy: string,
  members: Member[],
  history: ChoreCompletion[],
) {
  const assigned = choreAssignee(chore, members);
  if (!assigned)
    throw new Error(
      "Reassign this chore to a current roommate before logging a completion.",
    );
  const last = lastChoreCompletion(chore.id, history),
    advances = !last || completedOn > last.completed_on;
  const active = activeChoreRoster(chore, members);
  let next = assigned;
  if (chore.assignment_mode === "rotate") {
    const previous = active.includes(completedBy) ? completedBy : assigned;
    next = active[(active.indexOf(previous) + 1) % active.length];
  }
  return {
    advances,
    scheduledMember: assigned,
    next_due_date: advances
      ? nextChoreDue(completedOn, chore.frequency)
      : chore.next_due_date,
    assigned_to: advances ? next : chore.assigned_to,
  };
}
export function makeChoreCompletion(
  chore: Chore,
  history: ChoreCompletion[],
  members: Member[],
  userId: string,
  id: string,
  completedOn: string,
  expectedVersion: number,
  timezone = "UTC",
  localToday = today(),
) {
  const actor = members.find((m) => m.user_id === userId && !m.left_at);
  if (!actor) throw new Error("Join this household before logging a chore.");
  const old = history.find((c) => c.id === id);
  if (old) {
    if (
      old.chore_id === chore.id &&
      old.recorded_by === userId &&
      old.completed_on === completedOn
    )
      return { chore, completion: old, replayed: true };
    throw new Error("This completion reference is already in use.");
  }
  if (chore.version !== expectedVersion)
    throw new Error("This chore changed. Close and reopen it before saving.");
  if (chore.archived)
    throw new Error("Restore this chore before logging a completion.");
  if (!validDate(completedOn) || completedOn > localToday)
    throw new Error("Choose a valid completion date on or before today.");
  if (
    history.some(
      (c) =>
        c.chore_id === chore.id &&
        c.completed_on === completedOn &&
        !c.voided_at,
    )
  )
    throw new Error(
      "This chore already has a completion recorded for that day.",
    );
  const next = choreCompletionPreview(
      chore,
      completedOn,
      actor.id,
      members,
      history,
    ),
    now = new Date().toISOString();
  const completion: ChoreCompletion = {
    id,
    household_id: chore.household_id,
    chore_id: chore.id,
    chore_name: chore.name,
    completed_by: actor.id,
    recorded_by: userId,
    completed_on: completedOn,
    scheduled_for: chore.next_due_date,
    scheduled_member_id: next.scheduledMember,
    frequency: chore.frequency,
    assignment_mode: chore.assignment_mode,
    before_due_date: chore.next_due_date,
    before_assigned_to: chore.assigned_to,
    advanced_schedule: next.advances,
    after_version: chore.version + 1,
    timezone,
    created_at: now,
    voided_at: null,
    voided_by: null,
  };
  return {
    chore: {
      ...chore,
      assigned_to: next.assigned_to,
      next_due_date: next.next_due_date,
      version: chore.version + 1,
      updated_at: now,
    },
    completion,
    replayed: false,
  };
}
export function undoChoreCompletion(
  chore: Chore,
  completion: ChoreCompletion,
  userId: string,
) {
  if (completion.recorded_by !== userId)
    throw new Error("You can only undo your own completion.");
  if (completion.voided_at) return { chore, completion };
  if (chore.version !== completion.after_version)
    throw new Error(
      "This chore changed after that completion. Its schedule cannot be rolled back.",
    );
  const now = new Date().toISOString();
  return {
    chore: {
      ...chore,
      next_due_date: completion.before_due_date,
      assigned_to: completion.before_assigned_to,
      version: chore.version + 1,
      updated_at: now,
    },
    completion: { ...completion, voided_at: now, voided_by: userId },
  };
}
export const choreTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
