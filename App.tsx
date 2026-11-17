import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { Fraunces_500Medium } from "@expo-google-fonts/fraunces/500Medium";
import * as ImagePicker from "expo-image-picker";
import { Provider, useStore } from "./src/store";
import {
  balances,
  canEdit,
  categories,
  equalSplit,
  Expense,
  money,
  parseMoney,
  settlements,
  today,
  validateImage,
  validDate,
} from "./src/core";
import {
  client,
  liveConfigured,
  receiptUrl,
  uid,
  uploadReceipt,
} from "./src/backend";
import { demoReceipt } from "./src/demo";
import {
  Avatar,
  Button,
  C,
  CategoryIcon,
  Chip,
  Empty,
  Field,
  Icon,
  IconName,
  s,
  Title,
  Txt,
} from "./src/ui";
import Illustration from "./src/Illustration";
import PaymentsPanel from "./src/PaymentsPanel";
type Tab = "Overview" | "Purchases" | "Balances" | "Household";
const tabs: { name: Tab; icon: IconName }[] = [
  { name: "Overview", icon: "Home" },
  { name: "Purchases", icon: "Receipt" },
  { name: "Balances", icon: "Wallet" },
  { name: "Household", icon: "Users" },
];
const shortDate = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
function ReceiptPhoto({ path, style }: any) {
  const [uri, setUri] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    receiptUrl(path)
      .then((u) => {
        if (alive) setUri(u);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return path.startsWith("data:image/svg+xml;utf8,") ? (
    <View style={style}>
      <SvgXml
        xml={decodeURIComponent(path.split("utf8,")[1])}
        width="100%"
        height="100%"
      />
    </View>
  ) : failed ? (
    <View
      style={[
        { padding: 12, backgroundColor: C.sage, justifyContent: "center" },
        style,
      ]}
    >
      <Txt style={s.muted}>Receipt unavailable. Reopen to retry.</Txt>
    </View>
  ) : uri ? (
    <Image
      accessibilityLabel="Purchase receipt"
      source={{ uri }}
      resizeMode="contain"
      onError={() => setFailed(true)}
      style={style}
    />
  ) : (
    <ActivityIndicator color={C.green} />
  );
}
export default function App() {
  const [loaded, error] = useFonts({
    DM: DMSans_400Regular,
    DMMedium: DMSans_500Medium,
    DMSemi: DMSans_600SemiBold,
    DMBold: DMSans_700Bold,
    Fraunces: Fraunces_500Medium,
  });
  if (!loaded && !error)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={C.green} />
      </View>
    );
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Provider>
        <Main />
      </Provider>
    </SafeAreaProvider>
  );
}
function Main() {
  const store = useStore();
  const { width } = useWindowDimensions();
  const desktop = width >= 1000;
  const [tab, setTab] = useState<Tab>("Overview");
  const [editor, setEditor] = useState<Expense | null | undefined>(undefined);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [repayOpen, setRepayOpen] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const notify = (m: string) => setToast(m);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    setTab("Overview");
    setEditor(undefined);
    setDetail(null);
    setRepayOpen(false);
    setReceipt(null);
  }, [store.demo, store.user?.id]);
  const current = store.members.find((m) => m.user_id === store.user?.id);
  const fmt = (n: number) => money(n, store.household?.currency);
  const b = balances(store.members, store.expenses, store.repayments);
  const myBalance = current ? b[current.id] || 0 : 0;
  if (store.loading)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: C.bg,
          gap: 14,
        }}
      >
        <ActivityIndicator color={C.green} />
        <Txt>Getting your household ready…</Txt>
      </View>
    );
  if (!store.user) return <Auth />;
  if (!store.household) return <HouseholdSetup />;
  const nav = (name: Tab) => {
    setTab(name);
  };
  const sorted = [...store.expenses].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  );
  const refresh = async () => {
    if (store.demo) {
      notify("Demo is up to date.");
      return;
    }
    setRefreshing(true);
    try {
      await store.refresh();
    } catch (e: any) {
      store.setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {desktop && (
          <View
            style={{
              width: 226,
              backgroundColor: C.white,
              borderRightWidth: 1,
              borderColor: C.line,
              padding: 23,
            }}
          >
            <Logo />
            <View style={{ height: 52 }} />
            <Txt
              style={[
                s.label,
                { fontSize: 10, marginBottom: 15, marginLeft: 12 },
              ]}
            >
              YOUR SPACE
            </Txt>
            <View style={{ gap: 8 }}>
              {tabs.map((t) => (
                <Pressable
                  key={t.name}
                  onPress={() => nav(t.name)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 13,
                    padding: 13,
                    borderRadius: 9,
                    backgroundColor: tab === t.name ? C.sage : "transparent",
                  }}
                >
                  <Icon
                    name={t.icon}
                    size={19}
                    color={tab === t.name ? C.green : C.muted}
                  />
                  <Txt
                    style={{
                      fontFamily: tab === t.name ? "DMBold" : "DMMedium",
                      color: tab === t.name ? C.green : C.muted,
                    }}
                  >
                    {t.name}
                  </Txt>
                  {t.name === "Purchases" && (
                    <View
                      style={{
                        marginLeft: "auto",
                        borderRadius: 5,
                        backgroundColor: "#F1F3EE",
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                      }}
                    >
                      <Txt style={{ fontSize: 10, color: C.muted }}>
                        {store.expenses.length}
                      </Txt>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
            <View style={{ flex: 1 }} />
            <View
              style={{
                backgroundColor: "#F5F7F0",
                padding: 16,
                borderRadius: 12,
                gap: 10,
                marginBottom: 22,
              }}
            >
              <Icon name="Leaf" color={C.green} />
              <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                A happy home starts here.
              </Txt>
              <Txt style={{ fontSize: 11, color: C.muted, lineHeight: 18 }}>
                Less money talk. More living together.
              </Txt>
            </View>
            <Pressable
              onPress={() => setTab("Household")}
              style={[
                s.row,
                {
                  gap: 10,
                  borderTopWidth: 1,
                  borderColor: C.line,
                  paddingTop: 20,
                },
              ]}
            >
              <Avatar name={current?.name || store.user.name} />
              <View style={{ flex: 1 }}>
                <Txt style={{ fontFamily: "DMBold", fontSize: 12 }}>
                  {current?.name || store.user.name}
                </Txt>
                <Txt style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                  Your personal space
                </Txt>
              </View>
              <Icon name="Settings" size={16} color={C.muted} />
            </Pressable>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View
            style={[
              s.between,
              {
                minHeight: 78,
                borderBottomWidth: 1,
                borderColor: C.line,
                paddingHorizontal: desktop ? 38 : 20,
                backgroundColor: C.white,
              },
            ]}
          >
            {desktop ? (
              <View style={[s.row, { gap: 9 }]}>
                <View
                  style={{
                    backgroundColor: C.sage,
                    padding: 7,
                    borderRadius: 8,
                  }}
                >
                  <Icon name="Home" size={17} color={C.green} />
                </View>
                <Txt style={{ fontFamily: "DMSemi", fontSize: 13 }}>
                  {store.household.name}
                </Txt>
                <Icon name="ChevronDown" size={14} color={C.muted} />
                <View
                  style={{
                    width: 1,
                    height: 19,
                    backgroundColor: C.line,
                    marginHorizontal: 9,
                  }}
                />
                <Txt style={s.muted}>{tab}</Txt>
              </View>
            ) : (
              <Logo compact />
            )}
            <View style={[s.row, { gap: 14 }]}>
              {store.demo && (
                <View
                  style={{
                    paddingVertical: 5,
                    paddingHorizontal: 10,
                    borderRadius: 20,
                    backgroundColor: "#F4EEDC",
                  }}
                >
                  <Txt
                    style={{
                      fontSize: 10,
                      color: "#8F7951",
                      fontFamily: "DMBold",
                    }}
                  >
                    DEMO MODE
                  </Txt>
                </View>
              )}
              <Pressable
                accessibilityLabel="Household settings"
                onPress={() => setTab("Household")}
              >
                <Avatar name={current?.name || "Alex"} size={33} />
              </Pressable>
            </View>
          </View>
          <ScrollView
            contentContainerStyle={{
              padding: desktop ? 36 : 20,
              paddingBottom: 40,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={C.green}
              />
            }
          >
            <View
              style={{
                maxWidth: 1200,
                width: "100%",
                alignSelf: "center",
                gap: 26,
              }}
            >
              {store.error && (
                <View style={[s.card, { backgroundColor: "#FBEFEC", gap: 10 }]}>
                  <Txt style={{ color: C.red }}>{store.error}</Txt>
                  <Button
                    secondary
                    small
                    label="Dismiss"
                    onPress={() => store.setError("")}
                  />
                </View>
              )}
              {tab === "Overview" && (
                <>
                  <View
                    style={[
                      s.between,
                      {
                        alignItems: desktop ? "center" : "flex-start",
                        gap: 12,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={[s.row, { gap: 6, marginBottom: 8 }]}>
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: C.green,
                          }}
                        />
                        <Txt style={s.label}>HOME, SHARED BETTER</Txt>
                      </View>
                      <Title style={{ fontSize: desktop ? 36 : 30 }}>
                        Hey {current?.name.split(" ")[0]}, welcome home.
                      </Title>
                      <Txt
                        style={{ color: C.muted, marginTop: 9, fontSize: 13 }}
                      >
                        A little less splitting hairs. A lot more splitting
                        fairly.
                      </Txt>
                    </View>
                    {desktop && (
                      <View
                        style={[
                          s.row,
                          {
                            gap: 8,
                            borderWidth: 1,
                            borderColor: C.line,
                            backgroundColor: C.white,
                            borderRadius: 8,
                            padding: 11,
                          },
                        ]}
                      >
                        <Icon name="CalendarDays" size={15} color={C.muted} />
                        <Txt style={{ fontSize: 11, color: C.muted }}>
                          {new Date().toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </Txt>
                      </View>
                    )}
                  </View>
                  <View
                    style={{
                      flexDirection: desktop ? "row" : "column",
                      gap: 20,
                    }}
                  >
                    <View
                      style={{
                        flex: 1.65,
                        minHeight: 222,
                        borderRadius: 18,
                        backgroundColor: "#EAF0DF",
                        overflow: "hidden",
                        padding: 27,
                        flexDirection: "row",
                        alignItems: "center",
                      }}
                    >
                      <View style={{ flex: 1, zIndex: 1, gap: 13 }}>
                        <Txt
                          style={{
                            fontSize: 10,
                            letterSpacing: 1.4,
                            color: "#506842",
                            fontFamily: "DMBold",
                          }}
                        >
                          GOOD ROOMMATES. GREAT BALANCE.
                        </Txt>
                        <Title style={{ fontSize: 30, lineHeight: 36 }}>
                          Shared home.{"\n"}Shared cart.
                        </Title>
                        <Txt
                          style={{
                            fontSize: 12,
                            color: "#53664E",
                            lineHeight: 20,
                            maxWidth: 235,
                          }}
                        >
                          From the weekly shop to the Wi-Fi.{"\n"}Keep track,
                          split fairly, stay even.
                        </Txt>
                        <Button
                          label="Add a purchase"
                          icon="Plus"
                          onPress={() => setEditor(null)}
                          style={{ alignSelf: "flex-start", marginTop: 3 }}
                        />
                      </View>
                      {width > 600 && (
                        <View
                          style={{
                            width: desktop ? 230 : 260,
                            alignItems: "center",
                          }}
                        >
                          <Illustration />
                        </View>
                      )}
                      {width <= 600 && (
                        <View
                          pointerEvents="none"
                          style={{
                            position: "absolute",
                            right: -98,
                            bottom: -20,
                            opacity: 0.22,
                          }}
                        >
                          <Illustration />
                        </View>
                      )}
                    </View>
                    <View
                      style={{
                        flex: 1,
                        minHeight: 222,
                        padding: 25,
                        borderRadius: 18,
                        backgroundColor: C.dark,
                        overflow: "hidden",
                        justifyContent: "space-between",
                      }}
                    >
                      <View style={[s.between, { gap: 10 }]}>
                        <Txt style={{ fontSize: 12, color: "#C9D9CB" }}>
                          Your household balance
                        </Txt>
                        <View
                          style={{
                            backgroundColor: "#39634C",
                            padding: 8,
                            borderRadius: 9,
                          }}
                        >
                          <Icon name="Wallet" color="#D5E6C7" size={18} />
                        </View>
                      </View>
                      <View>
                        <Txt
                          style={{
                            fontFamily: "DMSemi",
                            fontSize: 43,
                            color: "#FCFDF5",
                            letterSpacing: -1.5,
                          }}
                        >
                          {fmt(Math.abs(myBalance))}
                        </Txt>
                        <View style={[s.row, { gap: 5, marginTop: 3 }]}>
                          <Icon
                            name={
                              myBalance >= 0 ? "ArrowDownLeft" : "ArrowUpRight"
                            }
                            size={15}
                            color="#B9D3A4"
                          />
                          <Txt style={{ fontSize: 12, color: "#C8DCBA" }}>
                            {myBalance > 0
                              ? "You’re owed. Nice and clear."
                              : myBalance < 0
                                ? "You owe your household."
                                : "All settled up. Feels good."}
                          </Txt>
                        </View>
                      </View>
                      <Pressable
                        onPress={() => setTab("Balances")}
                        style={[
                          s.between,
                          {
                            borderTopWidth: 1,
                            borderColor: "#426750",
                            paddingTop: 15,
                            marginTop: 18,
                          },
                        ]}
                      >
                        <Txt
                          style={{
                            color: "#EEF4E5",
                            fontSize: 12,
                            fontFamily: "DMSemi",
                          }}
                        >
                          View balances
                        </Txt>
                        <Icon name="ArrowRight" size={16} color="#EEF4E5" />
                      </Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: desktop ? 18 : 9 }}>
                    {[
                      {
                        label: "Household spending",
                        value: fmt(
                          store.expenses
                            .filter(
                              (e) => e.date.slice(0, 7) === today().slice(0, 7),
                            )
                            .reduce((n, e) => n + e.cents, 0),
                        ),
                        sub: "this month",
                        icon: "ShoppingBasket",
                      },
                      {
                        label: "Shared purchases",
                        value: String(store.expenses.length),
                        sub: "little things, together",
                        icon: "Receipt",
                      },
                      {
                        label: "Under one roof",
                        value: String(
                          store.members.filter((m) => !m.left_at).length,
                        ),
                        sub: "roommates, one team",
                        icon: "Users",
                      },
                    ].map((stat) => (
                      <View
                        key={stat.label}
                        style={[
                          s.card,
                          { flex: 1, padding: desktop ? 20 : 13, gap: 12 },
                        ]}
                      >
                        <View style={s.between}>
                          <Txt
                            style={{
                              fontSize: desktop ? 12 : 10,
                              color: C.muted,
                              flex: 1,
                            }}
                          >
                            {stat.label}
                          </Txt>
                          {desktop && (
                            <Icon
                              name={stat.icon as IconName}
                              size={17}
                              color="#8D9A8B"
                            />
                          )}
                        </View>
                        <Txt
                          style={{
                            fontSize: desktop ? 27 : 21,
                            fontFamily: "DMSemi",
                            letterSpacing: -0.8,
                          }}
                        >
                          {stat.value}
                        </Txt>
                        <Txt
                          style={{
                            fontSize: desktop ? 11 : 9,
                            color: "#65745E",
                          }}
                        >
                          {stat.sub}
                        </Txt>
                      </View>
                    ))}
                  </View>
                  <View
                    style={{
                      flexDirection: desktop ? "row" : "column",
                      gap: 24,
                      alignItems: "flex-start",
                    }}
                  >
                    <View style={{ flex: 1.9, width: "100%", gap: 16 }}>
                      <View style={s.between}>
                        <View style={[s.row, { gap: 9 }]}>
                          <Title style={{ fontSize: 23 }}>
                            Recent purchases
                          </Title>
                          <View
                            style={{
                              backgroundColor: "#EAEFE4",
                              paddingHorizontal: 7,
                              paddingVertical: 3,
                              borderRadius: 5,
                            }}
                          >
                            <Txt style={{ fontSize: 10, color: C.green }}>
                              {store.expenses.length}
                            </Txt>
                          </View>
                        </View>
                        <Pressable
                          onPress={() => setTab("Purchases")}
                          style={[s.row, { gap: 5 }]}
                        >
                          <Txt style={s.link}>View all</Txt>
                          <Icon name="ArrowRight" size={14} color={C.green} />
                        </Pressable>
                      </View>
                      <View
                        style={[s.card, { padding: 0, overflow: "hidden" }]}
                      >
                        {sorted.length ? (
                          sorted
                            .slice(0, 5)
                            .map((e, i) => (
                              <PurchaseRow
                                key={e.id}
                                e={e}
                                onPress={() => setDetail(e)}
                                last={i === Math.min(sorted.length, 5) - 1}
                              />
                            ))
                        ) : (
                          <Empty
                            title="Your first shared purchase"
                            description="Milk, paper towels, or Friday pizza. Add it here and we’ll do the math."
                            action={
                              <Button
                                label="Add a purchase"
                                icon="Plus"
                                onPress={() => setEditor(null)}
                              />
                            }
                          />
                        )}
                      </View>
                    </View>
                    <View style={{ flex: 1, width: "100%", gap: 16 }}>
                      <Title style={{ fontSize: 23 }}>
                        Your little household
                      </Title>
                      <View style={[s.card, { padding: 21, gap: 17 }]}>
                        <View style={[s.row, { gap: 11 }]}>
                          <View
                            style={{
                              backgroundColor: C.sage,
                              padding: 11,
                              borderRadius: 11,
                            }}
                          >
                            <Icon name="Home" color={C.green} />
                          </View>
                          <View>
                            <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                              {store.household.name}
                            </Txt>
                            <Txt
                              style={{
                                fontSize: 11,
                                color: C.muted,
                                marginTop: 3,
                              }}
                            >
                              Making shared living feel easy.
                            </Txt>
                          </View>
                        </View>
                        <View style={s.divider} />
                        {store.members
                          .filter((m) => !m.left_at)
                          .map((m, i) => (
                            <View key={m.id} style={[s.row, { gap: 10 }]}>
                              <Avatar name={m.name} index={i} size={31} />
                              <Txt style={{ fontSize: 12, flex: 1 }}>
                                {m.name}
                                {m.id === current?.id ? " (you)" : ""}
                              </Txt>
                              <View
                                style={{
                                  width: 6,
                                  height: 6,
                                  backgroundColor: "#9BB48E",
                                  borderRadius: 3,
                                }}
                              />
                            </View>
                          ))}
                        <Button
                          secondary
                          small
                          label="Manage household"
                          icon="Users"
                          onPress={() => setTab("Household")}
                        />
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 10,
                          paddingHorizontal: 12,
                        }}
                      >
                        <Icon name="Lock" size={15} color="#93A38C" />
                        <Txt
                          style={{
                            fontSize: 10,
                            color: "#65745E",
                            lineHeight: 17,
                            flex: 1,
                          }}
                        >
                          Just between housemates. Your purchases and receipts
                          stay in your household.
                        </Txt>
                      </View>
                    </View>
                  </View>
                </>
              )}
              {tab === "Purchases" && (
                <PurchaseHistory
                  onAdd={() => setEditor(null)}
                  onOpen={setDetail}
                />
              )}
              {tab === "Balances" && (
                <Balances onRepay={() => setRepayOpen(true)} />
              )}
              {tab === "Household" && <HouseholdSettings notify={notify} />}
              <View
                style={[
                  s.row,
                  { gap: 6, justifyContent: "center", paddingTop: 8 },
                ]}
              >
                <Icon name="Leaf" size={13} color="#9FAC97" />
                <Txt style={{ fontSize: 10, color: "#65745E" }}>
                  A little fairness goes a long way. That’s SplitCart.
                </Txt>
              </View>
            </View>
          </ScrollView>
          {!desktop && (
            <View
              style={{
                flexDirection: "row",
                backgroundColor: C.white,
                borderTopWidth: 1,
                borderColor: C.line,
                paddingTop: 8,
                paddingBottom: 8,
              }}
            >
              {tabs.map((t) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t.name }}
                  key={t.name}
                  onPress={() => nav(t.name)}
                  style={{ flex: 1, alignItems: "center", gap: 4, padding: 7 }}
                >
                  <Icon
                    name={t.icon}
                    color={tab === t.name ? C.green : C.muted}
                    size={21}
                  />
                  <Txt
                    style={{
                      fontSize: 10,
                      color: tab === t.name ? C.green : C.muted,
                      fontFamily: tab === t.name ? "DMBold" : "DM",
                    }}
                  >
                    {t.name}
                  </Txt>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
      {toast !== "" && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            bottom: desktop ? 25 : 90,
            alignSelf: "center",
            backgroundColor: C.dark,
            borderRadius: 10,
            padding: 15,
            maxWidth: "90%",
            flexDirection: "row",
            gap: 9,
          }}
        >
          <Icon name="CheckCircle2" size={18} color="#DAE9D0" />
          <Txt style={{ color: C.white, fontSize: 12 }}>{toast}</Txt>
        </View>
      )}
      {editor !== undefined && (
        <PurchaseEditor
          expense={editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            notify("Purchase saved. Everyone’s share is accounted for.");
          }}
        />
      )}
      {detail && (
        <PurchaseDetail
          e={store.expenses.find((e) => e.id === detail.id) || detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor(detail);
            setDetail(null);
          }}
          onReceipt={setReceipt}
          notify={notify}
        />
      )}
      {repayOpen && (
        <RepayModal
          onClose={() => setRepayOpen(false)}
          onSaved={() => {
            setRepayOpen(false);
            notify("Repayment recorded. Your balances are up to date.");
          }}
        />
      )}
      {receipt && (
        <Sheet title="Receipt" onClose={() => setReceipt(null)}>
          <ReceiptPhoto path={receipt} style={{ width: "100%", height: 550 }} />
          <Txt style={[s.muted, { textAlign: "center" }]}>
            Shared privately with your household.
          </Txt>
        </Sheet>
      )}
    </SafeAreaView>
  );
}
function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[s.row, { gap: 9 }]}>
      <View
        style={{
          width: 34,
          height: 34,
          backgroundColor: C.green,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="ShoppingBasket" size={21} color="#F1F6E9" />
      </View>
      <Txt
        style={{
          fontFamily: "DMBold",
          fontSize: compact ? 21 : 23,
          letterSpacing: -1,
        }}
      >
        SplitCart<Txt style={{ color: C.green, fontSize: 24 }}>.</Txt>
      </Txt>
    </View>
  );
}
function PurchaseRow({
  e,
  onPress,
  last = false,
}: {
  e: Expense;
  onPress: () => void;
  last?: boolean;
}) {
  const st = useStore();
  const m = st.members.find((m) => m.id === e.paid_by);
  const self = st.members.find((m) => m.user_id === st.user?.id);
  const mine = e.shares.find((s) => s.member_id === self?.id);
  const { width } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${e.name}`}
      onPress={onPress}
      style={({ hovered }: any) => [
        s.row,
        {
          gap: 13,
          padding: 17,
          borderBottomWidth: last ? 0 : 1,
          borderColor: C.line,
          backgroundColor: hovered ? "#FAFBF7" : C.white,
        },
      ]}
    >
      <CategoryIcon category={e.category} />
      <View style={{ flex: 1, gap: 5 }}>
        <Txt style={{ fontFamily: "DMSemi", fontSize: 13 }} numberOfLines={1}>
          {e.name}
        </Txt>
        <View style={[s.row, { gap: 5 }]}>
          <Txt style={{ fontSize: 10, color: C.muted }}>
            {m?.name.split(" ")[0]} paid · {shortDate(e.date)}
          </Txt>
          {e.receipt && <Icon name="Receipt" size={11} color="#8F9A89" />}
        </View>
      </View>
      {e.receipt && (
        <ReceiptPhoto
          path={e.receipt}
          style={{
            width: 28,
            height: 36,
            borderRadius: 4,
            backgroundColor: "#F4F1E9",
          }}
        />
      )}
      {width >= 1200 && (
        <View
          style={{
            padding: 6,
            borderRadius: 5,
            backgroundColor: "#F6F7F2",
            marginRight: 15,
          }}
        >
          <Txt style={{ fontSize: 9, color: "#65745E" }}>{e.category}</Txt>
        </View>
      )}
      <View style={{ gap: 5, alignItems: "flex-end" }}>
        <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
          {money(e.cents, st.household?.currency)}
        </Txt>
        <Txt style={{ fontSize: 10, color: C.muted }}>
          your share {money(mine?.cents || 0, st.household?.currency)}
        </Txt>
      </View>
      <Icon name="ChevronRight" size={13} color="#A8B0A3" />
    </Pressable>
  );
}
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(22,40,29,0.36)",
          justifyContent: "center",
          alignItems: "center",
          padding: width > 600 ? 28 : 10,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 620,
            maxHeight: "95%",
            backgroundColor: C.bg,
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <View
            style={[
              s.between,
              {
                padding: 21,
                borderBottomWidth: 1,
                borderColor: C.line,
                backgroundColor: C.white,
              },
            ]}
          >
            <Title style={{ fontSize: 25 }}>{title}</Title>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              onPress={onClose}
              style={{ padding: 7 }}
            >
              <Icon name="X" />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 23, gap: 20 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
function PurchaseHistory({
  onAdd,
  onOpen,
}: {
  onAdd: () => void;
  onOpen: (e: Expense) => void;
}) {
  const st = useStore();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [member, setMember] = useState("All"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [filters, setFilters] = useState(false);
  const filtered = [...st.expenses]
    .filter(
      (e) =>
        `${e.name} ${e.store} ${e.notes}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (category === "All" || e.category === category) &&
        (member === "All" || e.paid_by === member) &&
        (!from || e.date >= from) &&
        (!to || e.date <= to),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <View style={[s.between, { gap: 15 }]}>
        <View style={{ flex: 1 }}>
          <Title>Shared purchases</Title>
          <Txt style={{ color: C.muted, marginTop: 8 }}>
            The little things that make a home.
          </Txt>
        </View>
        <Button icon="Plus" label="Add purchase" onPress={onAdd} />
      </View>
      <View style={[s.card, { gap: 17 }]}>
        <View style={[s.row, { gap: 12 }]}>
          <View
            style={[
              s.row,
              {
                flex: 1,
                borderWidth: 1,
                borderColor: C.line,
                borderRadius: 9,
                paddingHorizontal: 12,
                gap: 8,
              },
            ]}
          >
            <Icon name="Search" size={18} color={C.muted} />
            <TextInput
              accessibilityLabel="Search purchases"
              value={query}
              onChangeText={setQuery}
              placeholder="Search purchases or stores…"
              placeholderTextColor={C.muted}
              style={{
                flex: 1,
                fontFamily: "DM",
                fontSize: 13,
                padding: 13,
                color: C.ink,
              }}
            />
          </View>
          <Button
            secondary
            label="Filters"
            icon="SlidersHorizontal"
            onPress={() => setFilters(!filters)}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {["All", ...categories].map((c) => (
            <Chip
              label={c}
              key={c}
              active={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </ScrollView>
        {filters && (
          <>
            <Txt style={s.label}>PAID BY</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip
                label="Everyone"
                active={member === "All"}
                onPress={() => setMember("All")}
              />
              {st.members.map((m) => (
                <Chip
                  label={m.name.split(" ")[0]}
                  key={m.id}
                  active={member === m.id}
                  onPress={() => setMember(m.id)}
                />
              ))}
            </View>
            <View style={[s.row, { gap: 15 }]}>
              <Field
                label="From date"
                value={from}
                onChangeText={setFrom}
                placeholder="YYYY-MM-DD"
              />
              <Field
                label="To date"
                value={to}
                onChangeText={setTo}
                placeholder="YYYY-MM-DD"
              />
            </View>
            <Button
              secondary
              small
              label="Clear filters"
              onPress={() => {
                setCategory("All");
                setMember("All");
                setFrom("");
                setTo("");
                setQuery("");
              }}
            />
          </>
        )}
      </View>
      <View style={s.between}>
        <Txt style={s.label}>
          {filtered.length} PURCHASE{filtered.length === 1 ? "" : "S"}
        </Txt>
        <Txt style={s.muted}>
          Total{" "}
          {money(
            filtered.reduce((n, e) => n + e.cents, 0),
            st.household?.currency,
          )}
        </Txt>
      </View>
      <View style={[s.card, { padding: 0, overflow: "hidden" }]}>
        {filtered.length ? (
          filtered.map((e, i) => (
            <PurchaseRow
              key={e.id}
              e={e}
              onPress={() => onOpen(e)}
              last={i === filtered.length - 1}
            />
          ))
        ) : (
          <Empty
            title="Nothing here just yet"
            description="Try another search or add your household’s first shared purchase."
            action={<Button label="Add purchase" onPress={onAdd} icon="Plus" />}
          />
        )}
      </View>
    </>
  );
}
function Balances({ onRepay }: { onRepay: () => void }) {
  const st = useStore();
  const b = balances(st.members, st.expenses, st.repayments);
  const suggestions = settlements(b);
  const fmt = (n: number) => money(n, st.household?.currency);
  const name = (id: string) =>
    st.members.find((m) => m.id === id)?.name.split(" ")[0] ||
    "Former roommate";
  return (
    <>
      <View style={[s.between, { gap: 15 }]}>
        <View style={{ flex: 1 }}>
          <Title>All squared up.</Title>
          <Txt style={{ color: C.muted, marginTop: 8 }}>
            Clear balances. Happy housemates.
          </Txt>
        </View>
        <Button label="Record repayment" icon="Plus" onPress={onRepay} />
      </View>
      <PaymentsPanel />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        {st.members.map((m, i) => (
          <View
            key={m.id}
            style={[s.card, { flexGrow: 1, flexBasis: 180, gap: 14 }]}
          >
            <View style={[s.row, { gap: 10 }]}>
              <Avatar name={m.name} index={i} />
              <View>
                <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                  {name(m.id)}
                </Txt>
                <Txt style={s.muted}>
                  {m.left_at ? "Former roommate" : "Roommate"}
                </Txt>
              </View>
            </View>
            <Txt
              style={{
                fontSize: 27,
                fontFamily: "DMSemi",
                color: b[m.id] >= 0 ? C.green : "#B17F51",
              }}
            >
              {fmt(Math.abs(b[m.id]))}
            </Txt>
            <Txt style={s.muted}>
              {b[m.id] > 0
                ? "is owed"
                : b[m.id] < 0
                  ? "owes the household"
                  : "all settled up"}
            </Txt>
          </View>
        ))}
      </View>
      <Title style={{ fontSize: 24 }}>The easy way to settle</Title>
      <View style={[s.card, { gap: 18 }]}>
        {suggestions.length ? (
          suggestions.map((r, i) => (
            <View
              key={i}
              style={[
                s.between,
                {
                  gap: 15,
                  paddingBottom: 12,
                  borderBottomWidth: i === suggestions.length - 1 ? 0 : 1,
                  borderColor: C.line,
                },
              ]}
            >
              <View style={[s.row, { gap: 10, flex: 1 }]}>
                <Icon name="ArrowUpRight" color={C.green} />
                <Txt style={{ flex: 1, lineHeight: 23 }}>
                  <Txt style={{ fontFamily: "DMBold" }}>{name(r.from_id)}</Txt>{" "}
                  owes{" "}
                  <Txt style={{ fontFamily: "DMBold" }}>{name(r.to_id)}</Txt>
                </Txt>
              </View>
              <Txt style={{ fontFamily: "DMBold", fontSize: 18 }}>
                {fmt(r.cents)}
              </Txt>
            </View>
          ))
        ) : (
          <Empty
            title="Everyone’s even"
            description="No settling needed. Your household is all caught up."
          />
        )}
        <View
          style={[
            s.row,
            { gap: 9, backgroundColor: C.sage, padding: 13, borderRadius: 9 },
          ]}
        >
          <Icon name="Info" color={C.green} size={17} />
          <Txt
            style={{ fontSize: 11, lineHeight: 18, color: C.green, flex: 1 }}
          >
            SplitCart calculates balances and records payments. Use Manage
            payments for bank/card payments, or pay your roommate outside the
            app and record it here. Never record a bank/card payment a second
            time.
          </Txt>
        </View>
      </View>
      <Title style={{ fontSize: 24 }}>Repayment history</Title>
      <View style={[s.card, { gap: 16 }]}>
        {st.repayments.length ? (
          st.repayments.map((r) => (
            <View key={r.id} style={[s.between, { gap: 10 }]}>
              <View style={[s.row, { gap: 12, flex: 1 }]}>
                <View
                  style={{
                    backgroundColor: C.sage,
                    padding: 10,
                    borderRadius: 10,
                  }}
                >
                  <Icon name="Check" color={C.green} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontFamily: "DMSemi", fontSize: 13 }}>
                    {name(r.from_id)} paid {name(r.to_id)}
                  </Txt>
                  <Txt style={{ fontSize: 10, color: C.muted, marginTop: 5 }}>
                    Recorded payment · {shortDate(r.date)}
                  </Txt>
                </View>
              </View>
              <Txt style={{ fontFamily: "DMBold" }}>{fmt(r.cents)}</Txt>
            </View>
          ))
        ) : (
          <Txt style={s.muted}>
            Repayments will appear here. Record an outside payment manually, or
            use Manage payments for bank/card payments.
          </Txt>
        )}
      </View>
    </>
  );
}
function PurchaseEditor({
  expense,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const st = useStore();
  const self = st.members.find((m) => m.user_id === st.user?.id);
  const [id] = useState(expense?.id || uid());
  const [name, setName] = useState(expense?.name || ""),
    [amount, setAmount] = useState(
      expense ? (expense.cents / 100).toFixed(2) : "",
    ),
    [date, setDate] = useState(expense?.date || today()),
    [store, setStore] = useState(expense?.store || ""),
    [notes, setNotes] = useState(expense?.notes || ""),
    [category, setCategory] = useState(expense?.category || "Groceries"),
    [paidBy, setPaidBy] = useState(expense?.paid_by || self?.id || ""),
    [selected, setSelected] = useState(
      expense?.shares.map((s) => s.member_id) ||
        st.members.filter((m) => !m.left_at).map((m) => m.id),
    ),
    [custom, setCustom] = useState(
      Boolean(
        expense &&
        JSON.stringify(
          [...expense.shares].sort((a, b) =>
            a.member_id.localeCompare(b.member_id),
          ),
        ) !==
          JSON.stringify(
            equalSplit(
              expense.cents,
              expense.shares.map((s) => s.member_id),
            ),
          ),
      ),
    ),
    [customAmounts, setCustomAmounts] = useState<Record<string, string>>(
      Object.fromEntries(
        expense?.shares.map((s) => [s.member_id, (s.cents / 100).toFixed(2)]) ||
          [],
      ),
    ),
    [receipt, setReceipt] = useState(expense?.receipt || null),
    [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const uploaded = useRef<string | null>(null);
  const available = st.members.filter(
    (m) =>
      !m.left_at ||
      expense?.shares.some((s) => s.member_id === m.id) ||
      expense?.paid_by === m.id,
  );
  let cents = 0;
  try {
    cents = parseMoney(amount);
  } catch {}
  let shares = equalSplit(1, ["preview"]);
  try {
    shares = custom
      ? selected.map((member_id) => ({
          member_id,
          cents: parseMoney(customAmounts[member_id] || "", true),
        }))
      : equalSplit(cents, selected);
  } catch {
    shares = [];
  }
  const pick = async (camera: boolean) => {
    setError("");
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Allow photo access in your device settings to add a receipt.",
        );
      const result = camera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.8,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.8,
          });
      if (!result.canceled) {
        const a = result.assets[0];
        if (a.fileSize) validateImage(a.mimeType || "image/jpeg", a.fileSize);
        setAsset(a);
        setReceipt(a.uri);
        uploaded.current = null;
      }
    } catch (e: any) {
      setError(e.message);
    }
  };
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { validateExpense } = await import("./src/core");
      const purchase: Expense = {
        id,
        household_id: st.household!.id,
        name: name.trim(),
        cents: parseMoney(amount),
        date,
        paid_by: paidBy,
        category,
        store: store.trim(),
        notes: notes.trim(),
        receipt,
        shares,
        created_at: expense?.created_at || new Date().toISOString(),
      };
      validateExpense(purchase, st.members);
      if (asset) {
        if (st.demo) {
          if (Platform.OS === "web") {
            const response = await fetch(asset.uri);
            const blob = await response.blob();
            validateImage(asset.mimeType || blob.type, blob.size);
            purchase.receipt = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } else {
            const { File } = await import("expo-file-system");
            const file = new File(asset.uri);
            validateImage(asset.mimeType || "image/jpeg", file.size);
            purchase.receipt = `data:${asset.mimeType || "image/jpeg"};base64,${await file.base64()}`;
          }
        } else {
          if (!uploaded.current)
            uploaded.current = await uploadReceipt(
              asset,
              st.household!.id,
              st.user!.id,
            );
          purchase.receipt = uploaded.current;
        }
      }
      await st.saveExpense(purchase);
      onSaved();
    } catch (e: any) {
      setError(e.message || "Couldn’t save this purchase. Please try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={expense ? "Edit purchase" : "Add a purchase"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Txt style={s.muted}>Big shop or small thing, every share counts.</Txt>
      <Field
        label="What did you buy? *"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Weekly grocery run"
      />
      <View style={[s.row, { gap: 14, alignItems: "flex-start" }]}>
        <Field
          label={`Total (${st.household?.currency}) *`}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Field
          label="Purchase date *"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
        />
      </View>
      <View style={{ gap: 9 }}>
        <Txt style={{ fontFamily: "DMBold", fontSize: 12 }}>Who paid? *</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {available.map((m) => (
            <Chip
              label={m.name.split(" ")[0] + (m.id === self?.id ? " (you)" : "")}
              key={m.id}
              active={paidBy === m.id}
              onPress={() => setPaidBy(m.id)}
            />
          ))}
        </View>
        {paidBy !== self?.id && (
          <Txt style={{ fontSize: 11, color: C.muted }}>
            Only the roommate who paid can edit or delete this purchase.
          </Txt>
        )}
      </View>
      <Field
        label="Store (optional)"
        value={store}
        onChangeText={setStore}
        placeholder="Where did you shop?"
      />
      <View style={{ gap: 9 }}>
        <Txt style={{ fontFamily: "DMBold", fontSize: 12 }}>Category</Txt>
        <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>
      </View>
      <View style={s.divider} />
      <View style={s.between}>
        <Title style={{ fontSize: 22 }}>Split with</Title>
        <View style={[s.row, { gap: 7 }]}>
          <Chip
            label="Equally"
            active={!custom}
            onPress={() => setCustom(false)}
          />
          <Chip
            label="Custom"
            active={custom}
            onPress={() => {
              setCustom(true);
              if (!Object.keys(customAmounts).length)
                setCustomAmounts(
                  Object.fromEntries(
                    shares.map((s) => [
                      s.member_id,
                      (s.cents / 100).toFixed(2),
                    ]),
                  ),
                );
            }}
          />
        </View>
      </View>
      <View style={{ gap: 12 }}>
        {available.map((m, i) => (
          <View key={m.id} style={[s.row, { gap: 11 }]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Split with ${m.name}`}
              accessibilityState={{ checked: selected.includes(m.id) }}
              onPress={() =>
                setSelected(
                  selected.includes(m.id)
                    ? selected.filter((x) => x !== m.id)
                    : [...selected, m.id],
                )
              }
              style={[s.row, { gap: 10, flex: 1, minHeight: 44 }]}
            >
              <View
                style={{
                  width: 21,
                  height: 21,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: selected.includes(m.id) ? C.green : C.line,
                  backgroundColor: selected.includes(m.id) ? C.green : C.white,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {selected.includes(m.id) && (
                  <Icon name="Check" size={14} color={C.white} />
                )}
              </View>
              <Avatar name={m.name} index={i} size={30} />
              <Txt style={{ fontSize: 12, flex: 1 }}>
                {m.name}
                {m.left_at ? " · former" : ""}
              </Txt>
            </Pressable>
            {selected.includes(m.id) &&
              (custom ? (
                <TextInput
                  accessibilityLabel={`${m.name} custom share`}
                  keyboardType="decimal-pad"
                  value={customAmounts[m.id] || ""}
                  placeholder="0.00"
                  onChangeText={(v) =>
                    setCustomAmounts({ ...customAmounts, [m.id]: v })
                  }
                  style={{
                    borderWidth: 1,
                    borderColor: C.line,
                    borderRadius: 7,
                    padding: 10,
                    width: 95,
                    fontFamily: "DM",
                    color: C.ink,
                    textAlign: "right",
                  }}
                />
              ) : (
                <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                  {money(
                    shares.find((s) => s.member_id === m.id)?.cents || 0,
                    st.household?.currency,
                  )}
                </Txt>
              ))}
          </View>
        ))}
      </View>
      <View
        style={[
          s.between,
          { backgroundColor: C.sage, padding: 13, borderRadius: 9 },
        ]}
      >
        <Txt style={{ fontSize: 12, color: C.green }}>
          Total split · {selected.length} roommates
        </Txt>
        <Txt style={{ fontFamily: "DMBold", color: C.green }}>
          {money(
            shares.reduce((n, s) => n + s.cents, 0),
            st.household?.currency,
          )}
        </Txt>
      </View>
      {!custom && (
        <Txt style={{ fontSize: 10, color: C.muted, marginTop: -12 }}>
          Any spare cents are distributed consistently so the shares always
          match.
        </Txt>
      )}
      <View style={s.divider} />
      <View style={{ gap: 12 }}>
        <Title style={{ fontSize: 22 }}>
          Receipt <Txt style={s.muted}>(optional)</Txt>
        </Title>
        {receipt && (
          <View style={[s.row, { gap: 15 }]}>
            {asset ? (
              <Image
                source={{ uri: asset.uri }}
                style={{ height: 100, width: 85, borderRadius: 8 }}
              />
            ) : (
              <ReceiptPhoto
                path={receipt}
                style={{ height: 100, width: 85, borderRadius: 8 }}
              />
            )}
            <Button
              secondary
              small
              label="Remove"
              onPress={() => {
                setReceipt(null);
                setAsset(null);
                uploaded.current = null;
              }}
            />
          </View>
        )}
        <View style={[s.row, { gap: 10 }]}>
          <Button
            secondary
            small
            label="Take photo"
            icon="Camera"
            onPress={() => pick(true)}
          />
          <Button
            secondary
            small
            label="Choose photo"
            icon="ImageIcon"
            onPress={() => pick(false)}
          />
        </View>
        {st.demo && !receipt && (
          <Pressable
            onPress={() => {
              setReceipt(demoReceipt);
              setAsset(null);
            }}
          >
            <Txt style={s.link}>Try a sample receipt</Txt>
          </Pressable>
        )}
        <Txt style={{ fontSize: 10, color: C.muted }}>
          JPEG, PNG or WebP · up to 5 MB · private to your household
        </Txt>
      </View>
      <Field
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Anything your roommates should know?"
        multiline
      />
      {error && (
        <Txt accessibilityRole="alert" style={{ color: C.red, lineHeight: 21 }}>
          {error}
        </Txt>
      )}
      <Button
        label={busy ? "Saving…" : expense ? "Save changes" : "Save purchase"}
        icon="Check"
        loading={busy}
        onPress={save}
      />
    </Sheet>
  );
}
function PurchaseDetail({
  e,
  onClose,
  onEdit,
  onReceipt,
  notify,
}: {
  e: Expense;
  onClose: () => void;
  onEdit: () => void;
  onReceipt: (path: string) => void;
  notify: (s: string) => void;
}) {
  const st = useStore();
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const editable = canEdit(st.user!.id, e, st.members);
  const name = (id: string) =>
    st.members.find((m) => m.id === id)?.name || "Former roommate";
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await st.deleteExpense(e);
      onClose();
      notify("Purchase deleted. Balances have been updated.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Purchase details" onClose={onClose}>
      <View style={{ alignItems: "center", gap: 12 }}>
        <CategoryIcon category={e.category} size={58} />
        <Title style={{ fontSize: 28, textAlign: "center" }}>{e.name}</Title>
        <Txt style={{ fontSize: 35, fontFamily: "DMSemi" }}>
          {money(e.cents, st.household?.currency)}
        </Txt>
        <Txt style={s.muted}>
          {name(e.paid_by)} paid · {shortDate(e.date)}
        </Txt>
        <Chip label={e.category} />
      </View>
      <View style={[s.card, { gap: 15 }]}>
        {e.store && (
          <View style={s.between}>
            <Txt style={s.muted}>Store</Txt>
            <Txt>{e.store}</Txt>
          </View>
        )}
        <View style={s.between}>
          <Txt style={s.muted}>Purchase date</Txt>
          <Txt>{e.date}</Txt>
        </View>
        {e.notes && (
          <>
            <View style={s.divider} />
            <Txt style={{ lineHeight: 22 }}>{e.notes}</Txt>
          </>
        )}
      </View>
      <Title style={{ fontSize: 23 }}>Everyone’s share</Title>
      {e.shares.map((share, i) => (
        <View key={share.member_id} style={[s.row, { gap: 10 }]}>
          <Avatar name={name(share.member_id)} index={i} />
          <Txt style={{ flex: 1 }}>{name(share.member_id)}</Txt>
          <Txt style={{ fontFamily: "DMBold" }}>
            {money(share.cents, st.household?.currency)}
          </Txt>
        </View>
      ))}
      {e.receipt && (
        <>
          <Title style={{ fontSize: 23 }}>The receipt</Title>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open receipt viewer"
            onPress={() => onReceipt(e.receipt!)}
            style={[s.card, { alignItems: "center", gap: 10 }]}
          >
            <ReceiptPhoto
              path={e.receipt}
              style={{ height: 160, width: 120 }}
            />
            <Txt style={s.link}>View full receipt ↗</Txt>
          </Pressable>
        </>
      )}
      {editable && (
        <>
          <View style={s.divider} />
          {confirm ? (
            <View style={{ gap: 14 }}>
              <Txt style={{ color: C.red }}>
                Delete this purchase? Its shares will be removed and everyone’s
                balance will change.
              </Txt>
              <View style={[s.row, { gap: 10 }]}>
                <Button
                  label="Keep purchase"
                  secondary
                  onPress={() => setConfirm(false)}
                  disabled={busy}
                />
                <Button
                  danger
                  label="Delete purchase"
                  icon="Trash2"
                  onPress={remove}
                  loading={busy}
                />
              </View>
            </View>
          ) : (
            <View style={[s.row, { gap: 12 }]}>
              <Button
                secondary
                label="Edit purchase"
                icon="Pencil"
                onPress={onEdit}
              />
              <Button
                danger
                label="Delete"
                icon="Trash2"
                onPress={() => setConfirm(true)}
              />
            </View>
          )}
        </>
      )}
      {error && <Txt style={{ color: C.red }}>{error}</Txt>}
    </Sheet>
  );
}
function RepayModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const st = useStore();
  const self = st.members.find((m) => m.user_id === st.user?.id)!;
  const suggestions = settlements(
    balances(st.members, st.expenses, st.repayments),
  );
  const suggestion =
    suggestions.find((r) => r.from_id === self.id || r.to_id === self.id) ||
    suggestions[0];
  const [from, setFrom] = useState(suggestion?.from_id || self.id),
    [to, setTo] = useState(
      suggestion?.to_id || st.members.find((m) => m.id !== self.id)?.id || "",
    ),
    [amount, setAmount] = useState(
      suggestion ? (suggestion.cents / 100).toFixed(2) : "",
    ),
    [date, setDate] = useState(today()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [id] = useState(uid());
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (from === to) throw new Error("Choose two different roommates.");
      if (from !== self.id && to !== self.id)
        throw new Error("You can only record repayments you sent or received.");
      if (!validDate(date))
        throw new Error("Use a valid date in YYYY-MM-DD format.");
      await st.repay({
        id,
        household_id: st.household!.id,
        from_id: from,
        to_id: to,
        cents: parseMoney(amount),
        date,
        recorded_by: st.user!.id,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  return (
    <Sheet
      title="Record a repayment"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <View
        style={{
          backgroundColor: C.sage,
          padding: 15,
          borderRadius: 10,
          gap: 7,
        }}
      >
        <Txt style={{ fontFamily: "DMBold", color: C.green }}>
          Already paid your roommate?
        </Txt>
        <Txt style={{ fontSize: 12, color: C.green, lineHeight: 20 }}>
          Record a payment you sent or received outside SplitCart. This does not
          transfer money.
        </Txt>
      </View>
      <Txt style={s.label}>WHO SENT IT?</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {st.members.map((m) => (
          <Chip
            key={m.id}
            label={m.name.split(" ")[0] + (m.left_at ? " (former)" : "")}
            active={from === m.id}
            onPress={() => setFrom(m.id)}
          />
        ))}
      </View>
      <Txt style={s.label}>WHO RECEIVED IT?</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {st.members.map((m) => (
          <Chip
            key={m.id}
            label={m.name.split(" ")[0] + (m.left_at ? " (former)" : "")}
            active={to === m.id}
            onPress={() => setTo(m.id)}
          />
        ))}
      </View>
      <Field
        label={`Amount (${st.household?.currency})`}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      <Field
        label="Payment date"
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
      />
      {error && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      )}
      <Button
        label="Confirm recorded payment"
        icon="Check"
        loading={busy}
        onPress={save}
      />
    </Sheet>
  );
}
function HouseholdSettings({ notify }: { notify: (m: string) => void }) {
  const st = useStore();
  const self = st.members.find((m) => m.user_id === st.user?.id)!;
  const [name, setName] = useState(self.name),
    [busy, setBusy] = useState(false),
    [leave, setLeave] = useState(false),
    [error, setError] = useState(""),
    [reset, setReset] = useState(false);
  const run = async (action: () => Promise<any>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      notify(message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <View>
        <Title>Your household</Title>
        <Txt style={{ color: C.muted, marginTop: 8 }}>
          The people who make your place, your place.
        </Txt>
      </View>
      <View style={[s.card, { gap: 20 }]}>
        <View style={[s.row, { gap: 16 }]}>
          <View
            style={{ padding: 17, borderRadius: 13, backgroundColor: C.sage }}
          >
            <Icon name="Home" color={C.green} size={28} />
          </View>
          <View style={{ flex: 1 }}>
            <Title style={{ fontSize: 25 }}>{st.household?.name}</Title>
            <Txt style={{ color: C.muted, fontSize: 12, marginTop: 5 }}>
              {st.household?.currency} · One household, one currency
            </Txt>
          </View>
        </View>
        <View style={s.divider} />
        <Txt style={s.label}>YOUR ROOMMATES</Txt>
        {st.members.map((m, i) => (
          <View key={m.id} style={[s.row, { gap: 12 }]}>
            <Avatar name={m.name} index={i} size={40} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: "DMSemi" }}>
                {m.name}
                {m.user_id === st.user?.id ? " (you)" : ""}
              </Txt>
              <Txt style={[s.muted, { marginTop: 4 }]}>
                {m.left_at
                  ? "Former roommate · history preserved"
                  : "Household member"}
              </Txt>
            </View>
            <Icon
              name={m.left_at ? "LogOut" : "CheckCircle2"}
              size={18}
              color={m.left_at ? C.muted : "#93AE83"}
            />
          </View>
        ))}
      </View>
      <View style={[s.card, { gap: 14 }]}>
        <Title style={{ fontSize: 23 }}>Make room for one more</Title>
        <Txt style={{ color: C.muted, fontSize: 12, lineHeight: 20 }}>
          Share this invitation code privately with your new roommate. They can
          enter it when joining a household.
        </Txt>
        <View
          style={[
            s.between,
            { backgroundColor: C.sage, padding: 17, borderRadius: 10 },
          ]}
        >
          <Txt
            selectable
            style={{
              fontFamily: "DMBold",
              letterSpacing: 2,
              fontSize: 18,
              color: C.green,
            }}
          >
            {st.household?.invite_code}
          </Txt>
          <Icon name="Link" size={20} color={C.green} />
        </View>
        {st.demo && (
          <Txt style={{ fontSize: 11, color: C.muted }}>
            Sample code only. Enable live accounts to invite real roommates.
          </Txt>
        )}
      </View>
      <View style={[s.card, { gap: 17 }]}>
        <Title style={{ fontSize: 23 }}>Your profile</Title>
        <Field label="Display name" value={name} onChangeText={setName} />
        <Button
          label="Save profile"
          secondary
          icon="Check"
          loading={busy}
          onPress={() =>
            run(() => st.profile(name), "Your profile has been updated.")
          }
          style={{ alignSelf: "flex-start" }}
        />
      </View>
      <View style={[s.card, { gap: 16 }]}>
        <Title style={{ fontSize: 23 }}>Settings</Title>
        <Txt style={{ fontSize: 12, color: C.muted, lineHeight: 20 }}>
          {st.demo
            ? "You’re exploring SplitCart with a sample household. Demo changes are saved on this device."
            : "You’re using a live Supabase household. Pull down on a screen to refresh shared activity."}
        </Txt>
        <Button
          secondary
          icon="RefreshCw"
          label={st.demo ? "Switch to live accounts" : "Explore demo mode"}
          onPress={st.switchMode}
        />
        {!liveConfigured && st.demo && (
          <Txt style={{ fontSize: 11, color: C.muted, lineHeight: 18 }}>
            Live setup: add your Supabase URL and public anon key to .env, apply
            the migration, then restart Expo. Full steps are in the README.
          </Txt>
        )}
        {st.demo && (
          <Button
            secondary
            label="Reset demo data"
            onPress={() => setReset(true)}
          />
        )}
        <Button
          secondary
          label="Sign out"
          icon="LogOut"
          onPress={() => run(st.signOut, "Signed out.")}
        />
        <View style={s.divider} />
        <Txt style={{ fontSize: 12, color: C.muted, lineHeight: 20 }}>
          Leaving preserves all purchases, shares, and repayments for the
          remaining household members. You’ll lose access to this household and
          its receipts.
        </Txt>
        <Button
          danger
          label="Leave household"
          icon="LogOut"
          onPress={() => setLeave(true)}
          style={{ alignSelf: "flex-start" }}
        />
        {error && <Txt style={{ color: C.red }}>{error}</Txt>}
      </View>
      {leave && (
        <Sheet title="Leave this household?" onClose={() => setLeave(false)}>
          <Txt style={{ lineHeight: 23 }}>
            Your expense and repayment history will stay with{" "}
            {st.household?.name}. Any outstanding balance still needs to be
            settled. You can rejoin later using an invitation code.
          </Txt>
          <Button
            danger
            label="Confirm leave household"
            loading={busy}
            onPress={() => run(st.leave, "You’ve left the household.")}
          />
          <Button secondary label="Stay home" onPress={() => setLeave(false)} />
        </Sheet>
      )}
      {reset && (
        <Sheet title="Reset the demo?" onClose={() => setReset(false)}>
          <Txt>
            This will replace your demo changes with the original sample
            household.
          </Txt>
          <Button
            label="Reset demo"
            loading={busy}
            onPress={() =>
              run(async () => {
                await st.reset();
                setReset(false);
              }, "Demo reset. Fresh start!")
            }
          />
          <Button
            secondary
            label="Keep my changes"
            onPress={() => setReset(false)}
          />
        </Sheet>
      )}
    </>
  );
}
function HouseholdSetup() {
  const st = useStore();
  const [join, setJoin] = useState(false),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [currency, setCurrency] = useState("USD"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (join ? !code.trim() : !name.trim())
        throw new Error(
          join ? "Enter your invitation code." : "Give your household a name.",
        );
      await st.householdAction(name, join ? code : "", currency);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ maxWidth: 450, width: "100%", gap: 24 }}>
          <Logo />
          <View style={{ alignItems: "center" }}>
            <Illustration />
          </View>
          <Title style={{ textAlign: "center" }}>
            Every good home starts here.
          </Title>
          <Txt style={{ textAlign: "center", color: C.muted, lineHeight: 23 }}>
            Create your shared space or join your roommates. We’ll handle the
            splitting.
          </Txt>
          <View style={[s.row, { gap: 10, justifyContent: "center" }]}>
            <Chip
              label="Create a household"
              active={!join}
              onPress={() => setJoin(false)}
            />
            <Chip
              label="Join a household"
              active={join}
              onPress={() => setJoin(true)}
            />
          </View>
          {join ? (
            <Field
              label="Invitation code"
              value={code}
              onChangeText={setCode}
              placeholder="Your roommate’s invitation code"
            />
          ) : (
            <>
              <Field
                label="Household name"
                value={name}
                onChangeText={setName}
                placeholder="e.g. The Green House"
              />
              <Txt style={s.label}>HOUSEHOLD CURRENCY</Txt>
              <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
                {["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    active={currency === c}
                    onPress={() => setCurrency(c)}
                  />
                ))}
              </View>
              <Txt style={s.muted}>
                All purchases use this currency. No currency conversion.
              </Txt>
            </>
          )}
          {(error || st.error) && (
            <Txt accessibilityRole="alert" style={{ color: C.red }}>
              {error || st.error}
            </Txt>
          )}
          <Button
            label={join ? "Join household" : "Create household"}
            icon="ArrowRight"
            loading={busy}
            onPress={save}
          />
          <Button secondary label="Sign out" onPress={st.signOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
function Auth() {
  const st = useStore();
  const [signup, setSignup] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const submit = async () => {
    if (busy) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (signup && !name.trim()) throw new Error("Tell us your name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Enter a valid email address.");
      if (password.length < 8)
        throw new Error("Use a password with at least 8 characters.");
      const c = client();
      const { data, error } = signup
        ? await c.auth.signUp({
            email: email.trim(),
            password,
            options: { data: { name: name.trim() } },
          })
        : await c.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      if (signup && !data.session)
        setMessage(
          "Check your email to confirm your account, then come back and log in.",
        );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 26,
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View style={{ width: "100%", maxWidth: 420, gap: 21 }}>
          <Logo />
          <View style={{ alignItems: "center", marginVertical: 4 }}>
            <Illustration />
          </View>
          <Title style={{ fontSize: 37, textAlign: "center" }}>
            {signup ? "A happier home starts here." : "Welcome home."}
          </Title>
          <Txt style={{ textAlign: "center", color: C.muted, lineHeight: 22 }}>
            Shared purchases. Fair splits. More time for the good stuff.
          </Txt>
          {signup && (
            <Field
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder="Alex Morgan"
            />
          )}
          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="At least 8 characters"
          />
          {error && (
            <Txt
              accessibilityRole="alert"
              style={{ color: C.red, lineHeight: 22 }}
            >
              {error}
            </Txt>
          )}
          {message && (
            <Txt style={{ color: C.green, lineHeight: 22 }}>{message}</Txt>
          )}
          <Button
            label={signup ? "Create account" : "Log in"}
            icon="ArrowRight"
            loading={busy}
            onPress={submit}
          />
          <Pressable
            onPress={() => {
              setSignup(!signup);
              setError("");
              setMessage("");
            }}
          >
            <Txt style={{ textAlign: "center", fontSize: 12, color: C.green }}>
              {signup
                ? "Already at home here? Log in"
                : "New to SplitCart? Create an account"}
            </Txt>
          </Pressable>
          <View style={s.divider} />
          <Button
            secondary
            label="Explore the demo"
            icon="Leaf"
            onPress={st.switchMode}
          />
          <Txt style={{ fontSize: 10, color: C.muted, textAlign: "center" }}>
            A sample home, ready to explore. No account needed.
          </Txt>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
