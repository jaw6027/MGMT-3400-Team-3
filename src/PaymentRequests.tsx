import React, { useState } from "react";
import { View } from "react-native";
import { useStore } from "./store";
import { Button, C, Chip, Field, s, Title, Txt } from "./ui";
import { PaymentRequest } from "./payments";
import { money, parseMoney } from "./core";
import { uid } from "./backend";
import { paymentStatus } from "./paymentExperience";
export function PaymentRequests({
  requests,
  busy,
  onCreate,
  onPay,
  onCancel,
}: {
  requests: PaymentRequest[];
  busy: boolean;
  onCreate: (r: PaymentRequest) => void;
  onPay: (r: PaymentRequest) => void;
  onCancel: (r: PaymentRequest) => void;
}) {
  const st = useStore(),
    self = st.members.find((m) => m.user_id === st.user?.id)!;
  const others = st.members.filter((m) => m.id !== self.id && !m.left_at);
  const [payer, setPayer] = useState(others[0]?.id || ""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [expenseId, setExpenseId] = useState(""),
    [error, setError] = useState("");
  const name = (id: string) =>
    st.members.find((m) => m.id === id)?.name || "Former roommate";
  return (
    <View style={{ gap: 16 }}>
      <Title style={{ fontSize: 25 }}>Payment requests</Title>
      <Txt>
        Request a specific amount from a roommate. Requests do not change
        balances; only a completed payment does.
      </Txt>
      <Txt style={s.label}>REQUEST FROM</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {others.map((m) => (
          <Chip
            key={m.id}
            label={m.name}
            active={payer === m.id}
            onPress={() => setPayer(m.id)}
          />
        ))}
      </View>
      <Field
        label="Requested amount (USD)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <Field
        label="Request note (optional)"
        value={note}
        onChangeText={setNote}
        maxLength={240}
      />
      <Txt style={s.label}>ATTACH A PURCHASE (OPTIONAL)</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip
          label="No attachment"
          active={!expenseId}
          onPress={() => setExpenseId("")}
        />
        {st.expenses.map((e) => (
          <Chip
            key={e.id}
            label={e.name}
            active={expenseId === e.id}
            onPress={() => setExpenseId(e.id)}
          />
        ))}
      </View>
      {error ? (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      ) : null}
      <Button
        label="Send payment request"
        disabled={busy || !payer}
        onPress={() => {
          try {
            setError("");
            onCreate({
              id: uid(),
              requester: self.id,
              payer,
              cents: parseMoney(amount),
              note,
              expenseId: expenseId || undefined,
              canceled: false,
              created_at: new Date().toISOString(),
              status: "open",
            });
          } catch (e: any) {
            setError(e.message);
          }
        }}
      />
      {requests.filter((r) => r.requester === self.id || r.payer === self.id)
        .length === 0 && <Txt style={s.muted}>No payment requests yet.</Txt>}
      {requests
        .filter((r) => r.requester === self.id || r.payer === self.id)
        .map((r) => (
          <View
            key={r.id}
            style={{
              gap: 10,
              paddingVertical: 14,
              borderTopWidth: 1,
              borderColor: C.line,
            }}
          >
            <Txt style={{ fontFamily: "DMBold" }}>
              {money(r.cents, "USD")} ·{" "}
              {r.payer === self.id
                ? `Requested by ${name(r.requester)}`
                : `Requested from ${name(r.payer)}`}
            </Txt>
            <Txt>
              {r.canceled
                ? "Canceled"
                : r.status === "succeeded"
                  ? "Paid"
                  : !r.status || r.status === "open"
                    ? "Unpaid"
                    : paymentStatus(r.status).label}
            </Txt>
            {!!r.note && <Txt>{r.note}</Txt>}
            {!!r.expenseId && (
              <Txt>
                Purchase:{" "}
                {st.expenses.find((e) => e.id === r.expenseId)?.name ||
                  "Purchase no longer available"}
              </Txt>
            )}
            {!r.canceled &&
              (!r.status || r.status === "open") &&
              (r.payer === self.id ? (
                <Button
                  secondary
                  label={`Pay request from ${name(r.requester)}`}
                  disabled={busy}
                  onPress={() => onPay(r)}
                />
              ) : (
                <Button
                  secondary
                  label={`Cancel request to ${name(r.payer)}`}
                  disabled={busy}
                  onPress={() => onCancel(r)}
                />
              ))}
          </View>
        ))}
    </View>
  );
}
