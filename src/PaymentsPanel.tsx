import React, { useEffect, useRef, useState } from "react";
import { Linking, Switch, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useStore } from "./store";
import { Button, C, Chip, Field, Icon, s, Title, Txt } from "./ui";
import { money, parseMoney, today } from "./core";
import { uid } from "./backend";
import { paymentAction } from "./paymentApi";
import {
  Due,
  emptyPayments,
  PaymentState,
  quote,
  dueDate,
  validateReminder,
} from "./payments";

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[s.row, { gap: 12, justifyContent: "space-between" }]}>
      <Txt style={{ flex: 1, lineHeight: 21 }}>{label}</Txt>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: C.green, false: C.line }}
      />
    </View>
  );
}
export default function PaymentsPanel() {
  const st = useStore();
  const self = st.members.find((m) => m.user_id === st.user?.id);
  const roommates = st.members.filter((m) => m.id !== self?.id && !m.left_at);
  const key = `splitcart-payments-demo-v1-${st.user!.id}-${st.household!.id}`;
  const [open, setOpen] = useState(false),
    [ready, setReady] = useState(false);
  const [section, setSection] = useState("Accounts");
  const [state, setState] = useState<PaymentState>(emptyPayments);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  const [selected, setSelected] = useState(""),
    [to, setTo] = useState(roommates[0]?.id || "app"),
    [amount, setAmount] = useState("");
  const [review, setReview] = useState<{
    id: string;
    method: string;
    recipient: string;
    cents: number;
    fee: number;
    total: number;
  } | null>(null);
  const [day, setDay] = useState("1"),
    [automatic, setAutomatic] = useState(false),
    [authorize, setAuthorize] = useState(false);
  const [email, setEmail] = useState(false),
    [sms, setSms] = useState(false),
    [phone, setPhone] = useState(""),
    [days, setDays] = useState(3),
    [consent, setConsent] = useState(false),
    [code, setCode] = useState(""),
    [phoneVerified, setPhoneVerified] = useState(false);
  const method = state.methods.find((m) => m.id === selected);
  let estimate: ReturnType<typeof quote> | null = null;
  try {
    if (method)
      estimate = quote(
        to === "app" ? state.appDues : parseMoney(amount),
        method.funding,
      );
  } catch {
    // An unfinished amount is normal while typing; validation runs on review.
  }
  const fmt = (n: number) => money(n, "USD");
  const recipientName = (id: string) =>
    id === "app"
      ? "SplitCart"
      : st.members.find((m) => m.id === id)?.name || "Former roommate";
  const apply = (next: PaymentState & { phoneVerified?: boolean }) => {
    setState(next);
    setEmail(next.reminder.email);
    setSms(next.reminder.sms);
    setPhone(next.reminder.phone);
    setDays(next.reminder.days);
    setConsent(next.reminder.consent);
    setPhoneVerified(!!next.phoneVerified);
    setSelected((old) =>
      next.methods.some((m) => m.id === old) ? old : next.methods[0]?.id || "",
    );
  };
  const persist = async (next: PaymentState) => {
    await AsyncStorage.setItem(key, JSON.stringify(next));
    setState(next);
  };
  const load = async () => {
    if (st.demo) {
      const raw = await AsyncStorage.getItem(key);
      apply(
        raw
          ? JSON.parse(raw)
          : { ...emptyPayments, available: true, appDues: 500 },
      );
    } else apply(await paymentAction("status"));
    setReady(true);
  };
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open) void run(load);
  }, [open]);
  const setup = async (kind: "bank" | "card" | "payout") => {
    if (st.demo) {
      if (kind === "payout") await persist({ ...state, payoutReady: true });
      else {
        const m =
          kind === "bank"
            ? {
                id: "demo-bank",
                funding: "bank" as const,
                label: "Demo checking •••• 6789",
              }
            : {
                id: "demo-card",
                funding: "credit" as const,
                label: "Demo Visa credit •••• 4242",
              };
        await persist({
          ...state,
          methods: [...state.methods.filter((x) => x.id !== m.id), m],
        });
        setSelected(m.id);
      }
      setMessage(
        "Sample account added. No real financial information was collected.",
      );
    } else {
      const response = await paymentAction(
        kind === "payout" ? "payout_setup" : "setup",
        { kind },
      );
      if (!response.url || new URL(response.url).protocol !== "https:")
        throw new Error("The secure setup link is unavailable.");
      await Linking.openURL(response.url);
      setMessage(
        "Complete the secure setup, then return here and refresh payment status.",
      );
    }
  };
  const reviewPayment = () => {
    if (!method) throw new Error("Add and select a payment method first.");
    if (!to) throw new Error("Choose who to pay.");
    const cents = to === "app" ? state.appDues : parseMoney(amount);
    setReview({
      id: uid(),
      method: selected,
      recipient: to,
      ...quote(cents, method.funding),
    });
  };
  const pay = async () => {
    if (!review) return;
    if (st.demo) {
      // Same request id is used for both records; retrying never doubles the ledger.
      if (review.recipient !== "app")
        await st.repay({
          id: review.id,
          household_id: st.household!.id,
          from_id: self!.id,
          to_id: review.recipient,
          cents: review.cents,
          date: today(),
        });
      await persist({
        ...state,
        payments: [
          {
            id: review.id,
            recipient: review.recipient,
            cents: review.cents,
            fee: review.fee,
            status: "succeeded",
            created_at: new Date().toISOString(),
          },
          ...state.payments.filter((p) => p.id !== review.id),
        ],
      });
      setMessage("Demo payment simulated. No money moved.");
    } else {
      const p = await paymentAction("pay", { ...review, consent: true });
      await load();
      await st.refresh();
      if (
        p.authenticationUrl &&
        new URL(p.authenticationUrl).protocol === "https:"
      )
        await Linking.openURL(p.authenticationUrl);
      setMessage(
        p.status === "succeeded"
          ? "Payment completed."
          : p.status === "processing"
            ? "Bank payment processing. Your balance updates after confirmation."
            : p.status === "requires_action"
              ? "Your bank requires authentication. Complete it on the secure page, then refresh payment status. You can resume from payment activity."
              : `Payment ${p.status}. Check payment activity before starting another payment.`,
      );
    }
    setReview(null);
  };
  const saveDue = async () => {
    if (!method && automatic)
      throw new Error("Add and select a payment method first.");
    dueDate("2026-01", Number(day));
    const cents = to === "app" ? state.appDues : parseMoney(amount);
    quote(cents, method?.funding || "bank");
    if (automatic && (method?.funding !== "bank" || !authorize))
      throw new Error(
        "Choose a bank account and authorize automatic payments.",
      );
    const due: Due = {
      id: uid(),
      recipient: to,
      cents,
      day: Number(day),
      automatic,
      method: automatic ? selected : "",
      consent: authorize,
    };
    if (st.demo) await persist({ ...state, dues: [due, ...state.dues] });
    else {
      await paymentAction("save_due", { due });
      await load();
    }
    setAuthorize(false);
    setMessage(
      st.demo
        ? "Demo monthly due saved. Automatic charges and reminder deliveries are simulated only."
        : "Monthly due saved. You can cancel it at any time below.",
    );
  };
  const saveReminders = async () => {
    validateReminder(email, sms, phone, consent);
    if (sms && (!phoneVerified || phone !== state.reminder.phone))
      throw new Error(
        "Verify this phone number before enabling text reminders.",
      );
    const reminder = { email, sms, phone, days, consent };
    if (st.demo) await persist({ ...state, reminder });
    else {
      await paymentAction("reminders", { reminder });
      await load();
    }
    setMessage(
      st.demo
        ? "Demo reminder preferences saved. No text or email will be sent."
        : "Reminder preferences saved.",
    );
  };
  const verifyPhone = async (confirm: boolean) => {
    if (!consent)
      throw new Error(
        "Agree to receive reminders and verification texts first.",
      );
    validateReminder(false, true, phone, consent);
    if (st.demo) {
      if (confirm) {
        if (code !== "123456")
          throw new Error("Use demo verification code 123456.");
        const next = {
          ...state,
          phoneVerified: true,
          reminder: { ...state.reminder, phone, sms: false },
        };
        await persist(next);
        setPhoneVerified(true);
        setSms(false);
      }
      setMessage(
        confirm
          ? "Demo phone verified. No text was sent."
          : "No text was sent. Use demo code 123456.",
      );
    } else {
      await paymentAction(confirm ? "phone_confirm" : "phone_start", {
        phone,
        code,
        consent,
      });
      if (confirm) await load();
      setMessage(
        confirm
          ? "Phone verified. Enable text reminders and save your preferences."
          : "Verification text requested.",
      );
    }
  };
  return (
    <View style={[s.card, { gap: 18, borderColor: "#CCDCC8" }]}>
      <View style={[s.row, { gap: 12 }]}>
        <View
          style={{ padding: 12, backgroundColor: C.sage, borderRadius: 12 }}
        >
          <Icon name="Wallet" color={C.green} size={25} />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <Title style={{ fontSize: 25 }}>Payments, made easier.</Title>
          <Txt style={s.muted}>
            Bank accounts, cards, automatic dues & reminders.
          </Txt>
        </View>
      </View>
      <Button
        secondary
        label={open ? "Close payments" : "Manage payments"}
        icon="ChevronRight"
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <View
            style={{
              padding: 14,
              backgroundColor: C.sage,
              borderRadius: 10,
              gap: 6,
            }}
          >
            <Txt style={{ fontFamily: "DMBold", color: C.green }}>
              {st.demo ? "Demo payments · no money moves" : "Secure payments"}
            </Txt>
            <Txt style={{ lineHeight: 20, fontSize: 12 }}>
              {st.demo
                ? "Sample accounts only. Payments, autopay, texts, and emails are simulated; no real financial details are collected."
                : "Stripe collects account/routing numbers and card details on its secure pages. SplitCart stores provider references only. US bank transfers and USD payments are supported."}
            </Txt>
          </View>
          {error ? (
            <Txt accessibilityRole="alert" style={{ color: C.red }}>
              {error}
            </Txt>
          ) : null}
          {message ? (
            <Txt accessibilityLiveRegion="polite" style={{ color: C.green }}>
              {message}
            </Txt>
          ) : null}
          {(section === "Accounts" || section === "Activity" || !ready) && (
            <Button
              secondary
              small
              label="Refresh payment status"
              loading={busy}
              onPress={() => void run(load)}
            />
          )}
          {ready && (
            <>
              {!state.available && (
                <Txt style={{ color: C.red }}>
                  Live payments are not activated yet. Provider setup is
                  required before bank accounts or cards can be linked.
                </Txt>
              )}
              {st.household!.currency !== "USD" && (
                <Txt style={{ color: C.red }}>
                  Payments support USD households only. Your existing balances
                  and repayment records still work.
                </Txt>
              )}
              <View
                accessibilityLabel="Payment sections"
                style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
              >
                {["Accounts", "Pay", "Autopay", "Reminders", "Activity"].map(
                  (name) => (
                    <Chip
                      key={name}
                      label={name}
                      active={section === name}
                      onPress={() => {
                        setSection(name);
                        setReview(null);
                        setError("");
                        setMessage("");
                      }}
                    />
                  ),
                )}
              </View>
              {section === "Accounts" && (
                <>
                  <Title style={{ fontSize: 22 }}>Your payment methods</Title>
                  <Txt style={s.muted}>
                    Bank & debit: no surcharge. Credit cards: 2.5% of the
                    payment amount.
                  </Txt>
                  <View
                    style={{
                      backgroundColor: C.bg,
                      borderRadius: 12,
                      padding: 16,
                      gap: 7,
                    }}
                  >
                    <Txt style={{ fontFamily: "DMBold" }}>
                      1. Add a way to pay
                    </Txt>
                    <Txt style={{ lineHeight: 21 }}>
                      Link a bank with your account and routing numbers, or add
                      a card. Bank payments avoid the credit card surcharge.
                    </Txt>
                    <Txt style={{ fontFamily: "DMBold", marginTop: 5 }}>
                      2. Add a bank to receive money
                    </Txt>
                    <Txt style={{ lineHeight: 21 }}>
                      Complete receiving-bank setup below so roommates can pay
                      you directly.
                    </Txt>
                  </View>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}
                  >
                    <Button
                      secondary
                      label={st.demo ? "Add sample bank" : "Link bank account"}
                      icon="Link"
                      disabled={busy || !state.available}
                      onPress={() => void run(() => setup("bank"))}
                    />
                    <Button
                      secondary
                      label={st.demo ? "Add sample credit card" : "Add card"}
                      icon="Wallet"
                      disabled={busy || !state.available}
                      onPress={() => void run(() => setup("card"))}
                    />
                  </View>
                  {state.methods.length === 0 && (
                    <Txt style={s.muted}>
                      Add a bank account or card to get started.
                    </Txt>
                  )}
                  {state.methods.map((m) => (
                    <View
                      key={m.id}
                      style={[s.row, { gap: 8, flexWrap: "wrap" }]}
                    >
                      <Chip
                        active={selected === m.id}
                        label={m.label}
                        onPress={() => {
                          setSelected(m.id);
                          setReview(null);
                          setAuthorize(false);
                        }}
                      />
                      <Button
                        secondary
                        small
                        label={`Remove ${m.label}`}
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            if (
                              state.dues.some(
                                (d) => d.automatic && d.method === m.id,
                              )
                            )
                              throw new Error(
                                "Cancel automatic dues using this method before removing it.",
                              );
                            if (st.demo) {
                              await persist({
                                ...state,
                                methods: state.methods.filter(
                                  (x) => x.id !== m.id,
                                ),
                              });
                              if (selected === m.id) setSelected("");
                            } else {
                              await paymentAction("remove_method", {
                                id: m.id,
                              });
                              await load();
                            }
                            setReview(null);
                          })
                        }
                      />
                    </View>
                  ))}
                  <View style={s.divider} />
                  <Title style={{ fontSize: 22 }}>Receive payments</Title>
                  <Txt style={{ lineHeight: 21 }}>
                    Set up your receiving bank with account and routing numbers
                    through Stripe. This is separate from the bank account used
                    to pay. Bank deposits follow the provider’s payout schedule.
                  </Txt>
                  <Txt style={{ color: state.payoutReady ? C.green : C.muted }}>
                    {state.payoutReady
                      ? "Receiving payments is ready."
                      : "Receiving payments is not set up."}
                  </Txt>
                  <Button
                    secondary
                    label={
                      st.demo
                        ? "Set up sample receiving bank"
                        : "Set up receiving bank"
                    }
                    disabled={busy || !state.available}
                    onPress={() => void run(() => setup("payout"))}
                  />
                  <Button
                    label="Continue to payment"
                    icon="ArrowRight"
                    onPress={() => setSection("Pay")}
                  />
                </>
              )}
              {(section === "Pay" || section === "Autopay") && (
                <>
                  <Title style={{ fontSize: 22 }}>
                    {section === "Pay"
                      ? "Make a payment"
                      : "Set up monthly dues"}
                  </Title>
                  <Txt style={s.label}>PAY WITH</Txt>
                  {state.methods.length === 0 ? (
                    <>
                      <Txt>
                        Add a bank account or card before making a payment.
                      </Txt>
                      <Button
                        secondary
                        label="Go to accounts"
                        onPress={() => setSection("Accounts")}
                      />
                    </>
                  ) : (
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                    >
                      {state.methods.map((m) => (
                        <Chip
                          key={m.id}
                          active={selected === m.id}
                          label={`${m.label} · ${m.funding === "credit" ? "2.5% fee" : "No surcharge"}`}
                          onPress={() => {
                            setSelected(m.id);
                            setReview(null);
                            setAuthorize(false);
                          }}
                        />
                      ))}
                    </View>
                  )}
                  <Txt style={s.label}>PAY TO</Txt>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {[
                      ...roommates.map((m) => ({ id: m.id, name: m.name })),
                      ...(state.appDues
                        ? [{ id: "app", name: "SplitCart app dues" }]
                        : []),
                    ].map((m) => (
                      <Chip
                        key={m.id}
                        label={m.name}
                        active={to === m.id}
                        onPress={() => {
                          setTo(m.id);
                          setReview(null);
                          setAuthorize(false);
                        }}
                      />
                    ))}
                  </View>
                  {to === "app" ? (
                    <Txt>App dues: {fmt(state.appDues)}</Txt>
                  ) : (
                    <Field
                      label="Payment amount (USD)"
                      value={amount}
                      onChangeText={(v: string) => {
                        setAmount(v);
                        setReview(null);
                        setAuthorize(false);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                    />
                  )}
                  {estimate && section === "Pay" && !review && (
                    <View
                      style={{
                        padding: 16,
                        backgroundColor: C.sage,
                        borderRadius: 12,
                        gap: 8,
                      }}
                    >
                      <Txt>Recipient receives: {fmt(estimate.cents)}</Txt>
                      <Txt>
                        {method?.funding === "credit"
                          ? "Credit card surcharge (2.5%)"
                          : "Bank / debit surcharge"}
                        : {fmt(estimate.fee)}
                      </Txt>
                      <Txt style={{ fontFamily: "DMBold", fontSize: 20 }}>
                        Estimated total: {fmt(estimate.total)}
                      </Txt>
                      {method?.funding === "credit" && (
                        <Txt>
                          Choose a bank account to save {fmt(estimate.fee)}.
                        </Txt>
                      )}
                    </View>
                  )}
                  {section === "Pay" && (
                    <>
                      <Button
                        label="Review payment"
                        disabled={
                          busy ||
                          !method ||
                          !state.available ||
                          st.household!.currency !== "USD"
                        }
                        onPress={() => void run(async () => reviewPayment())}
                      />
                      {review && (
                        <View
                          style={{
                            padding: 17,
                            gap: 13,
                            backgroundColor: C.sage,
                            borderRadius: 12,
                          }}
                        >
                          <Txt style={{ fontFamily: "DMBold" }}>
                            Review {st.demo ? "demo " : ""}payment to{" "}
                            {recipientName(review.recipient)}
                          </Txt>
                          <Txt>Payment: {fmt(review.cents)}</Txt>
                          <Txt>
                            Paying with:{" "}
                            {
                              state.methods.find((m) => m.id === review.method)
                                ?.label
                            }
                          </Txt>
                          <Txt>
                            Credit card surcharge (2.5% on credit only):{" "}
                            {fmt(review.fee)}
                          </Txt>
                          <Txt style={{ fontFamily: "DMBold", fontSize: 20 }}>
                            Total charged: {fmt(review.total)}
                          </Txt>
                          <Txt style={{ fontSize: 12, lineHeight: 20 }}>
                            By confirming, you authorize this one-time charge to
                            your selected method. Your roommate receives the
                            payment amount; the surcharge does not reduce your
                            dues. Bank payments can take several business days.
                          </Txt>
                          <Button
                            label={
                              st.demo
                                ? "Confirm demo payment"
                                : `Pay ${fmt(review.total)}`
                            }
                            loading={busy}
                            onPress={() => void run(pay)}
                          />
                          <Button
                            secondary
                            label="Cancel payment review"
                            disabled={busy}
                            onPress={() => setReview(null)}
                          />
                        </View>
                      )}
                    </>
                  )}
                </>
              )}
              {section === "Autopay" && (
                <>
                  <Title style={{ fontSize: 22 }}>Monthly dues & autopay</Title>
                  <Txt style={{ lineHeight: 21 }}>
                    Use the recipient and amount on this screen to schedule a
                    fixed monthly due. Due dates use UTC. Automatic payment uses
                    a linked bank account with no surcharge; it does not
                    automatically pay a changing household balance.
                  </Txt>
                  <Field
                    label="Monthly due day (1–28, UTC)"
                    value={day}
                    onChangeText={(v: string) => {
                      setDay(v);
                      setAuthorize(false);
                    }}
                    keyboardType="number-pad"
                  />
                  {automatic && method?.funding !== "bank" && (
                    <Txt style={{ color: C.red }} accessibilityRole="alert">
                      Select a linked bank above to use autopay. Cards cannot be
                      used for automatic dues.
                    </Txt>
                  )}
                  {automatic && method?.funding === "bank" && (
                    <Txt style={{ color: C.green }}>
                      Bank autopay · No surcharge · Cancel anytime below
                    </Txt>
                  )}
                  <Toggle
                    label="Automatically pay this monthly due"
                    value={automatic}
                    onChange={(v) => {
                      setAutomatic(v);
                      setAuthorize(false);
                    }}
                  />
                  {automatic && (
                    <Toggle
                      label="I authorize the selected bank account to be charged this amount each month on the due day until I cancel"
                      value={authorize}
                      onChange={setAuthorize}
                    />
                  )}
                  <Button
                    secondary
                    label="Save monthly due"
                    disabled={
                      busy ||
                      (automatic && (!method || !state.available)) ||
                      st.household!.currency !== "USD"
                    }
                    onPress={() => void run(saveDue)}
                  />
                  {state.dues.length === 0 && (
                    <Txt style={s.muted}>No monthly dues scheduled.</Txt>
                  )}
                  {state.dues.map((d) => (
                    <View
                      key={d.id}
                      style={{
                        gap: 10,
                        padding: 14,
                        borderWidth: 1,
                        borderColor: C.line,
                        borderRadius: 10,
                      }}
                    >
                      <Txt style={{ fontFamily: "DMBold" }}>
                        {fmt(d.cents)} to {recipientName(d.recipient)}
                      </Txt>
                      <Txt>
                        Day {d.day} each month (UTC) ·{" "}
                        {d.automatic ? "Bank autopay" : "Reminder only"}
                        {st.demo ? " · Demo" : ""}
                      </Txt>
                      <Button
                        secondary
                        small
                        label={`Cancel monthly due to ${recipientName(d.recipient)}`}
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            if (st.demo)
                              await persist({
                                ...state,
                                dues: state.dues.filter((x) => x.id !== d.id),
                              });
                            else {
                              await paymentAction("cancel_due", { id: d.id });
                              await load();
                            }
                            setMessage(
                              "Monthly due canceled. Any payment already processing may still complete.",
                            );
                          })
                        }
                      />
                    </View>
                  ))}
                  <Button
                    secondary
                    label="Set up payment reminders"
                    icon="Mail"
                    onPress={() => setSection("Reminders")}
                  />
                </>
              )}
              {section === "Reminders" && (
                <>
                  <Title style={{ fontSize: 22 }}>Stay on time</Title>
                  <Txt style={{ lineHeight: 21 }}>
                    Get reminders for your monthly dues by email and text. Email
                    goes to your verified account email. You can turn either
                    channel off at any time.
                  </Txt>
                  <Toggle
                    label="Email payment reminders"
                    value={email}
                    onChange={setEmail}
                  />
                  <Toggle
                    label="Text payment reminders"
                    value={sms}
                    onChange={setSms}
                  />
                  <Txt style={s.muted}>
                    {state.dues.length
                      ? `${state.dues.length} monthly due${state.dues.length === 1 ? "" : "s"} scheduled.`
                      : "No monthly dues yet. Schedule a due in Autopay for these reminders to apply."}{" "}
                    Reminders use UTC due dates.
                  </Txt>
                  <Txt style={{ color: phoneVerified ? C.green : C.muted }}>
                    {phoneVerified
                      ? "Text number verified"
                      : "Verify your number to enable text reminders"}
                  </Txt>
                  <Field
                    label="Reminder phone number"
                    value={phone}
                    onChangeText={(v: string) => {
                      setPhone(v);
                      setPhoneVerified(false);
                    }}
                    keyboardType="phone-pad"
                    placeholder="+14155550123"
                  />
                  <Toggle
                    label="I agree to receive payment reminders and verification texts. Message/data rates may apply; reply STOP to stop texts"
                    value={consent}
                    onChange={setConsent}
                  />
                  {!phoneVerified && (
                    <>
                      <Button
                        secondary
                        small
                        label="Send phone verification code"
                        disabled={busy || !consent}
                        onPress={() => void run(() => verifyPhone(false))}
                      />
                      <Field
                        label="Phone verification code"
                        value={code}
                        onChangeText={setCode}
                        keyboardType="number-pad"
                        placeholder={
                          st.demo ? "Demo: 123456" : "Code from your text"
                        }
                      />
                      <Button
                        secondary
                        small
                        label="Verify phone"
                        disabled={busy || !consent}
                        onPress={() => void run(() => verifyPhone(true))}
                      />
                    </>
                  )}
                  <Txt style={s.label}>REMIND ME</Txt>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {[7, 3, 1, 0].map((d) => (
                      <Chip
                        key={d}
                        label={
                          d
                            ? `${d} day${d === 1 ? "" : "s"} before`
                            : "On the due date"
                        }
                        active={days === d}
                        onPress={() => setDays(d)}
                      />
                    ))}
                  </View>
                  <Button
                    label="Save reminder preferences"
                    disabled={busy}
                    onPress={() => void run(saveReminders)}
                  />
                  <Txt style={s.muted}>
                    {days
                      ? `${days} day${days === 1 ? "" : "s"} before each due date`
                      : "On each due date"}{" "}
                    · Email {email ? "on" : "off"} · Text {sms ? "on" : "off"}.
                    Save to apply changes.
                  </Txt>
                </>
              )}
              {section === "Activity" && (
                <>
                  <Title style={{ fontSize: 22 }}>Payment activity</Title>
                  <Txt style={s.muted}>
                    Only confirmed payments update household balances. Manual
                    repayment records remain separate.
                  </Txt>
                  {state.payments.length === 0 && (
                    <Txt style={s.muted}>No bank or card payments yet.</Txt>
                  )}
                  {state.payments.map((p) => (
                    <View key={p.id} style={{ gap: 5, paddingVertical: 10 }}>
                      <Txt style={{ fontFamily: "DMBold" }}>
                        {fmt(p.cents)} to {recipientName(p.recipient)} ·{" "}
                        {p.status}
                        {st.demo ? " (demo)" : ""}
                      </Txt>
                      <Txt style={s.muted}>
                        Surcharge {fmt(p.fee)} · Total {fmt(p.cents + p.fee)} ·{" "}
                        {p.created_at.slice(0, 10)}
                      </Txt>
                      {p.status === "requires_action" && !st.demo && (
                        <Button
                          secondary
                          small
                          label="Complete payment authentication"
                          disabled={busy}
                          onPress={() =>
                            void run(async () => {
                              const response = await paymentAction(
                                "authenticate",
                                {
                                  id: p.id,
                                },
                              );
                              if (
                                response.url &&
                                new URL(response.url).protocol === "https:"
                              )
                                await Linking.openURL(response.url);
                              else
                                setMessage(
                                  "Refresh payment status. If authentication is still required, use a different method after canceling this payment with support.",
                                );
                            })
                          }
                        />
                      )}
                      {[
                        "failed",
                        "requires_action",
                        "refunded",
                        "disputed",
                      ].includes(p.status) && (
                        <Txt style={{ color: C.red }}>
                          This payment needs attention. Check with support
                          before trying another payment.
                        </Txt>
                      )}
                    </View>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}
