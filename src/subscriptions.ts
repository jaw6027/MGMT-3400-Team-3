/** Classroom billing only. Benefits are proposals, never feature entitlements. */
export const subscriptionPlans = [
  {
    id: "basic",
    name: "Basic",
    cents: 399,
    tagline: "Everyday sharing",
    benefits: [
      "Shared expenses, receipts and balances",
      "Household shopping and purchase history",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    cents: 549,
    tagline: "A more organized home",
    benefits: [
      "Everything proposed for Basic",
      "Chore schedules and grocery / restock rotations",
      "Recurring bill planning and reminders",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    cents: 699,
    tagline: "The complete household view",
    benefits: [
      "Everything proposed for Plus",
      "Itemized receipt splits and spending insights",
      "Percentage templates, split comparison and fairness views",
    ],
  },
] as const;
export type PlanId = (typeof subscriptionPlans)[number]["id"];
export const TRIAL_DAYS = 30;
export const subscriptionPolicy = {
  trial: "One 30-day free trial per household, starting on activation.",
  sharing:
    "One subscription covers all active household members, regardless of individual logins.",
  changes:
    "During the trial, plan changes apply immediately. Afterward, upgrades and downgrades apply at the next renewal, without proration.",
  cancellation:
    "Cancellation stops renewal at the end of the current trial or paid period. A past-due subscription cancels immediately. Expense history is preserved, and existing features remain available.",
  benefits:
    "Proposed tier benefits only. All existing features remain available on every tier, before activation and after cancellation. No feature restrictions are enabled.",
};
export type SubscriptionMember = {
  id?: string;
  joined_at?: string;
  user_id: string;
  left_at?: string | null;
};
/** Preserve existing UI member order; sort only when selecting a billing manager. */
export function firstSubscriptionMember(members: SubscriptionMember[]) {
  return [...members].sort((a, b) => {
    if (!a.joined_at || !b.joined_at) return 0;
    return (
      a.joined_at.localeCompare(b.joined_at) ||
      (a.id || a.user_id).localeCompare(b.id || b.user_id)
    );
  })[0];
}
export type SubscriptionCharge = {
  id: string;
  at: string;
  plan: PlanId;
  cents: number;
  status: "paid" | "failed";
};
export type HouseholdSubscription = {
  household_id: string;
  manager_id: string;
  version: number;
  plan: PlanId | null;
  pending_plan: PlanId | null;
  status: "not_started" | "trialing" | "active" | "past_due" | "canceled";
  trial_started_at: string | null;
  trial_ends_at: string | null;
  period_ends_at: string | null;
  cancel_at_period_end: boolean;
  fail_next: boolean;
  simulated_at: string | null;
  charges: SubscriptionCharge[];
};
export type SubscriptionCommand =
  | { type: "activate" | "change_plan"; plan: PlanId }
  | {
      type:
        | "cancel"
        | "resume"
        | "retry"
        | "toggle_failure"
        | "advance"
        | "claim_management";
    }
  | { type: "transfer"; user_id: string };
export function planFor(id: unknown) {
  const plan = subscriptionPlans.find((p) => p.id === id);
  if (!plan) throw new Error("Choose Basic, Plus or Premium.");
  return plan;
}
export const subscriptionMoney = (cents: number) =>
  `$${(cents / 100).toFixed(2)}`;
export function initialSubscription(
  household: string,
  manager: string,
): HouseholdSubscription {
  return {
    household_id: household,
    manager_id: manager,
    version: 0,
    plan: null,
    pending_plan: null,
    status: "not_started",
    trial_started_at: null,
    trial_ends_at: null,
    period_ends_at: null,
    cancel_at_period_end: false,
    fail_next: false,
    simulated_at: null,
    charges: [],
  };
}
export function nextBillingMonth(iso: string) {
  const date = new Date(iso),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}
export const subscriptionNow = (
  s: HouseholdSubscription,
  now = new Date().toISOString(),
) =>
  new Date(
    Math.max(Date.parse(now), s.simulated_at ? Date.parse(s.simulated_at) : 0),
  ).toISOString();
/** Deterministic lazy renewal; stable cycle IDs prevent double billing on refresh. */
export function settleSubscription(
  input: HouseholdSubscription,
  now = new Date().toISOString(),
): HouseholdSubscription {
  const s: HouseholdSubscription = JSON.parse(JSON.stringify(input));
  const at = subscriptionNow(s, now);
  // Each operation handles at most a century of monthly periods, never silently skips one.
  let count = 0;
  while (
    (s.status === "trialing" || s.status === "active") &&
    s.period_ends_at &&
    s.period_ends_at <= at
  ) {
    if (++count > 1200)
      throw new Error("Refresh the subscription clock with an administrator.");
    if (s.cancel_at_period_end) {
      s.status = "canceled";
      s.pending_plan = null;
      s.cancel_at_period_end = false;
      s.fail_next = false;
      break;
    }
    const due = s.period_ends_at;
    s.plan = s.pending_plan || s.plan;
    s.pending_plan = null;
    const plan = planFor(s.plan);
    const id = `cycle:${due}`;
    if (!s.charges.some((c) => c.id === id))
      s.charges.push({
        id,
        at: due,
        plan: plan.id,
        cents: plan.cents,
        status: s.fail_next ? "failed" : "paid",
      });
    if (s.fail_next) {
      s.status = "past_due";
      s.fail_next = false;
    } else {
      s.status = "active";
      s.period_ends_at = nextBillingMonth(due);
    }
  }
  return s;
}
export function applySubscription(
  input: HouseholdSubscription,
  members: SubscriptionMember[],
  user: string,
  command: SubscriptionCommand,
  expectedVersion: number,
  now = new Date().toISOString(),
): HouseholdSubscription {
  const active = members.filter((m) => !m.left_at);
  if (!active.some((m) => m.user_id === user))
    throw new Error("This household subscription is unavailable.");
  if (input.version !== expectedVersion)
    throw new Error("Subscription changed. Refresh and try again.");
  if (command.type === "claim_management") {
    if (
      active.some((m) => m.user_id === input.manager_id) ||
      firstSubscriptionMember(active)?.user_id !== user
    )
      throw new Error(
        "Only the first remaining roommate can recover billing management after the manager leaves.",
      );
  } else if (input.manager_id !== user)
    throw new Error(
      "Only the household billing manager can change this subscription.",
    );
  let s = settleSubscription(input, now);
  const at = subscriptionNow(s, now);
  switch (command.type) {
    case "activate": {
      const plan = planFor(command.plan);
      if (!["not_started", "canceled"].includes(s.status))
        throw new Error("This household already has a subscription.");
      s.plan = plan.id;
      s.pending_plan = null;
      s.cancel_at_period_end = false;
      s.fail_next = false;
      if (!s.trial_started_at) {
        s.trial_started_at = at;
        s.trial_ends_at = new Date(
          Date.parse(at) + TRIAL_DAYS * 86400000,
        ).toISOString();
        s.period_ends_at = s.trial_ends_at;
        s.status = "trialing";
      } else {
        s.status = "active";
        s.period_ends_at = nextBillingMonth(at);
        s.charges.push({
          id: `reactivate:${s.version + 1}`,
          at,
          plan: plan.id,
          cents: plan.cents,
          status: "paid",
        });
      }
      break;
    }
    case "change_plan":
      planFor(command.plan);
      if (!["trialing", "active"].includes(s.status) || s.cancel_at_period_end)
        throw new Error(
          "Resume or reactivate the subscription before changing plans.",
        );
      if (s.status === "trialing") {
        s.plan = command.plan;
        s.pending_plan = null;
      } else s.pending_plan = command.plan === s.plan ? null : command.plan;
      break;
    case "cancel":
      if (!["trialing", "active", "past_due"].includes(s.status))
        throw new Error("There is no renewing subscription to cancel.");
      if (s.status === "past_due") s.status = "canceled";
      else s.cancel_at_period_end = true;
      s.pending_plan = null;
      s.fail_next = false;
      break;
    case "resume":
      if (!s.cancel_at_period_end || !["trialing", "active"].includes(s.status))
        throw new Error("There is no scheduled cancellation to undo.");
      s.cancel_at_period_end = false;
      break;
    case "toggle_failure":
      if (!["trialing", "active"].includes(s.status) || s.cancel_at_period_end)
        throw new Error("Activate or resume a subscription first.");
      s.fail_next = !s.fail_next;
      break;
    case "advance":
      if (!["trialing", "active"].includes(s.status) || !s.period_ends_at)
        throw new Error("There is no upcoming billing date.");
      s.simulated_at = s.period_ends_at;
      s = settleSubscription(s, s.simulated_at);
      break;
    case "retry": {
      if (s.status !== "past_due")
        throw new Error("There is no failed payment to retry.");
      const charge = s.charges[s.charges.length - 1];
      if (!charge || charge.status !== "failed")
        throw new Error("Failed billing record unavailable.");
      charge.status = "paid";
      s.status = "active";
      s.period_ends_at = nextBillingMonth(at);
      break;
    }
    case "transfer":
      if (!active.some((m) => m.user_id === command.user_id))
        throw new Error("Choose an active household member.");
      s.manager_id = command.user_id;
      break;
    case "claim_management":
      s.manager_id = user;
      break;
    default:
      throw new Error("Unknown subscription action.");
  }
  s.version++;
  return s;
}
