import { equalSplit, validateShareTotal, type Share } from "./core";
import type { SplitTemplate } from "./splitTemplates";

export const unevenShareThreshold = 10;

export function analyzeSplitFairness(
  cents: number,
  selected: string[],
  shares: Share[],
  percentages: SplitTemplate["allocations"] | null,
  mode: "equal" | "custom" | "percentage",
  calculationError = "",
) {
  try {
    if (cents <= 0) throw new Error("Enter a valid purchase total.");
    if (!selected.length) throw new Error("Select at least one roommate.");
    if (calculationError) throw new Error(calculationError);
    const baseline = equalSplit(cents, selected);
    const assigned = new Map(
      shares.map((share) => [share.member_id, share.cents]),
    );
    if (
      shares.length !== selected.length ||
      assigned.size !== selected.length ||
      selected.some((id) => !assigned.has(id)) ||
      shares.some(
        (share) => !Number.isSafeInteger(share.cents) || share.cents < 0,
      )
    ) {
      throw new Error("Check each roommate’s share.");
    }
    validateShareTotal(cents, shares);

    const entered = new Map(
      percentages?.map((entry) => [entry.member_id, Number(entry.percentage)]),
    );
    const equalPercentage = 100 / selected.length;
    const averageCents = cents / selected.length;
    const onlyRounding =
      mode === "custom" &&
      shares.every(
        (share) =>
          share.cents >= Math.floor(averageCents) &&
          share.cents <= Math.ceil(averageCents),
      );
    const rows = baseline.map(({ member_id, cents: equalCents }) => {
      const amount = assigned.get(member_id)!;
      const percentage =
        entered.get(member_id) ??
        (mode === "equal" ? equalPercentage : (amount / cents) * 100);
      const deviation = percentage - equalPercentage;
      const difference = amount - equalCents;
      const comparison = onlyRounding
        ? null
        : deviation >= unevenShareThreshold - 1e-9
          ? ("high" as const)
          : deviation <= -unevenShareThreshold + 1e-9
            ? ("low" as const)
            : null;
      return { member_id, amount, percentage, difference, comparison };
    });
    return { error: null, rows };
  } catch (error) {
    return { error: (error as Error).message, rows: [] };
  }
}
