import type { Member } from "./core";
import { percentageSplit } from "./percentageSplit";

export type SplitTemplate = {
  id: string;
  household_id: string;
  name: string;
  allocations: Parameters<typeof percentageSplit>[1];
  version: number;
};

export function inactiveTemplateMembers(
  allocations: SplitTemplate["allocations"],
  members: Member[],
) {
  const active = new Set(
    members.filter((member) => !member.left_at).map((member) => member.id),
  );
  return allocations.filter(({ member_id }) => !active.has(member_id));
}

export function validateSplitTemplate(
  template: SplitTemplate,
  members: Member[],
) {
  const name = template.name.trim();
  if (!name || name.length > 80)
    throw new Error("Enter a template name of 1 to 80 characters.");
  const allocations = template.allocations.map(({ member_id, percentage }) => ({
    member_id,
    percentage: percentage.trim(),
  }));
  if (
    new Set(allocations.map(({ member_id }) => member_id)).size !==
    allocations.length
  )
    throw new Error("Choose unique roommates for the template.");
  if (inactiveTemplateMembers(allocations, members).length)
    throw new Error("Choose current roommates for the template.");
  percentageSplit(0, allocations);
  return { ...template, name, allocations };
}

export function saveLocalSplitTemplate(
  templates: SplitTemplate[],
  template: SplitTemplate,
  members: Member[],
) {
  const normalized = validateSplitTemplate(template, members);
  const existing = templates.find(({ id }) => id === template.id);
  if (
    (existing?.version ?? 0) !== template.version ||
    (existing && existing.household_id !== template.household_id)
  )
    throw new Error("This template changed. Reopen it and try again.");
  return [
    { ...normalized, version: template.version + 1 },
    ...templates.filter(({ id }) => id !== template.id),
  ];
}

export function deleteLocalSplitTemplate(
  templates: SplitTemplate[],
  template: Pick<SplitTemplate, "id" | "household_id" | "version">,
) {
  const existing = templates.find(({ id }) => id === template.id);
  if (
    !existing ||
    existing.version !== template.version ||
    existing.household_id !== template.household_id
  )
    throw new Error("This template changed. Reopen it and try again.");
  return templates.filter(({ id }) => id !== template.id);
}
