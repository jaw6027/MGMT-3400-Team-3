import React, { useState } from "react";
import { View } from "react-native";
import { useStore } from "./store";
import { Button, C, s, Title, Txt } from "./ui";
import { money } from "./core";
export function CashPayments() {
  const st = useStore(),
    self = st.members.find((m) => m.user_id === st.user?.id);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const records = (st.cashPayments || []).filter(
    (p) => p.from_id === self?.id || p.to_id === self?.id,
  );
  const name = (id: string) =>
    st.members.find((m) => m.id === id)?.name || "Former roommate";
  const resolve = async (id: string, decision: "confirmed" | "disputed") => {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      await st.resolveCash(id, decision);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <View style={[s.card, { gap: 16 }]}>
      <Title style={{ fontSize: 24 }}>Cash confirmations</Title>
      <Txt>
        Only the receiving roommate can confirm receipt. Pending and disputed
        cash do not change balances.
      </Txt>
      {!records.length && (
        <Txt style={s.muted}>No cash entries awaiting review.</Txt>
      )}
      {!!error && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      )}
      {records.map((p) => (
        <View
          key={p.id}
          style={{
            gap: 10,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderColor: C.line,
          }}
        >
          <Txt style={{ fontFamily: "DMBold" }}>
            {money(p.cents, st.household?.currency)} · {name(p.from_id)} to{" "}
            {name(p.to_id)}
          </Txt>
          <Txt>
            Cash · {p.date} ·{" "}
            {p.status === "pending"
              ? "Awaiting receiver confirmation"
              : p.status === "confirmed"
                ? "Receipt confirmed · Balance updated"
                : "Disputed · Balance unchanged"}
          </Txt>
          {p.status === "pending" && p.to_id === self?.id && (
            <>
              <Button
                label={`Confirm cash received from ${name(p.from_id)}`}
                disabled={!!busy}
                onPress={() => void resolve(p.id, "confirmed")}
              />
              <Button
                secondary
                label={`Dispute cash from ${name(p.from_id)}`}
                disabled={!!busy}
                onPress={() => void resolve(p.id, "disputed")}
              />
            </>
          )}
          {p.status === "pending" && p.from_id === self?.id && (
            <Txt style={s.muted}>
              Waiting for {name(p.to_id)} to confirm. Don’t record the same cash
              payment again.
            </Txt>
          )}
          {p.status === "disputed" && (
            <Txt>
              Contact your roommate to resolve the disagreement. If the entry
              was incorrect, create a corrected cash entry for their review.
            </Txt>
          )}
        </View>
      ))}
    </View>
  );
}
