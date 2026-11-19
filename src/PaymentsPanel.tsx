import React, { useEffect, useRef, useState } from "react";
import { Linking, Switch, View } from "react-native";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useStore } from "./store";
import { Button, C, Chip, Field, Icon, s, Title, Txt } from "./ui";
import { money, parseMoney, today } from "./core";
import { uid, client } from "./backend";
import { paymentAction } from "./paymentApi";
import {
  CARD_NETWORKS,
  sampleCreditCard,
  type CardNetworkId,
} from "../supabase/functions/_shared/card-networks";
import { BANK_NAMES } from "../supabase/functions/_shared/bank-linking";
import { BankSecurityCheck } from "./BankSecurityCheck";
import { PaymentProgress } from "./PaymentProgress";
import { PaymentDashboard } from "./PaymentDashboard";
import { PaymentRequests } from "./PaymentRequests";
import {
  loadPaymentExperience,
  demoRequests,
  saveDemoRequest,
} from "./paymentStorage";
import {
  paymentStatus,
  upcomingPayment,
  nextChargeDate,
  receiptText,
} from "./paymentExperience";
import { downloadReceipt } from "./paymentReceipt";
import {
  Due,
  emptyPayments,
  PaymentState,
  PaymentRequest,
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
  const [sampleBrand, setSampleBrand] = useState<CardNetworkId>("visa");
  const [editingDue, setEditingDue] = useState<Due | null>(null);
  const [dueContext, setDueContext] = useState<{
    id: string;
    date: string;
  } | null>(null);
  const [requestContext, setRequestContext] = useState<PaymentRequest | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [cancelAutopay, setCancelAutopay] = useState<string | null>(null);
  const [verificationUntil, setVerificationUntil] = useState(0);
  const [autopayNotices, setAutopayNotices] = useState(false),
    [paymentUpdates, setPaymentUpdates] = useState(false);
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
    dueId?: string;
    dueDate?: string;
    requestId?: string;
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
    setVerificationUntil(next.security?.verifiedUntil || 0);
    setAutopayNotices(!!next.reminder.autopayNotices);
    setPaymentUpdates(!!next.reminder.paymentUpdates);
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
    apply(await loadPaymentExperience(st.user!.id, st.household!.id, st.demo));
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
  const notice = (next: PaymentState, text: string) => ({
    ...next,
    notifications: [
      { id: uid(), message: text, created_at: new Date().toISOString() },
      ...(next.notifications || []),
    ].slice(0, 30),
  });
  const demoHash = (code: string) =>
    Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      code.toUpperCase().replace(/[\s-]/g, ""),
    );
  const generateCodes = async () => {
    if (verificationUntil <= Date.now() / 1000)
      throw new Error("Complete a fresh two-step check first.");
    if (!st.demo) {
      const response = await paymentAction("generate_recovery_codes");
      await load();
      return response.codes as string[];
    }
    const codes = Array.from({ length: 8 }, () =>
      uid().replace(/-/g, "").toUpperCase().match(/.{4}/g)!.join("-"),
    );
    const hashes = await Promise.all(codes.map(demoHash));
    await persist({
      ...state,
      demoRecoveryHashes: hashes,
      security: {
        ...state.security,
        verifiedUntil: 0,
        recoveryCodesRemaining: 8,
      },
    });
    return codes;
  };
  const recoverAuthenticator = async (code: string, password: string) => {
    if (st.demo) {
      if (password !== "splitcart-demo")
        throw new Error(
          "Use the sample password splitcart-demo for this demonstration.",
        );
      const hashed = await demoHash(code),
        hashes = state.demoRecoveryHashes || [];
      if (!hashes.includes(hashed))
        throw new Error("Recovery code is invalid or already used.");
      const remaining = hashes.filter((h) => h !== hashed);
      await persist({
        ...state,
        demoRecoveryHashes: remaining,
        security: {
          verifiedUntil: 0,
          recoveryPending: true,
          recoveryCodesRemaining: remaining.length,
        },
      });
      setVerificationUntil(0);
      return;
    }
    const user = await client().auth.getUser();
    if (user.error || !user.data.user.email)
      throw new Error("Sign in again before recovery.");
    const signIn = await client().auth.signInWithPassword({
      email: user.data.user.email,
      password,
    });
    if (signIn.error) throw signIn.error;
    try {
      await paymentAction("recover_mfa", { code });
      await load();
    } catch (e) {
      await load().catch(() => {});
      throw e;
    }
    setVerificationUntil(0);
  };
  const setup = async (kind: "bank" | "card" | "payout") => {
    if (verificationUntil <= Date.now() / 1000)
      throw new Error(
        "Complete a fresh two-step security check before linking financial details.",
      );
    if (st.demo) {
      if (kind === "payout")
        await persist(
          notice(
            { ...state, payoutReady: true },
            "Sample receiving-bank setup changed.",
          ),
        );
      else {
        const m =
          kind === "bank"
            ? {
                id: "demo-bank",
                funding: "bank" as const,
                label: "Demo checking •••• 6789",
                verification: "pending" as const,
              }
            : sampleCreditCard(sampleBrand);
        await persist(
          notice(
            {
              ...state,
              methods: [...state.methods.filter((x) => x.id !== m.id), m],
              bankLinks:
                kind === "bank"
                  ? [
                      {
                        id: "demo-bank-link",
                        label: m.label,
                        status: "verification_pending" as const,
                        canVerify: true,
                      },
                    ]
                  : state.bankLinks,
            },
            "A sample payment method was added or updated.",
          ),
        );
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
    if (method.verification === "pending")
      throw new Error("Complete bank verification in Accounts before paying.");
    if (!to) throw new Error("Choose who to pay.");
    const cents = to === "app" ? state.appDues : parseMoney(amount);
    setReview({
      id: uid(),
      method: selected,
      recipient: to,
      dueId: dueContext?.id,
      dueDate: dueContext?.date,
      requestId: requestContext?.id,
      ...quote(cents, method.funding),
    });
  };
  const pay = async () => {
    if (!review) return;
    if (st.demo) {
      const fresh = await loadPaymentExperience(
        st.user!.id,
        st.household!.id,
        true,
      );
      if (
        review.dueId &&
        fresh.payments.some(
          (p) => p.dueId === review.dueId && p.dueDate === review.dueDate,
        )
      )
        throw new Error(
          "This due already has a payment. Check Activity before paying again.",
        );
      if (review.requestId) {
        const request = (await demoRequests(st.household!.id)).find(
          (r) => r.id === review.requestId,
        );
        if (
          !request ||
          request.canceled ||
          (request.status && request.status !== "open")
        )
          throw new Error(
            "This request is no longer available to pay. Refresh its status.",
          );
      }
      // Same request id is used for both records; retrying never doubles the ledger.
      if (review.recipient !== "app")
        await st.repay({
          id: review.id,
          household_id: st.household!.id,
          from_id: self!.id,
          to_id: review.recipient,
          cents: review.cents,
          date: today(),
          method: "bank_card",
        });
      await persist(
        notice(
          {
            ...state,
            payments: [
              {
                id: review.id,
                recipient: review.recipient,
                cents: review.cents,
                fee: review.fee,
                status: "succeeded",
                created_at: new Date().toISOString(),
                methodLabel: method?.label,
                dueId: review.dueId,
                dueDate: review.dueDate,
                requestId: review.requestId,
              },
              ...state.payments.filter((p) => p.id !== review.id),
            ],
          },
          "Sample payment successful. Your household balance was updated.",
        ),
      );
      if (review.requestId) {
        const requests = await demoRequests(st.household!.id),
          request = requests.find((r) => r.id === review.requestId)!;
        await saveDemoRequest(st.household!.id, {
          ...request,
          status: "succeeded",
        });
        await load();
      }
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
    setDueContext(null);
    setRequestContext(null);
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
      id: editingDue?.id || uid(),
      created_at: editingDue?.created_at || new Date().toISOString(),
      paused: false,
      recipient: to,
      cents,
      day: Number(day),
      automatic,
      method: automatic ? selected : "",
      consent: authorize,
    };
    if (st.demo)
      await persist(
        notice(
          {
            ...state,
            dues: [due, ...state.dues.filter((d) => d.id !== due.id)],
          },
          editingDue
            ? "A monthly payment schedule was updated."
            : "A monthly payment schedule was created.",
        ),
      );
    else {
      await paymentAction(editingDue ? "update_due" : "save_due", { due });
      await load();
    }
    setAuthorize(false);
    setEditingDue(null);
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
    const reminder = {
      email,
      sms,
      phone,
      days,
      consent,
      autopayNotices,
      paymentUpdates,
    };
    if (st.demo)
      await persist(
        notice(
          { ...state, reminder },
          "Payment reminder preferences were changed.",
        ),
      );
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
                {[
                  "Upcoming",
                  "Accounts",
                  "Pay",
                  "Autopay",
                  "Reminders",
                  "Requests",
                  "Activity",
                ].map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    active={section === name}
                    onPress={() => {
                      setSection(name);
                      setReview(null);
                      setDueContext(null);
                      setRequestContext(null);
                      setError("");
                      setMessage("");
                    }}
                  />
                ))}
              </View>
              {section === "Upcoming" && (
                <PaymentDashboard
                  state={state}
                  name={recipientName}
                  onPay={(d, date) => {
                    setTo(d.recipient);
                    setAmount((d.cents / 100).toFixed(2));
                    setDueContext({ id: d.id, date });
                    setRequestContext(null);
                    setReview(null);
                    setSection("Pay");
                  }}
                />
              )}
              {section === "Requests" && (
                <PaymentRequests
                  requests={state.requests || []}
                  busy={busy}
                  onCreate={(r) =>
                    void run(async () => {
                      quote(r.cents, "bank");
                      if (st.demo) {
                        await saveDemoRequest(st.household!.id, r);
                        await load();
                      } else {
                        await paymentAction("create_request", { request: r });
                        await load();
                      }
                      setMessage(
                        st.demo
                          ? "Demo payment request saved in this browser."
                          : "Payment request sent.",
                      );
                    })
                  }
                  onPay={(r) => {
                    setRequestContext(r);
                    setDueContext(null);
                    setTo(r.requester);
                    setAmount((r.cents / 100).toFixed(2));
                    setReview(null);
                    setSection("Pay");
                  }}
                  onCancel={(r) =>
                    void run(async () => {
                      if (st.demo) {
                        const latest = (
                          await demoRequests(st.household!.id)
                        ).find((x) => x.id === r.id);
                        if (latest?.status !== "open")
                          throw new Error(
                            "This request already has a payment.",
                          );
                        await saveDemoRequest(st.household!.id, {
                          ...r,
                          canceled: true,
                        });
                      } else
                        await paymentAction("cancel_request", { id: r.id });
                      await load();
                      setMessage("Payment request canceled.");
                    })
                  }
                />
              )}
              {section === "Accounts" && (
                <>
                  <BankSecurityCheck
                    demo={st.demo}
                    verifiedUntil={verificationUntil}
                    busy={busy}
                    onExpired={() => setVerificationUntil(0)}
                    recoveryPending={state.security?.recoveryPending}
                    remainingCodes={state.security?.recoveryCodesRemaining || 0}
                    canResumeRecovery={state.security?.canResumeRecovery}
                    onGenerateCodes={generateCodes}
                    onRecover={recoverAuthenticator}
                    onResumeRecovery={async () => {
                      await paymentAction("resume_mfa_recovery");
                      await load();
                    }}
                    onVerified={async (until) => {
                      if (st.demo) {
                        setVerificationUntil(until);
                        if (state.security?.recoveryPending)
                          await persist({
                            ...state,
                            security: {
                              ...state.security,
                              verifiedUntil: 0,
                              recoveryPending: false,
                            },
                          });
                      } else await load();
                    }}
                  />
                  <Title style={{ fontSize: 22 }}>
                    Step 2 · Verify your bank
                  </Title>
                  <Txt>
                    Link your bank on the secure provider page. If small test
                    deposits are required, complete that verification before
                    making payments.
                  </Txt>
                  {(state.bankLinks || []).map((link) => (
                    <View key={link.id} style={{ gap: 8, paddingVertical: 10 }}>
                      <Txt style={{ fontFamily: "DMBold" }}>{link.label}</Txt>
                      <Txt>
                        {
                          {
                            awaiting_details:
                              "Bank details needed · Continue secure setup",
                            verification_pending:
                              "Bank ownership verification pending",
                            verified: "Bank ownership verified · Ready to pay",
                            failed:
                              "Bank verification failed · Link your bank again",
                            expired: "Bank setup expired · Start a new link",
                            unavailable:
                              "Bank progress temporarily unavailable",
                          }[link.status]
                        }
                      </Txt>
                      <Txt>
                        {link.status === "verification_pending"
                          ? "Check your bank statement for the provider’s test deposits. Complete verification on its secure page; don’t try a payment while verification is pending."
                          : link.status === "failed" ||
                              link.status === "expired"
                            ? "Restart bank linking to verify the account again. Existing payments and dues are kept."
                            : link.status === "unavailable"
                              ? "Refresh status or check your connection. An unavailable status does not mean the bank is verified."
                              : link.status === "awaiting_details"
                                ? "Continue the secure bank setup where you left off."
                                : "Bank ownership verification is complete."}
                      </Txt>
                      {!!link.arrivalDate && (
                        <Txt>
                          Provider’s expected deposit date: {link.arrivalDate}{" "}
                          (UTC)
                        </Txt>
                      )}
                      {(link.status === "failed" ||
                        link.status === "expired") && (
                        <Button
                          secondary
                          small
                          label="Restart bank verification"
                          disabled={busy}
                          onPress={() => void run(() => setup("bank"))}
                        />
                      )}
                      {(link.canVerify || link.canResume) && (
                        <Button
                          secondary
                          small
                          label={
                            st.demo
                              ? "Complete sample bank verification"
                              : link.canResume
                                ? "Continue bank setup"
                                : "Complete bank verification"
                          }
                          disabled={busy}
                          onPress={() =>
                            void run(async () => {
                              if (verificationUntil <= Date.now() / 1000)
                                throw new Error(
                                  "Complete a fresh two-step security check first.",
                                );
                              if (st.demo) {
                                await persist({
                                  ...state,
                                  methods: state.methods.map((m) =>
                                    m.id === "demo-bank"
                                      ? { ...m, verification: "verified" }
                                      : m,
                                  ),
                                  bankLinks: (state.bankLinks || []).map((l) =>
                                    l.id === link.id
                                      ? {
                                          ...l,
                                          status: "verified",
                                          canVerify: false,
                                        }
                                      : l,
                                  ),
                                });
                                setMessage(
                                  "Sample bank verified. No real bank details were collected.",
                                );
                              } else {
                                const response = await paymentAction(
                                  "bank_verification",
                                  { id: link.id },
                                );
                                if (
                                  !response.url ||
                                  new URL(response.url).protocol !== "https:"
                                )
                                  throw new Error(
                                    "Secure verification is unavailable.",
                                  );
                                await Linking.openURL(response.url);
                                setMessage(
                                  "Finish bank verification securely, then return and refresh payment status.",
                                );
                              }
                            })
                          }
                        />
                      )}
                    </View>
                  ))}
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
                  <Txt style={s.label}>BANK ACCOUNT LINKING</Txt>
                  <Txt>{BANK_NAMES.join(" · ")}</Txt>
                  <Txt style={s.muted}>
                    Search for your bank on the secure provider page, or choose
                    account and routing numbers when offered. Eligible US ACH
                    accounts only; availability depends on the bank and account
                    type, including Goldman Sachs accounts. Other eligible banks
                    can also be linked. SplitCart never stores your full
                    numbers.
                  </Txt>
                  <Txt style={s.muted}>
                    On the secure page, choose manual entry if offered. Test
                    deposits may be required to verify ownership. Complete
                    verification in Accounts before paying. Receiving money
                    requires the separate receiving-bank setup below.
                  </Txt>
                  <Button
                    secondary
                    label={
                      st.demo
                        ? "Try sample account-and-routing verification"
                        : "Link with account and routing numbers"
                    }
                    disabled={
                      busy ||
                      !state.available ||
                      verificationUntil <= Date.now() / 1000
                    }
                    onPress={() => void run(() => setup("bank"))}
                  />
                  <Txt style={s.label}>CARD NETWORKS</Txt>
                  <Txt>
                    {CARD_NETWORKS.map((network) => network.name).join(" · ")}
                  </Txt>
                  <Txt style={s.muted}>
                    Available through secure card setup where supported by the
                    card issuer and payment provider. Credit cards have a 2.5%
                    surcharge; debit cards have none.
                  </Txt>
                  {st.demo && (
                    <>
                      <Txt style={s.label}>SAMPLE CREDIT CARD NETWORK</Txt>
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        {CARD_NETWORKS.map((network) => (
                          <Chip
                            key={network.id}
                            label={network.name}
                            active={sampleBrand === network.id}
                            onPress={() => setSampleBrand(network.id)}
                          />
                        ))}
                      </View>
                      <Txt style={s.muted}>
                        Choose a network, then add its sample card. No real card
                        details are collected.
                      </Txt>
                    </>
                  )}
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}
                  >
                    <Button
                      secondary
                      label={st.demo ? "Add sample bank" : "Link bank account"}
                      icon="Link"
                      disabled={
                        busy ||
                        !state.available ||
                        verificationUntil <= Date.now() / 1000
                      }
                      onPress={() => void run(() => setup("bank"))}
                    />
                    <Button
                      secondary
                      label={st.demo ? "Add sample credit card" : "Add card"}
                      icon="Wallet"
                      disabled={
                        busy ||
                        !state.available ||
                        verificationUntil <= Date.now() / 1000
                      }
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
                        label={`${m.label}${m.verification === "pending" ? " · Verification pending" : ""}`}
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
                              await persist(
                                notice(
                                  {
                                    ...state,
                                    methods: state.methods.filter(
                                      (x) => x.id !== m.id,
                                    ),
                                  },
                                  "A sample payment method was removed.",
                                ),
                              );
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
                  <Txt>
                    {
                      {
                        not_started: "Receiving bank not linked",
                        needs_details: "Receiving bank details needed",
                        verification_pending:
                          "Receiving bank verification in progress",
                        ready: "Receiving bank verified · Ready for deposits",
                        restricted:
                          "Receiving bank needs attention · Review secure setup",
                      }[
                        state.payoutStatus ||
                          (state.payoutReady ? "ready" : "not_started")
                      ]
                    }
                  </Txt>
                  <Button
                    secondary
                    label={
                      st.demo
                        ? "Set up sample receiving bank"
                        : "Set up receiving bank"
                    }
                    disabled={
                      busy ||
                      !state.available ||
                      verificationUntil <= Date.now() / 1000
                    }
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
                  {(dueContext || requestContext) && (
                    <View
                      style={{
                        gap: 8,
                        backgroundColor: C.sage,
                        padding: 14,
                        borderRadius: 10,
                      }}
                    >
                      <Txt style={{ fontFamily: "DMBold" }}>
                        {dueContext
                          ? `Scheduled due · ${dueContext.date} (UTC)`
                          : "Paying a roommate’s request"}
                      </Txt>
                      <Txt>
                        To {recipientName(to)} ·{" "}
                        {fmt(to === "app" ? state.appDues : parseMoney(amount))}
                      </Txt>
                      <Button
                        secondary
                        small
                        label="Leave linked payment"
                        onPress={() => {
                          setDueContext(null);
                          setRequestContext(null);
                          setReview(null);
                        }}
                      />
                    </View>
                  )}
                  <Txt style={s.label}>PAY TO</Txt>
                  {dueContext ||
                  requestContext ||
                  (editingDue && section === "Autopay") ? (
                    <Txt>{recipientName(to)}</Txt>
                  ) : (
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
                  )}
                  {to === "app" ? (
                    <Txt>App dues: {fmt(state.appDues)}</Txt>
                  ) : (
                    <Field
                      label="Payment amount (USD)"
                      editable={!dueContext && !requestContext}
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
                    label={
                      editingDue ? "Save schedule changes" : "Save monthly due"
                    }
                    disabled={
                      busy ||
                      (automatic && (!method || !state.available)) ||
                      st.household!.currency !== "USD"
                    }
                    onPress={() => void run(saveDue)}
                  />
                  {editingDue && (
                    <Button
                      secondary
                      label="Cancel schedule editing"
                      onPress={() => {
                        setEditingDue(null);
                        setAuthorize(false);
                      }}
                    />
                  )}
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
                      <Txt>
                        {d.paused
                          ? "Paused · No future automatic charge or due reminders"
                          : d.automatic
                            ? `Next automatic charge: ${nextChargeDate(d, state.payments, today())} (UTC) · ${fmt(d.cents)}`
                            : `Next due: ${upcomingPayment(d, state.payments, today()).date} (UTC) · ${fmt(d.cents)}`}
                      </Txt>
                      <Button
                        secondary
                        small
                        label={`Edit monthly due to ${recipientName(d.recipient)}`}
                        disabled={busy}
                        onPress={() => {
                          setEditingDue(d);
                          setTo(d.recipient);
                          setAmount((d.cents / 100).toFixed(2));
                          setDay(String(d.day));
                          setSelected(
                            d.method ||
                              state.methods.find((m) => m.funding === "bank")
                                ?.id ||
                              "",
                          );
                          setAutomatic(d.automatic);
                          setAuthorize(false);
                          setDueContext(null);
                          setRequestContext(null);
                          setMessage(
                            "Edit the schedule above, then save. Bank autopay requires fresh authorization. Payments already processing keep their original amount.",
                          );
                        }}
                      />
                      {d.automatic && (
                        <Button
                          secondary
                          small
                          label={`Cancel autopay to ${recipientName(d.recipient)}`}
                          disabled={busy}
                          onPress={() => setCancelAutopay(d.id)}
                        />
                      )}
                      {cancelAutopay === d.id && (
                        <View
                          style={{
                            gap: 12,
                            padding: 14,
                            backgroundColor: C.sage,
                            borderRadius: 12,
                          }}
                        >
                          <Txt style={{ fontFamily: "DMBold" }}>
                            Cancel future automatic payments of {fmt(d.cents)}{" "}
                            to {recipientName(d.recipient)}?
                          </Txt>
                          <Txt>
                            The monthly due stays available for manual payment.
                            Canceling does not erase money owed or reverse a
                            payment already processing.
                          </Txt>
                          <Button
                            label={`Confirm cancel autopay to ${recipientName(d.recipient)}`}
                            disabled={busy}
                            onPress={() =>
                              void run(async () => {
                                if (st.demo)
                                  await persist(
                                    notice(
                                      {
                                        ...state,
                                        dues: state.dues.map((x) =>
                                          x.id === d.id
                                            ? {
                                                ...x,
                                                automatic: false,
                                                consent: false,
                                                method: "",
                                                paused: false,
                                              }
                                            : x,
                                        ),
                                      },
                                      "Autopay canceled. The due remains for manual payment.",
                                    ),
                                  );
                                else {
                                  await paymentAction("cancel_autopay", {
                                    id: d.id,
                                  });
                                  await load();
                                }
                                setEditingDue(null);
                                setAuthorize(false);
                                setAutomatic(false);
                                setCancelAutopay(null);
                                setMessage(
                                  "Autopay canceled. Future automatic charges are off; your due remains for manual payment. Payments already processing may still complete.",
                                );
                              })
                            }
                          />
                          <Button
                            secondary
                            label="Keep autopay enabled"
                            disabled={busy}
                            onPress={() => setCancelAutopay(null)}
                          />
                        </View>
                      )}
                      {!d.paused && (
                        <Button
                          secondary
                          small
                          label={`Pause monthly due to ${recipientName(d.recipient)}`}
                          disabled={busy}
                          onPress={() =>
                            void run(async () => {
                              if (st.demo)
                                await persist(
                                  notice(
                                    {
                                      ...state,
                                      dues: state.dues.map((x) =>
                                        x.id === d.id
                                          ? { ...x, paused: true }
                                          : x,
                                      ),
                                    },
                                    "A monthly payment schedule was paused.",
                                  ),
                                );
                              else {
                                await paymentAction("pause_due", {
                                  id: d.id,
                                  paused: true,
                                });
                                await load();
                              }
                              setMessage(
                                "Schedule paused. Payments already processing may still complete. Edit and authorize the schedule to resume.",
                              );
                            })
                          }
                        />
                      )}
                      <Button
                        secondary
                        small
                        label={`Remove monthly due to ${recipientName(d.recipient)}`}
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
                  <Txt>
                    Use your verified email/text channels below for payment
                    updates and advance notices. In-app payment updates are
                    always available; demo messages are never sent.
                  </Txt>
                  <Toggle
                    label="Email/text advance autopay notices"
                    value={autopayNotices}
                    onChange={setAutopayNotices}
                  />
                  <Txt style={s.muted}>
                    One day before autopay, see the scheduled amount, bank, and
                    charge date. Pause future charges in Autopay.
                  </Txt>
                  <Toggle
                    label="Email/text payment status updates"
                    value={paymentUpdates}
                    onChange={setPaymentUpdates}
                  />
                  <Txt style={s.muted}>
                    Receive one update when a payment is pending, successful, or
                    failed. Pending updates ask you to wait, without requesting
                    another payment.
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
                  <Field
                    label="Search payment history"
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search transactions"
                  />
                  {state.payments.length > 0 &&
                    state.payments.filter((p) =>
                      `${recipientName(p.recipient)} ${p.methodLabel || ""} ${paymentStatus(p.status).label} ${p.id} ${(p.cents / 100).toFixed(2)}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    ).length === 0 && <Txt>No payments match your search.</Txt>}
                  {!!state.incomingPayments?.length && (
                    <>
                      <Title style={{ fontSize: 22 }}>
                        Incoming roommate payments
                      </Title>
                      {state.incomingPayments.map((p) => (
                        <View
                          key={p.id}
                          style={{ gap: 10, paddingVertical: 12 }}
                        >
                          <Txt style={{ fontFamily: "DMBold" }}>
                            {fmt(p.cents)} from {recipientName(p.sender)} ·{" "}
                            {paymentStatus(p.status).label}
                          </Txt>
                          <PaymentProgress status={p.status} />
                        </View>
                      ))}
                    </>
                  )}
                  {state.payments.length === 0 && (
                    <Txt style={s.muted}>No bank or card payments yet.</Txt>
                  )}
                  {state.payments
                    .filter((p) =>
                      `${recipientName(p.recipient)} ${p.methodLabel || ""} ${paymentStatus(p.status).label} ${p.id} ${(p.cents / 100).toFixed(2)}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((p) => (
                      <View key={p.id} style={{ gap: 5, paddingVertical: 10 }}>
                        <Txt style={{ fontFamily: "DMBold" }}>
                          {fmt(p.cents)} to {recipientName(p.recipient)} ·{" "}
                          {paymentStatus(p.status).label}
                          {st.demo ? " (demo)" : ""}
                        </Txt>
                        <Txt style={s.muted}>
                          Surcharge {fmt(p.fee)} · Total {fmt(p.cents + p.fee)}{" "}
                          · {p.created_at.slice(0, 10)}
                        </Txt>
                        <Txt>
                          {p.methodLabel ||
                            "Payment method unavailable for this older payment"}
                        </Txt>
                        <PaymentProgress status={p.status} />
                        <Button
                          secondary
                          small
                          label="Download receipt"
                          accessibilityLabel={`Download receipt ${p.id}`}
                          disabled={busy}
                          onPress={() =>
                            void run(() =>
                              downloadReceipt(
                                p.id,
                                receiptText(
                                  p,
                                  recipientName(p.recipient),
                                  "",
                                  st.demo,
                                ),
                              ),
                            )
                          }
                        />
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
