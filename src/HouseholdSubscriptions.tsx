import React, { useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useStore } from "./store";
import { Button, C, Chip, Icon, s, Title, Txt } from "./ui";
import {
  firstSubscriptionMember,
  PlanId,
  planFor,
  subscriptionMoney,
  subscriptionNow,
  subscriptionPlans,
  subscriptionPolicy,
  SubscriptionCommand,
} from "./subscriptions";

const dateLabel = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(iso)) + " UTC"
    : "—";
const statuses = {
  not_started: "Not activated",
  trialing: "30-day free trial",
  active: "Active",
  past_due: "Payment needs attention",
  canceled: "Canceled",
};

export function HouseholdSubscriptions() {
  const st = useStore();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PlanId>(
    st.subscription?.pending_plan || st.subscription?.plan || "plus",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cancel, setCancel] = useState(false);
  const [transfer, setTransfer] = useState<string | null>(null);
  const lock = useRef(false);
  const sub = st.subscription;
  const manager = st.members.find((m) => m.user_id === sub?.manager_id);
  const isManager = sub?.manager_id === st.user?.id;
  const activeMembers = st.members.filter((m) => !m.left_at);
  const canClaim =
    sub &&
    !activeMembers.some((m) => m.user_id === sub.manager_id) &&
    firstSubscriptionMember(activeMembers)?.user_id === st.user?.id;
  const starting = !sub || ["not_started", "canceled"].includes(sub.status);
  const plan = planFor(selected);
  const run = async (command: SubscriptionCommand, success: string) => {
    if (lock.current || !sub) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await st.subscriptionAction(command, sub.version);
      setMessage(success);
      setCancel(false);
      setTransfer(null);
    } catch (e: any) {
      setError(
        e.message || "Subscription action failed. Refresh and try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={[s.card, { gap: 20 }]}>
      <View style={[s.row, { gap: 14, alignItems: "flex-start" }]}>
        <View
          style={{ padding: 13, borderRadius: 12, backgroundColor: C.sage }}
        >
          <Icon name="Home" color={C.green} size={26} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Txt style={[s.label, { color: C.green }]}>
            HOUSEHOLD SUBSCRIPTION
          </Txt>
          <Title style={{ fontSize: 30 }}>One home. One plan.</Title>
          <Txt style={s.muted}>
            One subscription. Every active roommate included.
          </Txt>
        </View>
      </View>
      <View
        style={{
          backgroundColor: C.sage,
          padding: 15,
          borderRadius: 12,
          gap: 7,
        }}
      >
        <Txt style={{ fontFamily: "DMBold", color: C.dark }}>
          SIMULATED BILLING · No real charges
        </Txt>
        <Txt>
          Classroom demo only. No payment details or real charges. Prices are
          USD per household per month.
        </Txt>
      </View>
      <Txt
        accessibilityLabel="Household subscription status"
        style={{ fontFamily: "DMBold" }}
      >
        {sub ? statuses[sub.status] : "Subscription unavailable"}
        {sub?.plan ? ` · ${planFor(sub.plan).name}` : ""} ·{" "}
        {activeMembers.length} active roommates covered
      </Txt>
      {!st.subscriptionsAvailable && (
        <Txt style={{ color: C.red }}>
          Subscription setup is unavailable on this backend. Apply the household
          subscriptions migration and refresh. Existing household features
          remain available.
        </Txt>
      )}
      <Button
        secondary
        icon={open ? "ChevronDown" : "ArrowUpRight"}
        label={
          open
            ? "Hide subscription details"
            : "Compare plans and manage subscription"
        }
        onPress={() => {
          setOpen(!open);
          setError("");
          if (!open) void st.refresh().catch((e) => setError(e.message));
        }}
      />
      {open && sub && (
        <>
          <View style={{ gap: 9 }}>
            <Title style={{ fontSize: 25 }}>Choose your household plan</Title>
            <Txt>Try any plan free for 30 days. One trial per household.</Txt>
            <Txt style={s.muted}>
              Proposed tier benefits only. No feature restrictions are enabled.
            </Txt>
          </View>
          <View
            style={{ flexDirection: width >= 1000 ? "row" : "column", gap: 14 }}
          >
            {subscriptionPlans.map((p) => (
              <View
                key={p.id}
                style={{
                  flex: 1,
                  minWidth: 0,
                  gap: 13,
                  padding: 20,
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor: selected === p.id ? C.green : C.line,
                  backgroundColor: selected === p.id ? C.sage : C.white,
                }}
              >
                <Txt style={{ fontFamily: "DMBold", color: C.green }}>
                  {p.tagline}
                </Txt>
                <Title style={{ fontSize: 27 }}>{p.name}</Title>
                <View>
                  <Title style={{ fontSize: 34 }}>
                    {subscriptionMoney(p.cents)}
                  </Title>
                  <Txt style={s.muted}>USD / household / month</Txt>
                </View>
                {p.benefits.map((b) => (
                  <View key={b} style={{ flexDirection: "row", gap: 8 }}>
                    <Icon name="Check" size={17} color={C.green} />
                    <Txt style={{ flex: 1 }}>{b}</Txt>
                  </View>
                ))}
                <Button
                  secondary={selected !== p.id}
                  label={
                    selected === p.id
                      ? `${p.name} selected`
                      : `Select ${p.name}`
                  }
                  disabled={busy || !isManager}
                  onPress={() => {
                    setSelected(p.id);
                    setMessage("");
                  }}
                />
              </View>
            ))}
          </View>
          <Txt style={s.muted}>
            Suggested packaging of existing tools. All existing features stay
            available on every tier, before activation and after cancellation.
          </Txt>
          <View
            style={{
              gap: 10,
              borderTopWidth: 1,
              borderColor: C.line,
              paddingTop: 18,
            }}
          >
            <Title style={{ fontSize: 25 }}>Your subscription</Title>
            <Txt>
              Billing manager: {manager?.name || "Former roommate"}
              {isManager ? " (you)" : ""}
            </Txt>
            <Txt>
              Trial eligibility:{" "}
              {sub.trial_started_at
                ? "Household trial already used"
                : "Eligible for one 30-day free trial"}
            </Txt>
            {sub.trial_started_at && (
              <>
                <Txt>Trial started: {dateLabel(sub.trial_started_at)}</Txt>
                <Txt>Trial expires: {dateLabel(sub.trial_ends_at)}</Txt>
              </>
            )}
            {sub.period_ends_at && (
              <Txt>
                {sub.status === "canceled"
                  ? "Last period ended"
                  : sub.cancel_at_period_end
                    ? "Cancellation takes effect"
                    : sub.status === "past_due"
                      ? "Payment was due"
                      : "Next renewal"}
                : {dateLabel(sub.period_ends_at)}
              </Txt>
            )}
            {sub.pending_plan && (
              <Txt style={{ color: C.green }}>
                Scheduled plan: {planFor(sub.pending_plan).name} at{" "}
                {subscriptionMoney(planFor(sub.pending_plan).cents)} / month
                from the next renewal.
              </Txt>
            )}
            {sub.cancel_at_period_end && (
              <Txt style={{ color: C.red }}>
                Renewal is stopped. No charge will occur at the end of this
                period.
              </Txt>
            )}
            <Button
              secondary
              small
              label="Refresh subscription status"
              disabled={busy}
              onPress={() => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                setError("");
                void st
                  .refresh()
                  .catch((e) => setError(e.message))
                  .finally(() => {
                    lock.current = false;
                    setBusy(false);
                  });
              }}
            />
            <Txt style={s.muted}>{subscriptionPolicy.changes}</Txt>
            <Txt style={s.muted}>{subscriptionPolicy.cancellation}</Txt>
            {!isManager && (
              <Txt>
                Only the household billing manager can activate, change, cancel,
                or run billing simulations. All active roommates share the same
                plan and dates.
              </Txt>
            )}
            {isManager && (
              <>
                {starting ? (
                  <View
                    style={{
                      gap: 12,
                      padding: 17,
                      backgroundColor: C.sage,
                      borderRadius: 12,
                    }}
                  >
                    <Txt style={{ fontFamily: "DMBold" }}>
                      {plan.name}:{" "}
                      {sub.trial_started_at
                        ? `${subscriptionMoney(plan.cents)} simulated charge on reactivation, then monthly.`
                        : `$0 for 30 days, then ${subscriptionMoney(plan.cents)} monthly.`}
                    </Txt>
                    <Txt>
                      By activating, you start simulated recurring billing for
                      this household. Cancel before the displayed trial
                      expiration to avoid even a simulated first charge. No real
                      money moves.
                    </Txt>
                    <Button
                      label={
                        sub.trial_started_at
                          ? `Reactivate ${plan.name}`
                          : `Start 30-day trial with ${plan.name}`
                      }
                      loading={busy}
                      onPress={() =>
                        void run(
                          { type: "activate", plan: selected },
                          "Household subscription activated. All active roommates are covered.",
                        )
                      }
                    />
                  </View>
                ) : (
                  <>
                    {sub.cancel_at_period_end ? (
                      <Button
                        secondary
                        label="Keep subscription renewing"
                        disabled={busy}
                        onPress={() =>
                          void run(
                            { type: "resume" },
                            "Scheduled cancellation removed.",
                          )
                        }
                      />
                    ) : (
                      sub.status !== "past_due" && (
                        <Button
                          label={
                            sub.status === "trialing"
                              ? `Use ${plan.name} after trial`
                              : `Schedule ${plan.name} at renewal`
                          }
                          disabled={
                            busy || selected === (sub.pending_plan || sub.plan)
                          }
                          onPress={() =>
                            void run(
                              { type: "change_plan", plan: selected },
                              sub.status === "trialing"
                                ? "Trial plan updated. Trial dates are unchanged."
                                : "Plan change scheduled for the next renewal.",
                            )
                          }
                        />
                      )
                    )}
                    {sub.status === "past_due" && (
                      <View style={{ gap: 10 }}>
                        <Txt style={{ color: C.red }}>
                          The simulated payment failed. No roommate debt was
                          created. Retry to mark the same billing record paid,
                          or cancel.
                        </Txt>
                        <Button
                          label="Retry simulated payment"
                          loading={busy}
                          onPress={() =>
                            void run(
                              { type: "retry" },
                              "Simulated payment recovered. No real payment was processed.",
                            )
                          }
                        />
                      </View>
                    )}
                    {!sub.cancel_at_period_end && (
                      <Button
                        danger
                        label="Cancel subscription"
                        disabled={busy}
                        onPress={() => setCancel(true)}
                      />
                    )}
                    {cancel && (
                      <View
                        style={{
                          gap: 12,
                          padding: 16,
                          backgroundColor: "#FBEFEC",
                          borderRadius: 12,
                        }}
                      >
                        <Txt>{subscriptionPolicy.cancellation}</Txt>
                        <Button
                          danger
                          label="Confirm subscription cancellation"
                          loading={busy}
                          onPress={() =>
                            void run(
                              { type: "cancel" },
                              "Subscription cancellation saved. Household expense history is preserved.",
                            )
                          }
                        />
                        <Button
                          secondary
                          label="Go back without canceling"
                          disabled={busy}
                          onPress={() => setCancel(false)}
                        />
                      </View>
                    )}
                  </>
                )}
              </>
            )}
            {canClaim && (
              <Button
                secondary
                label="Recover billing management"
                disabled={busy}
                onPress={() =>
                  void run(
                    { type: "claim_management" },
                    "You are now the household billing manager.",
                  )
                }
              />
            )}
          </View>
          {isManager && (
            <View
              style={{
                gap: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderColor: C.line,
              }}
            >
              <Title style={{ fontSize: 23 }}>
                Classroom billing simulator
              </Title>
              <Txt>
                Subscription clock: {dateLabel(subscriptionNow(sub))}. Advancing
                this clock affects only household subscription billing, never
                purchases, chores, or roommate payments. Renewal is reconciled
                when opened or refreshed; no background billing runs.
              </Txt>
              {["trialing", "active"].includes(sub.status) && (
                <>
                  {!sub.cancel_at_period_end && (
                    <Button
                      secondary
                      label={
                        sub.fail_next
                          ? "Clear next-payment failure"
                          : "Simulate failure on next payment"
                      }
                      disabled={busy}
                      onPress={() =>
                        void run(
                          { type: "toggle_failure" },
                          sub.fail_next
                            ? "Next simulated payment will succeed."
                            : "Next simulated payment will fail.",
                        )
                      }
                    />
                  )}
                  <Button
                    secondary
                    label={
                      sub.status === "trialing"
                        ? "Advance to trial expiration"
                        : "Advance to next renewal"
                    }
                    loading={busy}
                    onPress={() =>
                      void run(
                        { type: "advance" },
                        "Subscription clock advanced. Review the status and billing history.",
                      )
                    }
                  />
                </>
              )}
              <Title style={{ fontSize: 22 }}>
                Transfer billing management
              </Title>
              <Txt style={s.muted}>
                Choose another active roommate. Only the new manager will be
                able to make changes.
              </Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {activeMembers
                  .filter((m) => m.user_id !== st.user?.id)
                  .map((m) => (
                    <Chip
                      key={m.id}
                      label={`Assign ${m.name}`}
                      active={transfer === m.user_id}
                      onPress={() => !busy && setTransfer(m.user_id)}
                    />
                  ))}
              </View>
              {transfer && (
                <Button
                  secondary
                  label="Confirm billing manager transfer"
                  loading={busy}
                  onPress={() =>
                    void run(
                      { type: "transfer", user_id: transfer },
                      "Billing management transferred.",
                    )
                  }
                />
              )}
            </View>
          )}
          <View style={{ gap: 12 }}>
            <Title style={{ fontSize: 23 }}>Simulated billing history</Title>
            <Txt style={s.muted}>
              USD subscription records only. These never enter household
              spending, balances, or roommate repayments. Legacy app-dues
              payments are disabled after subscription activation.
            </Txt>
            {!sub.charges.length && (
              <Txt>No subscription charges. The trial is free.</Txt>
            )}
            {[...sub.charges]
              .reverse()
              .slice(0, 12)
              .map((charge) => (
                <View
                  key={charge.id}
                  style={{
                    gap: 4,
                    borderBottomWidth: 1,
                    borderColor: C.line,
                    paddingVertical: 10,
                  }}
                >
                  <Txt
                    style={{
                      fontFamily: "DMBold",
                      color: charge.status === "failed" ? C.red : C.green,
                    }}
                  >
                    {planFor(charge.plan).name} ·{" "}
                    {subscriptionMoney(charge.cents)} USD ·{" "}
                    {charge.status === "failed"
                      ? "Failed (simulated)"
                      : "Paid (simulated)"}
                  </Txt>
                  <Txt style={s.muted}>{dateLabel(charge.at)}</Txt>
                </View>
              ))}
            {sub.charges.length > 12 && (
              <Txt style={s.muted}>
                Showing the latest 12 records. Older records are retained.
              </Txt>
            )}
          </View>
        </>
      )}
      {!!message && (
        <Txt
          accessibilityRole="status"
          accessibilityLiveRegion="polite"
          style={{ color: C.green }}
        >
          {message}
        </Txt>
      )}
      {!!error && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      )}
    </View>
  );
}
