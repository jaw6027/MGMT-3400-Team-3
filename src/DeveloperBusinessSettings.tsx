import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { client } from "./backend";
import { useStore } from "./store";
import { Button, Chip, Field, Title, Txt, s, C } from "./ui";
import { money } from "./core";
type Business = {
  legal_name: string;
  legal_structure: string;
  tax_classification: string;
  version: number;
};
type Finance = {
  livemode?: boolean;
  configured: boolean;
  unavailable?: boolean;
  stripeAccountId?: string;
  payoutsEnabled?: boolean;
  chargesEnabled?: boolean;
  available?: { cents: number; currency: string }[];
  pending?: { cents: number; currency: string }[];
  banks?: {
    bankName: string;
    last4: string;
    currency: string;
    status: string;
  }[];
};
async function developerAction(
  action: string,
  payload: Record<string, unknown> = {},
) {
  const { data, error } = await client().functions.invoke(
    "developer-business",
    { body: { ...payload, action } },
  );
  if (error) {
    let message = "Developer business settings are unavailable.";
    try {
      const body = await error.context?.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export default function DeveloperBusinessSettings() {
  const st = useStore();
  const [authorizedFor, setAuthorizedFor] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false),
    [open, setOpen] = useState(false),
    [business, setBusiness] = useState<Business | null>(null),
    [finance, setFinance] = useState<Finance | null>(null),
    [until, setUntil] = useState(0),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const lock = useRef(false),
    generation = useRef(0),
    operationGeneration = useRef(0);
  const clear = () => {
    generation.current++;
    setBusiness(null);
    setFinance(null);
    setUntil(0);
    setPassword("");
    setCode("");
    setMessage("");
  };
  useEffect(() => {
    let current = true;
    setAuthorized(false);
    setAuthorizedFor(null);
    clear();
    if (st.demo || !st.user) return;
    void developerAction("access")
      .then((data) => {
        if (current) {
          setAuthorized(data.authorized === true);
          setAuthorizedFor(data.authorized === true ? st.user!.id : null);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
      generation.current++;
    };
  }, [st.demo, st.user?.id]);
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => {
      if (Date.now() / 1000 >= until) clear();
    }, 1000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") clear();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [until]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    operationGeneration.current = generation.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      clear();
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
      setPassword("");
      setCode("");
    }
  };
  const load = async () => {
    const gen = operationGeneration.current;
    const data = await developerAction("status");
    if (gen !== generation.current) return;
    setBusiness(data.business);
    setFinance(data.finance);
    setUntil(data.verifiedUntil);
  };
  if (!authorized || authorizedFor !== st.user?.id || st.demo) return null;
  return (
    <View style={[s.card, { gap: 15 }]}>
      <Title style={{ fontSize: 24 }}>Developer business settings</Title>
      <Txt>
        Private SplitCart business settings · Authorized developers only.
      </Txt>
      <Button
        secondary
        label={open ? "Close developer settings" : "Open developer settings"}
        disabled={busy}
        onPress={() => {
          if (open) clear();
          setOpen(!open);
        }}
      />
      {open && (
        <>
          {!business ? (
            <>
              <Txt>
                Verify your account password and authenticator code to view
                business funds and settings. Set up an authenticator in Payments
                → Accounts first if needed.
              </Txt>
              <Field
                label="Developer account password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <Field
                label="Developer authenticator code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
              <Button
                label="Unlock business settings"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    if (!password || !/^\d{6}$/.test(code))
                      throw new Error(
                        "Enter your password and six-digit authenticator code.",
                      );
                    const { data: user, error: userError } =
                      await client().auth.getUser();
                    if (userError || !user.user?.email)
                      throw new Error("Sign in again.");
                    const signed = await client().auth.signInWithPassword({
                      email: user.user.email,
                      password,
                    });
                    if (signed.error)
                      throw new Error("Password verification failed.");
                    const { data: factors, error: factorError } =
                      await client().auth.mfa.listFactors();
                    if (factorError)
                      throw new Error(
                        "Authenticator verification is unavailable.",
                      );
                    const factor = factors.totp.find(
                      (f) => f.status === "verified",
                    );
                    if (!factor)
                      throw new Error(
                        "Enroll an authenticator in Payments → Accounts, then return here.",
                      );
                    const verified = await client().auth.mfa.challengeAndVerify(
                      { factorId: factor.id, code },
                    );
                    if (verified.error)
                      throw new Error("Authenticator verification failed.");
                    await load();
                  })
                }
              />
            </>
          ) : (
            <>
              <Txt style={{ color: C.green }}>
                Verified for up to five minutes. Business details are not stored
                on this device.
              </Txt>
              <Title style={{ fontSize: 22 }}>Business entity</Title>
              <Field
                label="SplitCart legal business name"
                value={business.legal_name}
                maxLength={160}
                onChangeText={(legal_name: string) =>
                  setBusiness({ ...business, legal_name })
                }
              />
              <Txt style={s.label}>LEGAL STRUCTURE</Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {[
                  { id: "not_set", label: "Not set" },
                  { id: "corporation", label: "Corporation" },
                  { id: "llc", label: "LLC" },
                  { id: "sole_proprietorship", label: "Sole proprietorship" },
                ].map((option) => (
                  <Chip
                    key={option.id}
                    label={option.label}
                    active={business.legal_structure === option.id}
                    onPress={() =>
                      setBusiness({
                        ...business,
                        legal_structure: option.id,
                        tax_classification: "not_set",
                      })
                    }
                  />
                ))}
              </View>
              <Txt style={s.label}>TAX CLASSIFICATION</Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {[
                  { id: "not_set", label: "Not set" },
                  { id: "c_corporation", label: "C corporation" },
                  { id: "s_corporation", label: "S corporation" },
                  { id: "partnership", label: "Partnership" },
                  { id: "disregarded_entity", label: "Disregarded entity" },
                  { id: "individual", label: "Individual" },
                ]
                  .filter((option) =>
                    (
                      ({
                        not_set: ["not_set"],
                        corporation: [
                          "not_set",
                          "c_corporation",
                          "s_corporation",
                        ],
                        llc: [
                          "not_set",
                          "c_corporation",
                          "s_corporation",
                          "partnership",
                          "disregarded_entity",
                        ],
                        sole_proprietorship: ["not_set", "individual"],
                      }) as Record<string, string[]>
                    )[business.legal_structure]?.includes(option.id),
                  )
                  .map((option) => (
                    <Chip
                      key={option.id}
                      label={option.label}
                      active={business.tax_classification === option.id}
                      onPress={() =>
                        setBusiness({
                          ...business,
                          tax_classification: option.id,
                        })
                      }
                    />
                  ))}
              </View>
              <Txt style={s.muted}>
                An LLC may have a corporate tax election. This is an internal
                record; selecting an option does not create an entity, file an
                election, or change Stripe’s verified business details.
              </Txt>
              <Button
                label="Save business entity"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await developerAction("save", { business });
                    await load();
                    setMessage("Business entity record saved.");
                  })
                }
              />
              <Title style={{ fontSize: 22 }}>
                Business funds & payout bank
              </Title>
              <Txt>
                These are SplitCart’s Stripe platform funds. Roommate transfers
                and their receiving accounts remain separate. Bank and routing
                numbers are entered only on Stripe’s secure account settings
                page.
              </Txt>
              {!finance?.configured ? (
                <Txt>The business Stripe account is not configured yet.</Txt>
              ) : finance.unavailable ? (
                <Txt>
                  Business funds are temporarily unavailable. Refresh before
                  checking payout status.
                </Txt>
              ) : (
                <>
                  <Txt>Stripe business account: {finance.stripeAccountId}</Txt>
                  <Txt>
                    {finance.livemode === true
                      ? "Live business funds"
                      : finance.livemode === false
                        ? "Stripe test mode · balances are not real or withdrawable"
                        : "Confirm the Stripe account mode in its dashboard"}
                  </Txt>
                  <Txt>
                    {finance.payoutsEnabled
                      ? "Business payouts enabled"
                      : "Business payouts need attention. Complete Stripe’s account and bank requirements."}
                  </Txt>
                  {finance.available?.map((b) => (
                    <Txt key={b.currency}>
                      Available: {money(b.cents, b.currency.toUpperCase())}
                    </Txt>
                  ))}
                  {finance.pending?.map((b) => (
                    <Txt key={b.currency}>
                      Pending: {money(b.cents, b.currency.toUpperCase())}
                    </Txt>
                  ))}
                  {finance.banks?.map((bank, index) => (
                    <Txt key={index}>
                      {bank.bankName} •••• {bank.last4} ·{" "}
                      {bank.currency.toUpperCase()} · {bank.status}
                    </Txt>
                  ))}
                  {!finance.banks?.length && (
                    <Txt>
                      Masked bank details are not available here. This does not
                      establish whether a bank is linked; review Stripe’s payout
                      settings.
                    </Txt>
                  )}
                </>
              )}
              <Button
                label="Open secure business bank settings"
                disabled={busy || !finance?.configured}
                onPress={() =>
                  void run(async () => {
                    const data = await developerAction("payout_setup");
                    const url = new URL(data.url);
                    if (
                      url.protocol !== "https:" ||
                      url.hostname !== "dashboard.stripe.com"
                    )
                      throw new Error(
                        "The secure bank settings link is unavailable.",
                      );
                    clear();
                    await Linking.openURL(data.url);
                  })
                }
              />
              <Txt style={s.muted}>
                Stripe requires its own authorized team login. Verify the
                displayed business account before changing its payout bank. No
                payout or transfer is initiated by this screen.
              </Txt>
              <Button
                secondary
                label="Refresh business status"
                disabled={busy}
                onPress={() => void run(load)}
              />
              <Button
                secondary
                label="Lock business settings"
                disabled={busy}
                onPress={clear}
              />
            </>
          )}
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
        </>
      )}
    </View>
  );
}
