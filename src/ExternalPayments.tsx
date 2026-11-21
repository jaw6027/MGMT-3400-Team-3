import React, { useRef, useState } from "react";
import { Linking, Switch, View } from "react-native";
import { useStore } from "./store";
import { uid, loadData } from "./backend";
import { parseMoney, today, validDate, money } from "./core";
import { Button, Chip, Field, Title, Txt, s, C } from "./ui";
import { PaymentBrandLogo } from "./PaymentBrandLogo";
import {
  externalPaymentUrl,
  OutsideChannel,
  outsidePaymentName,
} from "./externalPayments";
import { loadPaymentExperience } from "./paymentStorage";
import {
  matchingPayment,
  DUPLICATE_MESSAGE,
} from "../supabase/functions/_shared/payment-safety";
export function ExternalPayments() {
  const st = useStore(),
    self = st.members.find((m) => m.user_id === st.user?.id),
    others = st.members.filter((m) => m.id !== self?.id && !m.left_at);
  const [channel, setChannel] = useState<OutsideChannel>("venmo"),
    [recipient, setRecipient] = useState(others[0]?.id || ""),
    [contact, setContact] = useState(""),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(today()),
    [completed, setCompleted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const operation = useRef(false),
    reference = useRef({ key: "", id: "" });
  const provider = outsidePaymentName(channel),
    name = others.find((m) => m.id === recipient)?.name || "your roommate";
  const run = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const terms = () => {
    if (!self || !others.some((m) => m.id === recipient))
      throw new Error("Choose an active receiving roommate.");
    if (!validDate(date)) throw new Error("Use a valid payment date.");
    return parseMoney(amount);
  };
  const checkPending = async (cents: number) => {
    const experience = await loadPaymentExperience(
      st.user!.id,
      st.household!.id,
      st.demo,
    );
    const cash = st.demo
      ? st.cashPayments || []
      : (await loadData()).cashPayments || [];
    if (
      matchingPayment(experience.payments, recipient, cents) ||
      cash.some(
        (p) =>
          p.from_id === self?.id &&
          p.to_id === recipient &&
          p.cents === cents &&
          (p.status === "pending" ||
            (p.status === "confirmed" &&
              Date.parse(p.resolved_at || "") > Date.now() - 600000)),
      )
    )
      throw new Error(DUPLICATE_MESSAGE);
  };
  return (
    <View style={[s.card, { gap: 15 }]}>
      <Title style={{ fontSize: 25 }}>Venmo & Zelle</Title>
      <Txt>
        Pay in Venmo or your participating bank, then record the outside payment
        here. Opening another app does not send money or mark a bill paid. The
        receiving roommate must confirm receipt before balances change.
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["venmo", "zelle"] as const).map((id) => (
          <Chip
            key={id}
            label={outsidePaymentName(id)}
            leading={<PaymentBrandLogo brand={id} />}
            active={channel === id}
            onPress={() => {
              setChannel(id);
              setContact("");
              setCompleted(false);
              setMessage("");
            }}
          />
        ))}
      </View>
      <Txt style={s.label}>RECEIVING ROOMMATE</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {others.map((m) => (
          <Chip
            key={m.id}
            label={`${m.name} · outside payment`}
            active={recipient === m.id}
            onPress={() => {
              setRecipient(m.id);
              setContact("");
              setCompleted(false);
            }}
          />
        ))}
      </View>
      {!others.length && (
        <Txt>Add another roommate before recording an outside payment.</Txt>
      )}
      <Field
        label={`Outside payment amount (${st.household?.currency || "USD"})`}
        value={amount}
        onChangeText={(value: string) => {
          setAmount(value);
          setCompleted(false);
        }}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <Field
        label="Outside payment date"
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
      />
      <Field
        label={
          channel === "venmo"
            ? "Recipient Venmo username (to open profile)"
            : "Recipient Zelle email or US mobile (to open bank finder)"
        }
        value={contact}
        onChangeText={setContact}
        maxLength={254}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Txt selectable>
        Verify {name}’s {provider} details directly with them. This contact is
        not verified or saved by SplitCart. Enter the amount shown above and
        check the recipient in the payment app before sending.
      </Txt>
      {channel === "zelle" && (
        <Txt>
          Zelle works through participating banks. The bank finder helps you
          locate yours; it does not prefill or initiate a Zelle transfer. Use
          the recipient’s enrolled email or US mobile in your bank app.
        </Txt>
      )}
      <Button
        secondary
        label={
          channel === "venmo"
            ? "Open recipient’s Venmo profile"
            : "Find my Zelle bank"
        }
        disabled={busy || !recipient}
        onPress={() =>
          void run(async () => {
            const cents = terms(),
              url = externalPaymentUrl(channel, contact);
            await checkPending(cents);
            if (st.demo)
              setMessage(
                `Demo only: ${provider} navigation is simulated. No money moved. You can practice recording and receiver confirmation below.`,
              );
            else {
              await Linking.openURL(url);
              setMessage(
                `Finish ${money(cents, st.household!.currency)} to ${name} in ${provider}, then return here only after you have sent it.`,
              );
            }
          })
        }
      />
      <Txt style={s.muted}>
        Already paid? You can record it without entering contact details.
        SplitCart does not add its card surcharge to these outside records; your
        bank or Venmo may charge its own fees. Outside payments do not cancel
        autopay or automatically close a linked request. Review those
        separately.
      </Txt>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Txt style={{ flex: 1 }}>
          I verified the recipient and already sent this {provider} payment
        </Txt>
        <Switch
          accessibilityLabel={`I already sent this ${provider} payment`}
          value={completed}
          onValueChange={setCompleted}
        />
      </View>
      <Button
        label={`Record sent ${provider} payment`}
        disabled={busy || !completed || !recipient}
        onPress={() =>
          void run(async () => {
            const cents = terms();
            if (!completed)
              throw new Error(
                "Complete the payment outside SplitCart before recording it.",
              );
            const key = `${channel}/${recipient}/${cents}/${date}`;
            if (reference.current.key !== key)
              reference.current = { key, id: uid() };
            await st.proposeCash({
              id: reference.current.id,
              household_id: st.household!.id,
              from_id: self!.id,
              to_id: recipient,
              cents,
              date,
              method: channel,
            });
            setCompleted(false);
            setContact("");
            setMessage(
              `${provider} record is awaiting ${name}’s confirmation. No second transfer was initiated.`,
            );
          })
        }
      />
      {!!error && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      )}
      {!!message && (
        <Txt accessibilityLiveRegion="polite" style={{ color: C.green }}>
          {message}
        </Txt>
      )}
    </View>
  );
}
