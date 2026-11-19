import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useStore } from "./store";
import { Button, C, s, Title, Txt } from "./ui";
import { Due, PaymentState } from "./payments";
import { money, today } from "./core";
import {
  paymentStatus,
  upcomingPayment,
  nextChargeDate,
} from "./paymentExperience";
import { loadPaymentExperience } from "./paymentStorage";

export function PaymentDashboard({
  state,
  name,
  onPay,
  onManage,
}: {
  state: PaymentState;
  name: (id: string) => string;
  onPay?: (due: Due, date: string) => void;
  onManage?: () => void;
}) {
  const upcoming = state.dues
    .map((d) => upcomingPayment(d, state.payments, today()))
    .sort((a, b) => a.date.localeCompare(b.date));
  const attention = state.payments.filter(
    (p) => paymentStatus(p.status).attention,
  );
  return (
    <View style={{ gap: 16 }}>
      <Title style={{ fontSize: 25 }}>Upcoming payments</Title>
      <Txt style={s.muted}>
        Your scheduled dues · Dates in UTC
        {state.available ? "" : " · Live payments unavailable"}
      </Txt>
      {upcoming.length === 0 && (
        <Txt>
          No monthly dues scheduled. Set up a due to see who to pay and when.
        </Txt>
      )}
      {upcoming.map(({ due, date, payment, overdue }) => (
        <View
          key={due.id}
          style={{
            gap: 10,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderColor: C.line,
          }}
        >
          <Txt style={{ fontFamily: "DMBold", fontSize: 20 }}>
            {due.label && due.label !== "Monthly due" ? `${due.label} · ` : ""}
            {money(due.cents, "USD")} to {name(due.recipient)}
          </Txt>
          <Txt>
            Due {date} (UTC){overdue ? " · Overdue" : ""}
          </Txt>
          <Txt style={{ color: due.paused ? C.muted : C.green }}>
            {due.paused
              ? "Paused · No automatic charge or due reminders"
              : due.automatic
                ? "Autopay on · Bank account"
                : "Autopay off · Pay manually"}
          </Txt>
          {due.automatic && !due.paused && (
            <Txt>
              Next automatic charge:{" "}
              {nextChargeDate(due, state.payments, today())} (UTC) ·{" "}
              {money(due.cents, "USD")}
            </Txt>
          )}
          {payment && (
            <>
              <Txt
                style={{
                  fontFamily: "DMBold",
                  color: paymentStatus(payment.status).attention
                    ? C.red
                    : C.ink,
                }}
              >
                {paymentStatus(payment.status).label}
              </Txt>
              <Txt>{paymentStatus(payment.status).help}</Txt>
            </>
          )}
          {!due.paused && !payment && onPay && (
            <Button
              secondary
              label={`Pay due to ${name(due.recipient)} on ${date}`}
              onPress={() => onPay(due, date)}
            />
          )}
        </View>
      ))}
      {attention.length > 0 && (
        <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
          <Txt style={{ color: C.red, fontFamily: "DMBold" }}>
            {attention.length} payment
            {attention.length === 1 ? " needs" : "s need"} attention
          </Txt>
          <Txt>
            Open Activity for payment details and next steps. Check before
            sending another payment.
          </Txt>
        </View>
      )}
      {!!state.notifications?.length && (
        <Txt style={s.label}>ACCOUNT ALERTS</Txt>
      )}
      {(state.notifications || []).slice(0, 3).map((n) => (
        <Txt key={n.id} style={{ color: C.ink }}>
          {n.message}
        </Txt>
      ))}
      {onManage && (
        <Button
          secondary
          label="Manage upcoming payments"
          icon="CalendarDays"
          onPress={onManage}
        />
      )}
    </View>
  );
}
export function UpcomingPayments({ onManage }: { onManage: () => void }) {
  const st = useStore();
  const [state, setState] = useState<PaymentState | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadPaymentExperience(st.user!.id, st.household!.id, st.demo)
      .then((s) => {
        if (active) setState(s);
      })
      .catch(() => {
        if (active)
          setError(
            "Payment information is unavailable. Open Balances and refresh payment status.",
          );
      });
    return () => {
      active = false;
    };
  }, [st.user?.id, st.household?.id, st.demo]);
  return (
    <View style={[s.card, { gap: 12 }]}>
      {state ? (
        <PaymentDashboard
          state={state}
          name={(id) =>
            id === "app"
              ? "SplitCart"
              : st.members.find((m) => m.id === id)?.name || "Former roommate"
          }
          onManage={onManage}
        />
      ) : (
        <>
          <Title style={{ fontSize: 25 }}>Upcoming payments</Title>
          <Txt>{error || "Loading scheduled payments…"}</Txt>
          {error && (
            <Button
              secondary
              label="Review payment status"
              onPress={onManage}
            />
          )}
        </>
      )}
    </View>
  );
}
