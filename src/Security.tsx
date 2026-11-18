import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { useStore } from "./store";
import { Button, C, Field, s, Title, Txt } from "./ui";
import { client } from "./backend";
const SecurityContext = createContext({
  enabled: false,
  available: false,
  busy: false,
  error: "",
  toggle: async () => {},
});
export function SecurityProvider({ children }: { children: React.ReactNode }) {
  const st = useStore(),
    userId = st.user?.id;
  const [enabled, setEnabled] = useState(false),
    [available, setAvailable] = useState(false),
    [ready, setReady] = useState(false),
    [locked, setLocked] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [loadedUser, setLoadedUser] = useState<string | undefined>(undefined);
  const prompt = useRef(false);
  const key = `splitcart-biometric-${userId}`;
  useEffect(() => {
    let active = true;
    setReady(false);
    setLocked(true);
    setEnabled(false);
    setError("");
    (async () => {
      try {
        const capable =
          Platform.OS !== "web" &&
          (await LocalAuthentication.hasHardwareAsync()) &&
          (await LocalAuthentication.isEnrolledAsync());
        const on =
          Platform.OS !== "web" && (await AsyncStorage.getItem(key)) === "true";
        if (active) {
          setAvailable(capable);
          setEnabled(on);
          setLocked(on);
          setLoadedUser(userId);
          setReady(true);
        }
      } catch {
        if (active) {
          setError(
            "Device unlock settings could not be loaded. Retry or sign out.",
          );
          setLoadedUser(userId);
          setReady(true);
          setEnabled(true);
          setLocked(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, key]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (enabled && state !== "active" && !prompt.current) setLocked(true);
    });
    return () => sub.remove();
  }, [enabled]);
  const authenticate = async () => {
    if (prompt.current) return false;
    prompt.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock SplitCart",
        disableDeviceFallback: true,
        cancelLabel: "Cancel",
      });
      if (!result.success)
        throw new Error(
          "Unlock was canceled or unsuccessful. Try again or sign out.",
        );
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      prompt.current = false;
      setBusy(false);
    }
  };
  const toggle = async () => {
    if (!available || busy) return;
    if (await authenticate()) {
      try {
        await AsyncStorage.setItem(key, String(!enabled));
        setEnabled(!enabled);
        setLocked(false);
      } catch {
        setError("Unlock preference could not be saved. Try again.");
      }
    }
  };
  if (userId && (!ready || loadedUser !== userId))
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 28,
          backgroundColor: C.bg,
        }}
      >
        <Txt>Loading account security…</Txt>
      </View>
    );
  if (userId && enabled && locked)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 28,
          gap: 20,
          backgroundColor: C.bg,
        }}
      >
        <Title>Welcome back.</Title>
        <Txt>
          Unlock SplitCart with your device biometrics to see household and
          payment details.
        </Txt>
        {!!error && (
          <Txt accessibilityRole="alert" style={{ color: C.red }}>
            {error}
          </Txt>
        )}
        <Button
          label="Unlock SplitCart"
          loading={busy}
          onPress={() =>
            void authenticate().then((ok) => {
              if (ok) setLocked(false);
            })
          }
        />
        <Button
          secondary
          label="Sign out instead"
          disabled={busy}
          onPress={() => {
            void AsyncStorage.removeItem(key)
              .then(() => st.signOut())
              .catch(() => setError("Could not sign out. Try again."));
          }}
        />
      </View>
    );
  return (
    <SecurityContext.Provider
      value={{ enabled, available, busy, error, toggle }}
    >
      {children}
    </SecurityContext.Provider>
  );
}
export function SecuritySettings() {
  const security = useContext(SecurityContext);
  return (
    <View style={[s.card, { gap: 16 }]}>
      <Title style={{ fontSize: 25 }}>Account security</Title>
      <Txt>Biometric app unlock: {security.enabled ? "On" : "Off"}</Txt>
      <Txt>
        {security.available
          ? "Require a fingerprint or face scan when opening the app or returning from the background. This device setting does not replace your account password."
          : "Biometric unlock is available on supported iOS and Android devices with enrolled biometrics. It is unavailable in this browser."}
      </Txt>
      <Button
        secondary
        label={
          security.enabled
            ? "Turn off biometric unlock"
            : "Enable biometric unlock"
        }
        disabled={!security.available || security.busy}
        onPress={() => void security.toggle()}
      />
      {!!security.error && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {security.error}
        </Txt>
      )}
      <Txt>
        Payment-setting changes appear under Balances → Upcoming. Review any
        changes you don’t recognize.
      </Txt>
    </View>
  );
}
export function PasswordRecovery({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: 28,
        gap: 18,
        backgroundColor: C.bg,
      }}
    >
      <Title>Choose a new password</Title>
      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
      />
      {!!error && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      )}
      <Button
        label="Save new password"
        loading={busy}
        onPress={() => {
          if (busy) return;
          setBusy(true);
          setError("");
          void (async () => {
            try {
              if (password.length < 8)
                throw new Error("Use a password with at least 8 characters.");
              if (password !== confirm)
                throw new Error("The passwords do not match.");
              const { error } = await client().auth.updateUser({ password });
              if (error) throw error;
              onComplete();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
    </View>
  );
}
