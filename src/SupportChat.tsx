import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageCircle, Send, X } from "lucide-react-native";
import { C, Txt, Title } from "./ui";
import {
  answerSupport,
  SupportDestination,
  SupportReply,
} from "./supportKnowledge";

const welcome =
  "Hey! 👋 I'm your SplitMate Assistant. Need help splitting bills, managing your household, or understanding your subscription? I'm here to help!";
const quickQuestions = [
  "How to Split a Bill",
  "Subscription Plans",
  "Invite a Roommate",
  "Find a Feature",
];
const sections: SupportDestination[] = [
  "Overview",
  "Purchases",
  "Balances",
  "Shopping",
  "Chore Tracker",
  "Household",
];
type Message = {
  id: number;
  role: "assistant" | "user";
  text: string;
  reply?: SupportReply;
};

/** Mounted once per account/household. Closing and changing tabs keep this session's chat. */
export default function SupportChat({
  onNavigate,
  signedIn = true,
}: {
  onNavigate?: (screen: SupportDestination) => void;
  signedIn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, role: "assistant", text: welcome },
  ]);
  const [typing, setTyping] = useState(false);
  const [context, setContext] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const nextId = useRef(1);
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const launcher = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 600;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const close = () => {
    setOpen(false);
    // Restore keyboard focus on web after Modal releases its focus trap.
    if (Platform.OS === "web")
      setTimeout(
        () =>
          (launcher.current as unknown as { focus?: () => void })?.focus?.(),
        0,
      );
  };
  const send = (value: string) => {
    const question = value.trim().slice(0, 500);
    if (!question || pending.current) return;
    pending.current = true;
    setDraft("");
    setMessages((old) =>
      [
        ...old,
        { id: nextId.current++, role: "user" as const, text: question },
      ].slice(-59),
    );
    setTyping(true);
    const reply = answerSupport(question, context);
    timer.current = setTimeout(() => {
      setMessages((old) =>
        [
          ...old,
          {
            id: nextId.current++,
            role: "assistant" as const,
            text: reply.text,
            reply,
          },
        ].slice(-60),
      );
      setContext(reply.topic);
      setTyping(false);
      pending.current = false;
      timer.current = null;
    }, 420);
  };
  const latest = messages[messages.length - 1];
  const suggestions = latest.reply?.followUps ?? quickQuestions;
  const navigate = (screen: SupportDestination) => {
    if (!onNavigate) return;
    close();
    onNavigate(screen);
  };
  const pill = (label: string, action: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={action}
      style={({ pressed }) => [
        styles.pill,
        { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 },
      ]}
    >
      <Txt style={{ color: C.dark, fontSize: 12, fontFamily: "DMSemi" }}>
        {label}
      </Txt>
    </Pressable>
  );
  return (
    <>
      <Pressable
        ref={launcher}
        accessibilityRole="button"
        accessibilityLabel="Open SplitMate Assistant"
        accessibilityHint="Get help with SplitCart"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={[
          styles.launcher,
          { bottom: (signedIn && width < 1000 ? 86 : 20) + insets.bottom },
        ]}
      >
        <MessageCircle color={C.white} size={24} accessible={false} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
        onShow={() => input.current?.focus()}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[
            styles.overlay,
            {
              paddingTop: insets.top + 8,
              paddingBottom: insets.bottom + 8,
              paddingHorizontal: compact ? 8 : 24,
            },
          ]}
        >
          <View
            accessibilityViewIsModal
            accessibilityLabel="SplitMate Assistant chat"
            style={[
              styles.panel,
              {
                width: compact ? "100%" : 410,
                height: Math.min(650, height - insets.top - insets.bottom - 16),
                maxHeight: "100%",
              },
            ]}
          >
            <View style={styles.header}>
              <View style={{ flex: 1, gap: 4 }}>
                <Title style={{ fontSize: 22, color: C.white }}>
                  SplitMate Assistant
                </Title>
                <Txt style={{ color: C.lime, fontSize: 11 }}>
                  SplitCart help · Local demo assistant
                </Txt>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close assistant"
                onPress={close}
                hitSlop={8}
                style={styles.close}
              >
                <X size={22} color={C.white} accessible={false} />
              </Pressable>
            </View>
            <ScrollView
              ref={scroll}
              keyboardShouldPersistTaps="handled"
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 14 }}
              onContentSizeChange={() =>
                scroll.current?.scrollToEnd({ animated: false })
              }
            >
              <Txt style={{ fontSize: 11, color: C.muted, lineHeight: 17 }}>
                Guidance only — I don’t access your account or make changes.
                Please don’t share passwords, codes or financial details. Chat
                clears on reload or account/household change.
              </Txt>
              <View accessibilityLiveRegion="polite" style={{ gap: 12 }}>
                {messages.map((message) => (
                  <View
                    key={message.id}
                    style={[
                      styles.bubble,
                      message.role === "user"
                        ? styles.userBubble
                        : styles.assistantBubble,
                    ]}
                  >
                    <Txt
                      style={{
                        fontSize: 10,
                        fontFamily: "DMBold",
                        color: message.role === "user" ? C.lime : C.green,
                        marginBottom: 6,
                      }}
                    >
                      {message.role === "user" ? "You" : "SplitMate Assistant"}
                    </Txt>
                    <Txt
                      selectable
                      style={{
                        fontSize: 13,
                        lineHeight: 21,
                        color: message.role === "user" ? C.white : C.ink,
                      }}
                    >
                      {message.text}
                    </Txt>
                    {message.reply?.destination && onNavigate && (
                      <View style={{ marginTop: 12 }}>
                        {pill(`Go to ${message.reply.destination}`, () =>
                          navigate(message.reply!.destination!),
                        )}
                      </View>
                    )}
                    {message.reply?.topic === "navigation" && onNavigate && (
                      <View style={styles.pills}>
                        {sections.map((section) =>
                          pill(`Go to ${section}`, () => navigate(section)),
                        )}
                      </View>
                    )}
                  </View>
                ))}
                {typing && (
                  <View
                    accessibilityLabel="Assistant is typing"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      padding: 8,
                    }}
                  >
                    <ActivityIndicator size="small" color={C.green} />
                    <Txt style={{ fontSize: 12, color: C.muted }}>
                      Thinking of the right steps…
                    </Txt>
                  </View>
                )}
              </View>
              {!typing && (
                <View style={{ gap: 8 }}>
                  <Txt
                    style={{
                      fontSize: 10,
                      fontFamily: "DMBold",
                      color: C.muted,
                    }}
                  >
                    {messages.length === 1
                      ? "QUICK QUESTIONS"
                      : "YOU MIGHT ALSO ASK"}
                  </Txt>
                  <View style={styles.pills}>
                    {suggestions.map((question) =>
                      pill(question, () => send(question)),
                    )}
                  </View>
                </View>
              )}
              {!onNavigate && (
                <Txt style={{ fontSize: 11, color: C.muted }}>
                  Sign in and finish household setup to use shortcuts to app
                  sections.
                </Txt>
              )}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                ref={input}
                accessibilityLabel="Message SplitMate Assistant"
                placeholder="Ask about SplitCart…"
                placeholderTextColor={C.muted}
                value={draft}
                onChangeText={setDraft}
                maxLength={500}
                returnKeyType="send"
                onSubmitEditing={() => send(draft)}
                blurOnSubmit={false}
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: typing || !draft.trim() }}
                disabled={typing || !draft.trim()}
                onPress={() => send(draft)}
                style={[
                  styles.send,
                  { opacity: typing || !draft.trim() ? 0.45 : 1 },
                ]}
              >
                <Send size={19} color={C.white} accessible={false} />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  launcher: {
    position: "absolute",
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: C.dark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    zIndex: 20,
  },
  overlay: {
    flex: 1,
    alignItems: "flex-end",
    justifyContent: "flex-end",
    backgroundColor: "rgba(32, 78, 57, 0.18)",
  },
  panel: {
    backgroundColor: C.bg,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.line,
    elevation: 12,
    shadowColor: C.dark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 18,
    backgroundColor: C.dark,
  },
  close: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  bubble: { padding: 13, borderRadius: 14, maxWidth: "96%" },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
  },
  userBubble: { alignSelf: "flex-end", backgroundColor: C.green },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: C.sage,
    borderWidth: 1,
    borderColor: C.line,
    minHeight: 44,
    justifyContent: "center",
  },
  composer: {
    padding: 12,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: C.ink,
    fontFamily: "DM",
    fontSize: 14,
    backgroundColor: C.bg,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
  },
});
