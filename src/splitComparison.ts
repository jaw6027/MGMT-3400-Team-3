import {
  customDollarShares,
  equalSplit,
  validateShareTotal,
  type Member,
  type Share,
} from "./core";
import { percentageSplit } from "./percentageSplit";
import { inactiveTemplateMembers, type SplitTemplate } from "./splitTemplates";

export type PurchaseSplit =
  | { mode: "equal" }
  | { mode: "custom"; amounts: Record<string, string> }
  | { mode: "percentage"; allocations: SplitTemplate["allocations"] };

export type ComparisonOption =
  | Exclude<PurchaseSplit, { mode: "equal" }>
  | { mode: "template"; template: SplitTemplate | undefined };

type Result =
  { shares: Share[]; error: null } | { shares: null; error: string };

function calculate(getShares: () => Share[]): Result {
  try {
    return { shares: getShares(), error: null };
  } catch (error) {
    return { shares: null, error: (error as Error).message };
  }
}

export function compareSplits(
  cents: number,
  selected: string[],
  option: ComparisonOption,
  members: Member[],
) {
  const equal = calculate(() => equalSplit(cents, selected));
  let preferred: Exclude<PurchaseSplit, { mode: "equal" }> | undefined;
  const alternative = calculate(() => {
    if (option.mode === "template") {
      const { template } = option;
      if (!template) throw new Error("Choose a saved split template.");
      if (inactiveTemplateMembers(template.allocations, members).length)
        throw new Error(
          "This template includes a former roommate. Edit it in Split templates.",
        );
      preferred = { mode: "percentage", allocations: template.allocations };
    } else {
      if (!selected.length) throw new Error("Select at least one roommate.");
      preferred = option;
    }
    if (cents <= 0) throw new Error("Enter a valid purchase total.");
    if (preferred.mode === "percentage")
      return percentageSplit(cents, preferred.allocations);
    const shares = customDollarShares(selected, preferred.amounts);
    validateShareTotal(cents, shares);
    return shares;
  });
  const equalMembers = new Set(selected);
  const alternativeMembers =
    option.mode === "template"
      ? new Set(option.template?.allocations.map((entry) => entry.member_id))
      : equalMembers;
  const memberIds = new Set([...equalMembers, ...alternativeMembers]);
  const equalAmounts = new Map(
    equal.shares?.map(({ member_id, cents }) => [member_id, cents]),
  );
  const alternativeAmounts = new Map(
    alternative.shares?.map(({ member_id, cents }) => [member_id, cents]),
  );
  const rows = Array.from(memberIds, (memberId) => {
    const equalCents = equal.shares ? (equalAmounts.get(memberId) ?? 0) : null;
    const alternativeCents = alternative.shares
      ? (alternativeAmounts.get(memberId) ?? 0)
      : null;
    return {
      memberId,
      includedInEqual: equalMembers.has(memberId),
      includedInAlternative: alternativeMembers.has(memberId),
      equalCents,
      alternativeCents,
      difference:
        equalCents === null || alternativeCents === null
          ? null
          : alternativeCents - equalCents,
    };
  });
  return {
    equal,
    alternative,
    rows,
    preferred: alternative.error ? undefined : preferred,
  };
}
