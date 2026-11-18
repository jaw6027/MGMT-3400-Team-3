import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { client } from "./backend";
import { Button, C, Field, Title, Txt } from "./ui";
export function BankSecurityCheck({
  demo,
  verifiedUntil,
  busy,
  onVerified,
  onExpired,
}: {
  demo: boolean;
  verifiedUntil: number;
  busy: boolean;
  onVerified: (until: number) => Promise<void>;
  onExpired: () => void;
}) {
  const [factorId, setFactorId] = useState(""),
    [qr, setQr] = useState(""),
    [secret, setSecret] = useState(""),
    [code, setCode] = useState(""),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    if (!verifiedUntil) return;
    const timer = setInterval(() => {
      const current = Date.now() / 1000;
      setNow(current);
      if (current >= verifiedUntil) onExpired();
    }, 1000);
    return () => clearInterval(timer);
  }, [verifiedUntil, onExpired]);
  const run = async (action: () => Promise<void>) => {
    if (working || busy) return;
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (e: any) {
      setError(e.message || "Security verification failed. Try again.");
    } finally {
      setWorking(false);
    }
  };
  const prepare = async () => {
    const { data, error } = await client().auth.mfa.listFactors();
    if (error) throw error;
    const existing = data.totp.find((f) => f.status === "verified");
    if (existing) {
      setFactorId(existing.id);
      setQr("");
      setSecret("");
      return;
    }
    // Only incomplete enrollment can be restarted; a verified factor is never replaced.
    for (const factor of data.all.filter(
      (f) => f.factor_type === "totp" && f.status === "unverified",
    )) {
      const { error } = await client().auth.mfa.unenroll({
        factorId: factor.id,
      });
      if (error) throw error;
    }
    const enrolled = await client().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "SplitCart account verification",
      issuer: "SplitCart",
    });
    if (enrolled.error) throw enrolled.error;
    setFactorId(enrolled.data.id);
    setQr(enrolled.data.totp.qr_code);
    setSecret(enrolled.data.totp.secret);
  };
  const verify = async () => {
    if (!/^\d{6}$/.test(code))
      throw new Error("Enter the six-digit authenticator code.");
    if (demo) {
      if (code !== "123456") throw new Error("Use sample code 123456.");
      await onVerified(Math.floor(Date.now() / 1000) + 300);
    } else {
      if (!factorId)
        throw new Error("Set up or select your authenticator first.");
      const { error } = await client().auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (error) throw error;
      await onVerified(0);
    }
    setCode("");
    setQr("");
    setSecret("");
  };
  const verified = verifiedUntil > now;
  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: 12,
        backgroundColor: C.sage,
      }}
    >
      <Title style={{ fontSize: 22 }}>Step 1 · Two-step security check</Title>
      <Txt>
        {verified
          ? "Security check complete. Financial linking is unlocked for up to five minutes."
          : "Before linking a bank, receiving account, or card, verify your account with an authenticator-app code. Bank ownership verification comes next."}
      </Txt>
      {demo && (
        <Txt>
          Sample verification only · Use 123456. No real authenticator is
          enrolled.
        </Txt>
      )}
      {!verified && (
        <>
          {!demo && (
            <Button
              secondary
              label={
                factorId
                  ? "Refresh authenticator setup"
                  : "Set up or use authenticator"
              }
              disabled={working || busy}
              onPress={() => void run(prepare)}
            />
          )}{" "}
          {!!qr && (
            <View
              style={{
                alignSelf: "flex-start",
                padding: 12,
                backgroundColor: "white",
                borderRadius: 10,
              }}
            >
              <SvgXml xml={qr} width={180} height={180} />
            </View>
          )}
          {!!secret && (
            <>
              <Txt>
                Add this key to your authenticator app, then enter its current
                code:
              </Txt>
              <Txt selectable>{secret}</Txt>
            </>
          )}
          <Field
            label="Authenticator code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            placeholder={demo ? "Sample: 123456" : "Six-digit code"}
          />
          <Button
            secondary
            label="Verify security code"
            disabled={busy || working || (!demo && !factorId)}
            loading={working}
            onPress={() => void run(verify)}
          />
        </>
      )}
      {!!error && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      )}
    </View>
  );
}
