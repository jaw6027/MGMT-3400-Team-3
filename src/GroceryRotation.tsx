import React, { useEffect, useRef, useState } from "react";
import { AppState, ScrollView, View } from "react-native";
import { useStore } from "./store";
import { uid } from "./backend";
import { Expense, Member, ShoppingItem, money } from "./core";
import {
  Essential,
  GroceryCommand,
  GroceryEvent,
  GroceryState,
  groceryQueue,
  groceryToday,
  restockOwner,
  upcomingGroceries,
} from "./grocery";
import { shoppingCategories } from "./shopping";
import {
  Avatar,
  Button,
  C,
  Chip,
  Field,
  Icon,
  Sheet,
  s,
  Title,
  Txt,
} from "./ui";

function useGroceryDay() {
  const [day, setDay] = useState(groceryToday());
  useEffect(() => {
    const update = () => setDay(groceryToday());
    const timer = setInterval(update, 30000);
    const listener = AppState.addEventListener("change", update);
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, []);
  return day;
}
export function GroceryNextCard({ onOpen }: { onOpen: () => void }) {
  const st = useStore();
  const day = useGroceryDay();
  const state: GroceryState = st.grocery;
  const upcoming = upcomingGroceries(state, st.members, 2);
  const name = (id: string) =>
    (st.members as Member[]).find((m) => m.id === id)?.name ||
    "Choose participants";
  return (
    <View style={[s.card, { gap: 12 }]}>
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="ShoppingBasket" color={C.green} />
        <Title style={{ fontSize: 23 }}>Who's up next?</Title>
      </View>
      {upcoming.length ? (
        <>
          <Txt style={{ fontFamily: "DMSemi" }}>
            {name(upcoming[0].memberId)} ·{" "}
            {upcoming[0].due <= day
              ? "Current grocery turn"
              : `Starts ${upcoming[0].due}`}
          </Txt>
          <Txt style={s.muted}>
            Next: {name(upcoming[1].memberId)} · {upcoming[1].due} · Shopping
            duties are separate from bill shares.
          </Txt>
        </>
      ) : (
        <Txt style={s.muted}>
          Take turns shopping and keep household essentials stocked.
        </Txt>
      )}
      <Button
        secondary
        small
        label={
          state.rotation
            ? "View grocery turns & restock"
            : "Set up grocery rotation"
        }
        onPress={onOpen}
      />
    </View>
  );
}
export default function GroceryRotation({
  onShopping,
  onPurchase,
  onTripExpense,
  onOpenExpense,
}: {
  onShopping: () => void;
  onPurchase: (item: ShoppingItem) => void;
  onTripExpense: (id: string) => void;
  onOpenExpense: (expense: Expense) => void;
}) {
  const st = useStore();
  const g: GroceryState = st.grocery;
  const members: Member[] = st.members;
  const active = members.filter((m) => !m.left_at);
  const self = active.find((m) => m.user_id === st.user?.id);
  const day = useGroceryDay();
  const queue = groceryQueue(g.rotation?.queue || [], members);
  const owner = active.find((m) => m.id === queue[0]);
  const mine = self?.id === owner?.id;
  const name = (id?: string | null) =>
    members.find((m) => m.id === id)?.name || "No active participant";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const submission = useRef(false);
  const [config, setConfig] = useState(false),
    [participants, setParticipants] = useState<string[]>([]),
    [days, setDays] = useState("7"),
    [due, setDue] = useState(day),
    [mode, setMode] = useState<"grocery" | "separate">("grocery"),
    [restockMembers, setRestockMembers] = useState<string[]>([]),
    [restockDays, setRestockDays] = useState("7"),
    [restockStart, setRestockStart] = useState(day);
  const [editing, setEditing] = useState<Essential | null>(null),
    [label, setLabel] = useState(""),
    [category, setCategory] = useState("Household Items"),
    [quantity, setQuantity] = useState(""),
    [notes, setNotes] = useState("");
  const [filter, setFilter] = useState(false),
    [swapOpen, setSwapOpen] = useState(false),
    [swapTarget, setSwapTarget] = useState("");
  const [confirm, setConfirm] = useState<"complete" | "skip" | null>(null);
  const configVersion = useRef(0),
    essentialVersion = useRef(0),
    turnVersion = useRef(0);
  const run = async (job: () => Promise<unknown>, success = "") => {
    if (submission.current) return;
    submission.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await job();
      setNotice(success);
    } catch (e: any) {
      setError(
        e.message || "Couldn't save this change. Refresh and try again.",
      );
      try {
        await st.refresh();
      } catch {
        /* Preserve the original action error. */
      }
    } finally {
      submission.current = false;
      setBusy(false);
    }
  };
  const action = (command: GroceryCommand, version = g.version) =>
    st.groceryAction(command, version);
  const startConfig = () => {
    const r = g.rotation;
    setParticipants(
      r ? groceryQueue(r.queue, members) : active.slice(0, 3).map((m) => m.id),
    );
    setRestockMembers(
      r
        ? groceryQueue(r.restockQueue, members)
        : active.slice(0, 3).map((m) => m.id),
    );
    setDays(String(r?.days || 7));
    setDue(r?.due || day);
    setMode(r?.mode || "grocery");
    setRestockDays(String(r?.restockDays || 7));
    setRestockStart(r?.restockStart || day);
    configVersion.current = g.version;
    setError("");
    setConfig(true);
  };
  const editEssential = (item?: Essential) => {
    setEditing(
      item || {
        id: uid(),
        name: "",
        category: "Household Items",
        quantity: "",
        notes: "",
        low: false,
        shoppingId: null,
        lastPurchased: null,
      },
    );
    setLabel(item?.name || "");
    setCategory(item?.category || "Household Items");
    setQuantity(item?.quantity || "");
    setNotes(item?.notes || "");
    essentialVersion.current = g.version;
    setError("");
  };
  const selectMember = (
    id: string,
    list: string[],
    set: (value: string[]) => void,
  ) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const roster = (list: string[], set: (value: string[]) => void) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {active.map((m) => (
        <Chip
          key={m.id}
          label={`${list.includes(m.id) ? `${list.indexOf(m.id) + 1}. ` : ""}${m.name}`}
          active={list.includes(m.id)}
          onPress={() => selectMember(m.id, list, set)}
        />
      ))}
    </View>
  );
  const message = error ? (
    <Txt accessibilityRole="alert" style={{ color: C.red, lineHeight: 21 }}>
      {error}
    </Txt>
  ) : null;
  const pending = g.swaps.filter(
    (s) =>
      s.status === "pending" &&
      s.turn === g.rotation?.turn &&
      queue.includes(s.to) &&
      queue[0] === s.from,
  );
  const low = g.essentials.filter((e) => e.low);
  const completed = g.history.filter((e) => e.kind === "complete");
  const describeEvent = (e: GroceryEvent) => {
    if (e.kind === "complete")
      return `${name(e.actor)} completed a grocery trip`;
    if (e.kind === "skip")
      return `${name(e.actor)} skipped a turn and moved to the end of the queue`;
    if (e.kind === "restock") return `${name(e.actor)} purchased ${e.item}`;
    if (e.kind === "low")
      return `${name(e.actor)} reported ${e.item} running low`;
    if (e.kind === "requestSwap")
      return `${name(e.actor)} requested to swap grocery turns with ${name(e.target)}`;
    if (e.kind === "resolveSwap")
      return `${name(e.actor)} ${e.command?.kind === "resolveSwap" ? { accept: "accepted", decline: "declined", cancel: "canceled" }[e.command.decision] : "resolved"} a turn swap`;
    if (e.kind === "configure")
      return `${name(e.actor)} updated the grocery schedule`;
    return `${name(e.actor)} updated ${e.item || "a household essential"}`;
  };
  return (
    <>
      <View style={[s.between, { gap: 12, flexWrap: "wrap" }]}>
        <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
          <Title style={{ fontSize: 30 }}>Grocery & Restock Rotation</Title>
          <Txt style={s.muted}>
            A fair turn for every roommate. A stocked home for everyone.
          </Txt>
        </View>
        <Button
          label={
            g.rotation ? "Edit grocery schedule" : "Create grocery rotation"
          }
          icon="CalendarDays"
          onPress={startConfig}
        />
      </View>
      <Txt style={{ color: C.muted, fontSize: 12, lineHeight: 19 }}>
        {st.demo
          ? "Demo: schedules and reminders are saved in this browser/device, not shared across devices. Switch preview accounts in Household to try both sides of a swap."
          : "Shared with your live household. Refresh to see other roommates' updates."}{" "}
        Dates use UTC. Reminders are in-app only; no push, email or SMS is sent
        for grocery turns.
      </Txt>
      {message}
      {notice ? (
        <Txt accessibilityLiveRegion="polite" style={{ color: C.green }}>
          {notice}
        </Txt>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Button
          small
          secondary
          label="Open shared shopping list"
          icon="ShoppingBasket"
          onPress={onShopping}
        />
        <Button
          small
          secondary
          label="Refresh grocery rotation"
          icon="RefreshCw"
          loading={busy}
          onPress={() => run(() => st.refresh(), "Grocery rotation refreshed.")}
        />
      </View>
      <View style={[s.card, { gap: 16 }]}>
        <Title style={{ fontSize: 26 }}>Who's up next?</Title>
        {!g.rotation ? (
          <Txt style={s.muted}>
            Create a schedule to choose participants, set a weekly,
            every-two-weeks or custom interval, and assign the first turn.
          </Txt>
        ) : (
          <>
            <View style={[s.row, { gap: 12 }]}>
              <Avatar name={owner?.name || "?"} size={44} />
              <View style={{ flex: 1, gap: 5 }}>
                <Txt style={{ fontSize: 20, fontFamily: "DMBold" }}>
                  {owner?.name || "Choose active participants"}
                </Txt>
                <Txt style={s.muted}>
                  Current turn · {g.rotation.due}{" "}
                  {g.rotation.due <= day ? "· Due now" : "· Upcoming"}
                </Txt>
              </View>
              {mine && (
                <Txt style={{ color: C.green, fontFamily: "DMBold" }}>
                  My Turn
                </Txt>
              )}
            </View>
            <Txt style={s.muted}>
              Next: {name(queue[1] || queue[0])}. Every {g.rotation.days} days.
              Completing a late trip schedules the next one from the completion
              date. Skips keep the due date and move the shopper to the back.
            </Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
              <Button
                label="Mark turn complete"
                icon="Check"
                disabled={!mine || g.rotation.due > day || busy}
                onPress={() => {
                  turnVersion.current = g.version;
                  setConfirm("complete");
                  setError("");
                }}
              />
              <Button
                label="Swap Turn"
                secondary
                disabled={
                  !mine || queue.length < 2 || pending.length > 0 || busy
                }
                onPress={() => {
                  turnVersion.current = g.version;
                  setSwapTarget(queue.find((id) => id !== self?.id) || "");
                  setSwapOpen(true);
                  setError("");
                }}
              />
              <Button
                label="Skip my turn"
                secondary
                disabled={!mine || queue.length < 2 || busy}
                onPress={() => {
                  turnVersion.current = g.version;
                  setConfirm("skip");
                  setError("");
                }}
              />
            </View>
            {!mine && (
              <Txt style={{ fontSize: 12, color: C.muted }}>
                Only the current shopper can complete, skip or request a swap.
              </Txt>
            )}
            {mine && g.rotation.due > day && (
              <Txt style={s.muted}>
                Completion unlocks on the turn's start date. You can request a
                swap now.
              </Txt>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10 }}
            >
              {upcomingGroceries(g, members).map((entry, i) => (
                <View
                  key={i}
                  style={{
                    width: 170,
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: i === 0 ? C.sage : C.bg,
                    gap: 8,
                  }}
                >
                  <Txt style={s.label}>
                    {i === 0 ? "CURRENT" : `UPCOMING ${i}`}
                  </Txt>
                  <Avatar name={name(entry.memberId)} size={30} />
                  <Txt style={{ fontFamily: "DMSemi" }}>
                    {name(entry.memberId)}
                  </Txt>
                  <Txt style={{ fontSize: 12, color: C.muted }}>
                    {entry.due}
                  </Txt>
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </View>
      {pending.map((swap) => (
        <View key={swap.id} style={[s.card, { gap: 12, borderColor: C.green }]}>
          <Title style={{ fontSize: 23 }}>Turn swap awaiting agreement</Title>
          <Txt>
            {name(swap.from)} asked {name(swap.to)} to exchange their current
            and next scheduled turns. Nothing changes until the invited roommate
            accepts.
          </Txt>
          {swap.to === self?.id ? (
            <View style={{ gap: 9 }}>
              <Button
                label="Accept turn swap"
                loading={busy}
                onPress={() =>
                  run(async () => {
                    await action({
                      id: uid(),
                      kind: "resolveSwap",
                      swapId: swap.id,
                      decision: "accept",
                    });
                  }, "Turn swap accepted. The schedule has been updated.")
                }
              />
              <Button
                secondary
                label="Decline turn swap"
                disabled={busy}
                onPress={() =>
                  run(
                    () =>
                      action({
                        id: uid(),
                        kind: "resolveSwap",
                        swapId: swap.id,
                        decision: "decline",
                      }),
                    "Turn swap declined.",
                  )
                }
              />
            </View>
          ) : swap.from === self?.id ? (
            <Button
              secondary
              label="Cancel swap request"
              disabled={busy}
              onPress={() =>
                run(
                  () =>
                    action({
                      id: uid(),
                      kind: "resolveSwap",
                      swapId: swap.id,
                      decision: "cancel",
                    }),
                  "Swap request canceled.",
                )
              }
            />
          ) : (
            <Txt style={s.muted}>Waiting for {name(swap.to)}.</Txt>
          )}
        </View>
      ))}
      <View style={[s.card, { gap: 12, backgroundColor: C.sage }]}>
        <Title style={{ fontSize: 23 }}>Household reminders</Title>
        {owner && (
          <Txt>
            {g.rotation!.due <= day
              ? `Hey ${owner.name.split(" ")[0]}! It's your turn to go grocery shopping 🛒`
              : `${owner.name.split(" ")[0]}, your grocery turn starts ${g.rotation!.due}.`}
          </Txt>
        )}
        {queue[1] && (
          <Txt>
            {name(queue[1])}, you're up next! Your turn is planned for{" "}
            {upcomingGroceries(g, members, 2)[1]?.due}.
          </Txt>
        )}
        <Txt>
          {low.length
            ? `Running low: ${low.map((e) => e.name).join(", ")}.`
            : "No household essentials reported running low."}
        </Txt>
        {g.history
          .filter((e) => ["complete", "requestSwap"].includes(e.kind))
          .slice(0, 3)
          .map((e) => (
            <Txt key={e.id} style={{ fontSize: 12, color: C.muted }}>
              {e.date} · {describeEvent(e)}
            </Txt>
          ))}
      </View>
      <View style={{ gap: 14 }}>
        <View style={[s.between, { gap: 10, flexWrap: "wrap" }]}>
          <Title style={{ fontSize: 26 }}>Household essentials</Title>
          <Button
            secondary
            small
            label="Add custom essential"
            icon="Plus"
            onPress={() => editEssential()}
          />
        </View>
        <Txt style={s.muted}>
          {g.rotation?.mode === "separate"
            ? `Separate restock rotation: each item starts at a different roommate in your chosen order. Responsibilities change every ${g.rotation.restockDays} days from ${g.rotation.restockStart}, independent of grocery trips.`
            : "Grocery Rotation: the current grocery shopper is also responsible for items on the restocking list."}{" "}
          Any roommate can report Running Low. The existing shared Shopping list
          is used, with one active entry per essential.
        </Txt>
        <View style={[s.row, { gap: 8 }]}>
          <Chip
            label="All essentials"
            active={!filter}
            onPress={() => setFilter(false)}
          />
          <Chip
            label={`Running low (${low.length})`}
            active={filter}
            onPress={() => setFilter(true)}
          />
        </View>
        {(filter ? low : g.essentials).map((item) => {
          const responsible = restockOwner(g, item, members, day);
          const shopping = (st.shoppingItems as ShoppingItem[]).find(
            (i) => i.id === item.shoppingId && !i.expense_id,
          );
          return (
            <View key={item.id} style={[s.card, { gap: 12 }]}>
              <View style={[s.between, { gap: 10 }]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt style={{ fontFamily: "DMBold", fontSize: 18 }}>
                    {item.name}
                  </Txt>
                  <Txt style={s.muted}>
                    {item.category} ·{" "}
                    {item.low
                      ? "Running low · On shared shopping list"
                      : "Not flagged low"}
                  </Txt>
                </View>
                <Avatar name={name(responsible)} size={34} />
              </View>
              <Txt style={{ fontSize: 12, color: C.muted }}>
                Responsible: {name(responsible)}
                {item.quantity
                  ? ` · Remaining: ${item.quantity}`
                  : " · Quantity not entered"}
              </Txt>
              <Txt style={{ fontSize: 12, color: C.muted }}>
                Last purchased: {item.lastPurchased || "Not recorded"}
              </Txt>
              {item.notes ? (
                <Txt style={{ fontSize: 13 }}>Shopping note: {item.notes}</Txt>
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Button
                  small
                  secondary
                  label={item.low ? "On restocking list" : "Running Low"}
                  accessibilityLabel={`Running Low ${item.name}`}
                  disabled={item.low || !g.rotation || busy}
                  onPress={() =>
                    run(
                      () =>
                        action({
                          id: uid(),
                          kind: "low",
                          essentialId: item.id,
                          shoppingId: uid(),
                        }),
                      `${item.name} is on the shared shopping list.`,
                    )
                  }
                />
                <Button
                  small
                  secondary
                  label="Edit details"
                  accessibilityLabel={`Edit ${item.name} details`}
                  disabled={busy}
                  onPress={() => editEssential(item)}
                />
                {item.low && shopping && (
                  <Button
                    small
                    label="Mark as Purchased"
                    accessibilityLabel={`Mark ${item.name} as purchased`}
                    disabled={responsible !== self?.id || busy}
                    onPress={() =>
                      onPurchase({
                        ...shopping,
                        assigned_to: responsible || shopping.assigned_to,
                      })
                    }
                  />
                )}
              </View>
              {item.low && responsible !== self?.id && (
                <Txt style={{ fontSize: 12, color: C.muted }}>
                  {name(responsible)} can record this restock purchase. The
                  payer and expense shares are chosen separately.
                </Txt>
              )}
            </View>
          );
        })}
        {filter && low.length === 0 && (
          <Txt style={s.muted}>
            All clear — report an essential when it starts running low.
          </Txt>
        )}
      </View>
      <View style={[s.card, { gap: 14 }]}>
        <Title style={{ fontSize: 26 }}>Sharing the responsibility</Title>
        <Txt style={s.muted}>
          {completed.length} completed grocery trip
          {completed.length === 1 ? "" : "s"}. Completed trips count toward this
          summary; skips and swaps do not. Shopping duties never decide who owes
          money.
        </Txt>
        {members.map((m) => (
          <View key={m.id} style={[s.row, { gap: 10 }]}>
            <Avatar name={m.name} size={30} />
            <Txt style={{ flex: 1 }}>
              {m.name}
              {m.left_at ? " (former roommate)" : ""}
            </Txt>
            <Txt style={{ fontFamily: "DMBold" }}>
              {completed.filter((e) => e.actor === m.id).length} trips
            </Txt>
          </View>
        ))}
      </View>
      <View style={{ gap: 14 }}>
        <Title style={{ fontSize: 26 }}>Grocery & restock history</Title>
        <Txt style={s.muted}>
          Record each receipt once. If you already logged its restock purchases,
          do not record the same spending again as a grocery-trip expense.
        </Txt>
        {!g.history.length && (
          <Txt style={s.muted}>
            Completed trips, restocks, skips and swap decisions will appear
            here.
          </Txt>
        )}
        {g.history.map((e) => {
          const expenses = (st.expenses as Expense[]).filter(
            (x) => x.grocery_trip_id === e.id || x.id === e.expenseId,
          );
          return (
            <View key={e.id} style={[s.card, { gap: 10 }]}>
              <Txt style={{ fontFamily: "DMSemi" }}>{describeEvent(e)}</Txt>
              <Txt style={s.muted}>
                {e.date} ·{" "}
                {e.kind === "complete"
                  ? "Trip completed; spending is recorded separately."
                  : "Household activity"}
              </Txt>
              {expenses.map((expense) => (
                <Button
                  key={expense.id}
                  secondary
                  small
                  label={`View ${expense.name} · ${money(expense.cents, st.household?.currency)}`}
                  onPress={() => onOpenExpense(expense)}
                />
              ))}
              {e.kind === "restock" && !expenses.length && (
                <Txt style={s.muted}>The linked expense was removed.</Txt>
              )}
              {e.kind === "complete" && e.actor === self?.id && (
                <Button
                  secondary
                  small
                  label={
                    expenses.length
                      ? "Record another grocery expense"
                      : "Record shared grocery expense"
                  }
                  onPress={() => onTripExpense(e.id)}
                />
              )}
            </View>
          );
        })}
      </View>
      {config && (
        <Sheet
          title="Grocery rotation schedule"
          onClose={() => {
            if (!busy) setConfig(false);
          }}
        >
          <Txt style={s.label}>GROCERY PARTICIPANTS · TURN ORDER</Txt>
          {roster(participants, setParticipants)}
          <Txt style={s.muted}>
            Tap names to include/remove them. New schedules use the order
            selected; edits retain existing participants' order and append
            newcomers. Schedule changes expire pending swaps and preserve
            history.
          </Txt>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Chip
              label="Weekly"
              active={days === "7"}
              onPress={() => setDays("7")}
            />
            <Chip
              label="Every two weeks"
              active={days === "14"}
              onPress={() => setDays("14")}
            />
            <Chip
              label="Custom schedule"
              active={!["7", "14"].includes(days)}
              onPress={() => setDays("10")}
            />
          </View>
          <Field
            label="Days between grocery trips (1–365)"
            value={days}
            onChangeText={setDays}
            keyboardType="number-pad"
            maxLength={3}
          />
          <Field
            label="First/current grocery turn date (YYYY-MM-DD, UTC)"
            value={due}
            onChangeText={setDue}
            maxLength={10}
          />
          <Txt style={s.label}>WHO RESTOCKS ESSENTIALS?</Txt>
          <Chip
            label="Option A: Grocery Rotation"
            active={mode === "grocery"}
            onPress={() => setMode("grocery")}
          />
          <Chip
            label="Option B: Separate Restock Rotation"
            active={mode === "separate"}
            onPress={() => setMode("separate")}
          />
          {mode === "separate" && (
            <>
              <Txt style={s.label}>RESTOCK PARTICIPANTS · ROTATION ORDER</Txt>
              {roster(restockMembers, setRestockMembers)}
              <Field
                label="Days between restock assignments (1–365)"
                value={restockDays}
                onChangeText={setRestockDays}
                keyboardType="number-pad"
                maxLength={3}
              />
              <Field
                label="Restock rotation starts (YYYY-MM-DD, UTC)"
                value={restockStart}
                onChangeText={setRestockStart}
                maxLength={10}
              />
              <Txt style={s.muted}>
                Items are distributed across these roommates. Responsibilities
                advance by date, even when no purchase is logged. Upcoming
                assignments are planning dates, not automatic shopping or
                payments.
              </Txt>
            </>
          )}
          {message}
          <Button
            label="Save grocery schedule"
            loading={busy}
            onPress={() =>
              run(async () => {
                await action(
                  {
                    id: uid(),
                    kind: "configure",
                    participants,
                    days: Number(days),
                    due,
                    mode,
                    restockParticipants:
                      mode === "grocery" ? participants : restockMembers,
                    restockDays:
                      mode === "grocery" ? Number(days) : Number(restockDays),
                    restockStart: mode === "grocery" ? due : restockStart,
                  },
                  configVersion.current,
                );
                setConfig(false);
              }, "Grocery rotation saved.")
            }
          />
        </Sheet>
      )}
      {editing && (
        <Sheet
          title="Household essential details"
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <Field
            label="Essential name"
            value={label}
            onChangeText={setLabel}
            maxLength={120}
          />
          <Txt style={s.label}>CATEGORY</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {shoppingCategories.map((c) => (
              <Chip
                key={c}
                label={c}
                active={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
          </View>
          <Field
            label="Quantity remaining (optional)"
            value={quantity}
            onChangeText={setQuantity}
            maxLength={60}
            placeholder="e.g. 2 rolls"
          />
          <Field
            label="Restock notes (optional)"
            value={notes}
            onChangeText={setNotes}
            maxLength={300}
            placeholder="Preferred brand or quantity to buy"
          />
          {message}
          <Button
            label="Save essential"
            loading={busy}
            onPress={() =>
              run(async () => {
                await action(
                  {
                    id: uid(),
                    kind: "essential",
                    item: {
                      id: editing.id,
                      name: label,
                      category,
                      quantity,
                      notes,
                    },
                  },
                  essentialVersion.current,
                );
                setEditing(null);
              }, "Essential details saved.")
            }
          />
        </Sheet>
      )}
      {swapOpen && (
        <Sheet
          title="Swap grocery turns"
          onClose={() => {
            if (!busy) setSwapOpen(false);
          }}
        >
          <Txt>
            Choose a participant. Your turn stays assigned to you until they
            accept. Acceptance exchanges your current turn with their next
            position in the queue.
          </Txt>
          {queue
            .filter((id) => id !== self?.id)
            .map((id) => (
              <Chip
                key={id}
                label={name(id)}
                active={swapTarget === id}
                onPress={() => setSwapTarget(id)}
              />
            ))}
          {message}
          <Button
            label="Request turn swap"
            loading={busy}
            onPress={() =>
              run(async () => {
                await action(
                  { id: uid(), kind: "requestSwap", target: swapTarget },
                  turnVersion.current,
                );
                setSwapOpen(false);
              }, "Swap requested. Waiting for the other roommate to agree.")
            }
          />
        </Sheet>
      )}
      {confirm && (
        <Sheet
          title={
            confirm === "complete"
              ? "Complete your grocery turn?"
              : "Skip your grocery turn?"
          }
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <Txt>
            {confirm === "complete"
              ? "Confirm only after you have made the trip. This advances the schedule and records your completion, but does not create an expense or mark restock items purchased. Record those separately so amounts and shares stay accurate."
              : "Your turn moves to the end of the queue and the next roommate takes over with the same due date. This is recorded as a skip, not a completed trip."}
          </Txt>
          {message}
          <Button
            label={
              confirm === "complete"
                ? "Confirm grocery trip completed"
                : "Confirm skip turn"
            }
            loading={busy}
            onPress={() =>
              run(
                async () => {
                  await action(
                    { id: uid(), kind: confirm },
                    turnVersion.current,
                  );
                  setConfirm(null);
                },
                confirm === "complete"
                  ? "Grocery trip completed. The next roommate is assigned."
                  : "Turn skipped. You're at the back of the queue.",
              )
            }
          />
        </Sheet>
      )}
    </>
  );
}
