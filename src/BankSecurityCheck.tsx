import React, { useEffect, useState, useRef } from "react";
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
  recoveryPending = false,
  remainingCodes = 0,
  canResumeRecovery = false,
  onGenerateCodes,
  onRecover,
  onResumeRecovery,
}: {
  demo: boolean;
  verifiedUntil: number;
  busy: boolean;
  onVerified: (until: number) => Promise<void>;
  onExpired: () => void;
  recoveryPending?: boolean;
  remainingCodes?: number;
  canResumeRecovery?: boolean;
  onGenerateCodes: () => Promise<string[]>;
  onRecover: (code: string, password: string) => Promise<void>;
  onResumeRecovery: () => Promise<void>;
}) {
  const [verificationPassword, setVerificationPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]),
    [recoveryMode, setRecoveryMode] = useState(false),
    [recoveryCode, setRecoveryCode] = useState(""),
    [password, setPassword] = useState("");
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
  const operationLock = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (operationLock.current || busy) return;
    operationLock.current = true;
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (e: any) {
      setError(e.message || "Security verification failed. Try again.");
    } finally {
      operationLock.current = false;
      setWorking(false);
    }
  };
  const reauthenticate = async () => {
    if (!verificationPassword)
      throw new Error("Enter your account password for this security check.");
    const { data, error } = await client().auth.getUser();
    if (error || !data.user.email)
      throw new Error("Sign in again before verification.");
    const result = await client().auth.signInWithPassword({
      email: data.user.email,
      password: verificationPassword,
    });
    if (result.error) throw result.error;
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
    await reauthenticate();
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
      await reauthenticate();
      const { error } = await client().auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (error) throw error;
      await onVerified(0);
    }
    setVerificationPassword("");
    setCode("");
    setQr("");
    setSecret("");
  };
  const verified = verifiedUntil > now;
  useEffect(() => {
    if (!verified) {
      setBackupCodes([]);
    }
  }, [verified]);
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
          : "Before linking a bank, receiving account, or card, verify your current password and an authenticator-app code. Bank ownership verification comes next."}
      </Txt>
      {demo && (
        <Txt>
          Sample verification only · Use 123456. No real authenticator is
          enrolled.
        </Txt>
      )}
      {!verified && !recoveryMode && (
        <>
          {!demo && (
            <Field
              label="Account password for security check"
              value={verificationPassword}
              onChangeText={setVerificationPassword}
              secureTextEntry
              autoComplete="current-password"
            />
          )}
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
      {verified && (
        <>
          <Txt>
            {remainingCodes} unused backup codes. Save backup codes privately so
            you can recover a lost authenticator. Creating new codes replaces
            all previous codes.
          </Txt>
          <Button
            secondary
            label={
              remainingCodes ? "Replace backup codes" : "Create backup codes"
            }
            disabled={busy || working}
            onPress={() =>
              void run(async () => {
                setBackupCodes(await onGenerateCodes());
              })
            }
          />
        </>
      )}
      {!!backupCodes.length && (
        <>
          <Field
            label="Backup codes — save privately"
            value={backupCodes.join("\n")}
            editable={false}
            multiline
          />
          <Txt>
            Shown once here. Each code works only once with your password. Store
            them outside this device.
          </Txt>
          <Button
            secondary
            label="I have saved my backup codes"
            onPress={() => setBackupCodes([])}
          />
        </>
      )}
      {recoveryPending && (
        <Txt style={{ color: C.red }}>
          Recovery is in progress. Financial linking stays locked until you set
          up and verify a replacement authenticator. A password reset alone
          cannot unlock it.
        </Txt>
      )}
      {canResumeRecovery && (
        <Button
          secondary
          label="Resume authenticator recovery"
          disabled={busy || working}
          onPress={() =>
            void run(async () => {
              await onResumeRecovery();
              setFactorId("");
              setQr("");
              setSecret("");
            })
          }
        />
      )}
      {!verified && (
        <Button
          secondary
          label={
            recoveryMode
              ? "Return to authenticator verification"
              : "Lost your authenticator?"
          }
          disabled={busy || working}
          onPress={() => {
            setRecoveryMode(!recoveryMode);
            setPassword("");
            setVerificationPassword("");
            setRecoveryCode("");
            setError("");
          }}
        />
      )}
      {recoveryMode && !verified && (
        <>
          <Txt>
            Recover with your account password and one unused backup code. Your
            old authenticators will be removed. If you have no backup code,
            contact your account operator for identity-verified recovery;
            password reset does not bypass verification.
          </Txt>
          <Field
            label="Account password for recovery"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
          />
          <Field
            label="One-time backup code"
            value={recoveryCode}
            onChangeText={setRecoveryCode}
            autoCapitalize="characters"
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          />
          <Button
            label="Recover authenticator access"
            disabled={busy || working || !password || !recoveryCode}
            onPress={() =>
              void run(async () => {
                try {
                  await onRecover(recoveryCode, password);
                  setFactorId("");
                  setQr("");
                  setSecret("");
                  setRecoveryCode("");
                  setRecoveryMode(false);
                } finally {
                  setPassword("");
                }
              })
            }
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
