import { describe, it, expect } from "vitest";
import {
  applySubscription,
  initialSubscription,
  nextBillingMonth,
  settleSubscription,
  subscriptionPlans,
  SubscriptionCommand,
  HouseholdSubscription,
} from "./subscriptions";
const now = "2026-01-01T12:00:00.000Z";
const members = [{ user_id: "alex" }, { user_id: "jordan" }];
const start = (plan: "basic" | "plus" | "premium" = "basic") =>
  applySubscription(
    initialSubscription("home", "alex"),
    members,
    "alex",
    { type: "activate", plan },
    0,
    now,
  );
const action = (
  s: HouseholdSubscription,
  c: SubscriptionCommand,
  at = now,
  user = "alex",
) => applySubscription(s, members, user, c, s.version, at);

describe("simulated household subscriptions", () => {
  it("configures exact monthly USD prices, a single 30-day household trial and no activation charge", () => {
    expect(subscriptionPlans.map((p) => p.cents)).toEqual([399, 549, 699]);
    for (const plan of subscriptionPlans) {
      const s = start(plan.id);
      expect(s.trial_ends_at).toBe("2026-01-31T12:00:00.000Z");
      expect(s.charges).toEqual([]);
      expect(s.manager_id).toBe("alex");
      expect(s.status).toBe("trialing");
    }
  });
  it("shares one plan, permits only the manager, rejects stale requests and duplicate activation", () => {
    const s = start();
    for (const command of [
      { type: "cancel" },
      { type: "change_plan", plan: "premium" },
      { type: "advance" },
      { type: "transfer", user_id: "jordan" },
    ] as SubscriptionCommand[]) {
      expect(() => action(s, command, now, "jordan")).toThrow(
        "billing manager",
      );
    }
    expect(() => action(s, { type: "cancel" }, now, "outsider")).toThrow(
      "unavailable",
    );
    expect(() =>
      applySubscription(s, members, "alex", { type: "cancel" }, 0, now),
    ).toThrow("changed");
    expect(() => action(s, { type: "activate", plan: "plus" })).toThrow(
      "already",
    );
    const transferred = action(s, { type: "transfer", user_id: "jordan" });
    expect(() => action(transferred, { type: "cancel" })).toThrow(
      "billing manager",
    );
    expect(
      action(transferred, { type: "cancel" }, now, "jordan")
        .cancel_at_period_end,
    ).toBe(true);
  });
  it("bills once at trial expiration, clamps calendar months and reconciles missed renewals", () => {
    const s = action(start(), { type: "advance" });
    expect(s.status).toBe("active");
    expect(s.charges).toHaveLength(1);
    expect(s.charges[0].cents).toBe(399);
    expect(s.period_ends_at).toBe("2026-02-28T12:00:00.000Z");
    expect(settleSubscription(s, s.simulated_at!)).toEqual(s);
    const later = settleSubscription(s, "2026-04-01T12:00:00.000Z");
    expect(later.charges).toHaveLength(3);
    expect(new Set(later.charges.map((c) => c.id)).size).toBe(3);
    expect(nextBillingMonth("2028-01-31T12:00:00.000Z")).toBe(
      "2028-02-29T12:00:00.000Z",
    );
  });
  it("changes trial plans immediately but queues upgrades and downgrades after trial", () => {
    let s = start();
    const expiry = s.trial_ends_at;
    s = action(s, { type: "change_plan", plan: "plus" });
    expect(s.plan).toBe("plus");
    expect(s.trial_ends_at).toBe(expiry);
    s = action(s, { type: "advance" });
    const due = s.period_ends_at;
    s = action(s, { type: "change_plan", plan: "premium" });
    expect(s.plan).toBe("plus");
    expect(s.pending_plan).toBe("premium");
    expect(s.period_ends_at).toBe(due);
    expect(s.charges).toHaveLength(1);
    s = action(s, { type: "advance" });
    expect(s.plan).toBe("premium");
    expect(s.charges[1].cents).toBe(699);
    s = action(s, { type: "change_plan", plan: "basic" });
    s = action(s, { type: "advance" });
    expect(s.plan).toBe("basic");
    expect(s.charges[2].cents).toBe(399);
    s = action(s, { type: "change_plan", plan: "premium" });
    expect(
      action(s, { type: "change_plan", plan: "basic" }).pending_plan,
    ).toBeNull();
  });
  it("recovers failed simulated billing without duplicate charges or restarting the trial", () => {
    let s = action(start("premium"), { type: "toggle_failure" });
    s = action(s, { type: "advance" });
    expect(s.status).toBe("past_due");
    expect(s.charges[0].status).toBe("failed");
    expect(
      settleSubscription(s, "2027-01-01T00:00:00.000Z").charges,
    ).toHaveLength(1);
    s = action(s, { type: "retry" });
    expect(s.status).toBe("active");
    expect(s.charges).toHaveLength(1);
    expect(s.charges[0].status).toBe("paid");
    expect(() => action(s, { type: "retry" })).toThrow("no failed");
    expect(s.trial_started_at).toBe(now);
  });
  it("cancels without a renewal charge, supports resume and never reissues a trial", () => {
    let s = action(start(), { type: "cancel" });
    expect(s.status).toBe("trialing");
    expect(action(s, { type: "resume" }).cancel_at_period_end).toBe(false);
    s = action(s, { type: "advance" });
    expect(s.status).toBe("canceled");
    expect(s.charges).toHaveLength(0);
    s = action(s, { type: "activate", plan: "plus" });
    expect(s.status).toBe("active");
    expect(s.trial_started_at).toBe(now);
    expect(s.charges).toHaveLength(1);
    expect(s.charges[0].cents).toBe(549);
    s = action(s, { type: "toggle_failure" });
    s = action(s, { type: "advance" });
    expect(action(s, { type: "cancel" }).status).toBe("canceled");
  });
  it("only lets the first remaining roommate recover an inactive manager's role", () => {
    const s = start(),
      roster = [
        { user_id: "alex", left_at: now },
        { user_id: "jordan" },
        { user_id: "sam" },
      ];
    expect(() =>
      applySubscription(
        s,
        roster,
        "sam",
        { type: "claim_management" },
        s.version,
        now,
      ),
    ).toThrow("first remaining");
    expect(
      applySubscription(
        s,
        roster,
        "jordan",
        { type: "claim_management" },
        s.version,
        now,
      ).manager_id,
    ).toBe("jordan");
    expect(() =>
      action(s, { type: "claim_management" }, now, "jordan"),
    ).toThrow("first remaining");
  });
});
