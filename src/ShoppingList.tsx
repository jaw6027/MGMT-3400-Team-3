import { groceryEssentialFor, restockOwner } from "./grocery";
import React, { useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { Expense, ShoppingItem } from "./core";
import { money } from "./core";
import { uid } from "./backend";
import { useStore } from "./store";
import {
  canonicalShoppingItem,
  lastShoppingPurchase,
  shoppingCatalog,
  shoppingCategories,
  suggestedShopper,
} from "./shopping";
import {
  Avatar,
  Button,
  C,
  Chip,
  Empty,
  Field,
  Icon,
  Sheet,
  s,
  Title,
  Txt,
} from "./ui";
export default function ShoppingList({
  onPurchase,
  onOpenPurchase,
}: {
  onPurchase: (item: ShoppingItem) => void;
  onOpenPurchase: (expense: Expense) => void;
}) {
  const st = useStore();
  const currentMember = st.members.find((m) => m.user_id === st.user?.id);

  const [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<ShoppingItem | null>(null),
    [custom, setCustom] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("Utilities"),
    [name, setName] = useState(""),
    [category, setCategory] = useState("Other"),
    [catalogId, setCatalogId] = useState<string | null>(null),
    [assigned, setAssigned] = useState(""),
    [oneTime, setOneTime] = useState(false),
    [view, setView] = useState<"planned" | "purchased">("planned"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remove, setRemove] = useState<ShoppingItem | null>(null);
  const submission = useRef(false),
    draftId = useRef("");
  const active = st.members.filter((m) => !m.left_at);
  const member = (id: string) => st.members.find((m) => m.id === id);
  const linked = (item: ShoppingItem) =>
    st.expenses.find((e) => e.id === item.expense_id);
  const planned = st.shoppingItems.filter((i) => !linked(i)),
    completed = st.shoppingItems.filter((i) => linked(i));
  const list = view === "planned" ? planned : completed;
  let draft: ReturnType<typeof canonicalShoppingItem> | null = null;
  try {
    if (name.trim()) draft = canonicalShoppingItem(name, category, catalogId);
  } catch {}
  const last = draft
    ? lastShoppingPurchase(
        { household_id: st.household!.id, item_key: draft.item_key },
        st.shoppingItems,
        st.expenses,
      )
    : null;
  const suggested = suggestedShopper(last, st.members);
  const start = (item?: ShoppingItem, edit = false) => {
    const latest = item
      ? lastShoppingPurchase(item, st.shoppingItems, st.expenses)
      : null;
    setEditing(edit && item ? item : null);
    draftId.current = edit && item ? item.id : uid();
    setName(item?.name || "");
    setCategory(item?.category || "Other");
    setCatalogId(item?.catalog_id || null);
    setCustom(Boolean(item && !item.catalog_id));
    setFilter(item?.category || "Utilities");
    setQuery("");
    setAssigned(
      edit && item
        ? item.assigned_to
        : suggestedShopper(latest, st.members)?.id || "",
    );
    setOneTime(edit ? Boolean(item?.one_time) : false);
    setError("");
    setAdding(true);
  };
  const select = (item: (typeof shoppingCatalog)[number]) => {
    setName(item.name);
    setCategory(item.category);
    setCatalogId(item.id);
    setCustom(false);
    const old = lastShoppingPurchase(
      { household_id: st.household!.id, item_key: "catalog:" + item.id },
      st.shoppingItems,
      st.expenses,
    );
    setAssigned(suggestedShopper(old, st.members)?.id || "");
  };
  const save = async () => {
    if (submission.current) return;
    submission.current = true;
    setBusy(true);
    setError("");
    try {
      const canonical = canonicalShoppingItem(name, category, catalogId);
      if (!assigned)
        throw new Error("Choose which roommate will purchase this item.");
      await st.saveShoppingItem({
        id: draftId.current,
        household_id: st.household!.id,
        ...canonical,
        assigned_to: assigned,
        one_time: oneTime,
        expense_id: null,
        created_at: editing?.created_at || new Date().toISOString(),
      });
      setAdding(false);
      setView("planned");
    } catch (e: any) {
      setError(e.message || "Couldn’t save this item. Please try again.");
    } finally {
      submission.current = false;
      setBusy(false);
    }
  };
  const deleteItem = async () => {
    if (submission.current || !remove) return;
    submission.current = true;
    setBusy(true);
    setError("");
    try {
      await st.deleteShoppingItem(remove.id);
      setRemove(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      submission.current = false;
      setBusy(false);
    }
  };
  const catalog = shoppingCatalog.filter(
    (i) =>
      (filter === "All" || i.category === filter) &&
      `${i.name} ${i.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <View style={[s.between, { gap: 12, flexWrap: "wrap" }]}>
        <View style={{ flex: 1, minWidth: 200, gap: 8 }}>
          <Title>Household shopping list</Title>
          <Txt style={{ color: C.muted, lineHeight: 21 }}>
            Plan what you’ll share, choose who’ll buy it, and remember whose
            turn it is.
          </Txt>
        </View>
        <Button label="Add item" icon="Plus" onPress={() => start()} />
      </View>
      <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
        <Chip
          label={`Planned (${planned.length})`}
          active={view === "planned"}
          onPress={() => setView("planned")}
        />
        <Chip
          label={`Purchased (${completed.length})`}
          active={view === "purchased"}
          onPress={() => setView("purchased")}
        />
      </View>
      <View
        style={{
          backgroundColor: C.sage,
          borderRadius: 12,
          padding: 16,
          gap: 6,
        }}
      >
        <Txt style={{ fontFamily: "DMBold", color: C.green, fontSize: 13 }}>
          Purchase memory
        </Txt>
        <Txt style={{ fontSize: 12, lineHeight: 20, color: C.green }}>
          The list remembers who actually paid when a purchase is logged.
          Suggestions follow the last recorded buyer, and you can always choose
          someone else.
        </Txt>
      </View>
      {!list.length ? (
        <View style={s.card}>
          <Empty
            title={
              view === "planned"
                ? "What’s next for your home?"
                : "Your purchase memory starts here"
            }
            description={
              view === "planned"
                ? "Choose from 61 shared expenses in your household catalog, or add something of your own."
                : "Log a purchase from a planned item to save who bought it, when, and everyone’s share."
            }
            action={
              view === "planned" ? (
                <Button
                  label="Choose an item"
                  icon="Plus"
                  onPress={() => start()}
                />
              ) : undefined
            }
          />
        </View>
      ) : (
        shoppingCategories
          .filter((c) => list.some((i) => i.category === c))
          .map((c) => (
            <View key={c} style={{ gap: 13 }}>
              <Txt style={{ fontFamily: "DMBold", fontSize: 17 }}>{c}</Txt>
              {list
                .filter((i) => i.category === c)
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((item) => {
                  const essential = groceryEssentialFor(st, item.id);
                  const restocker = essential
                    ? restockOwner(st.grocery, essential, st.members)
                    : null;
                  const expense = linked(item),
                    previous = lastShoppingPurchase(
                      item,
                      st.shoppingItems,
                      st.expenses,
                    ),
                    purchaser = member(expense?.paid_by || item.assigned_to);
                  return (
                    <View
                      key={item.id}
                      style={[s.card, { gap: 14, padding: 18 }]}
                    >
                      <View style={[s.between, { gap: 12 }]}>
                        <View style={{ flex: 1, gap: 6 }}>
                          <Txt style={{ fontFamily: "DMBold", fontSize: 16 }}>
                            {item.name}
                          </Txt>
                          {(expense?.one_time ?? item.one_time) && (
                            <Txt style={{ color: C.green, fontSize: 11 }}>
                              One-time purchase
                            </Txt>
                          )}
                        </View>
                        <Avatar
                          name={purchaser?.name || "Former roommate"}
                          size={35}
                        />
                      </View>
                      <Txt style={{ fontSize: 12, color: C.muted }}>
                        {expense
                          ? `${purchaser?.name || "Former roommate"} bought this · ${expense.date} · ${money(expense.cents, st.household?.currency)}`
                          : `Assigned to ${purchaser?.name || "Former roommate"}${purchaser?.left_at ? " · Reassign before buying" : ""}`}
                      </Txt>
                      {essential && (
                        <Txt style={{ fontSize: 12, color: C.green }}>
                          Restock essential
                          {essential.notes ? ` · ${essential.notes}` : ""}
                          {essential.quantity
                            ? ` · Remaining: ${essential.quantity}`
                            : ""}
                          . Responsibility to shop is separate from expense
                          shares.
                        </Txt>
                      )}
                      {!expense && previous && (
                        <Txt style={{ fontSize: 12, color: C.green }}>
                          Last bought by{" "}
                          {member(previous.paid_by)?.name || "Former roommate"}{" "}
                          · {previous.date}
                          {previous.one_time ? " · One-time" : ""}
                        </Txt>
                      )}
                      {!expense && !previous && (
                        <Txt style={{ fontSize: 11, color: C.muted }}>
                          No recorded purchase yet.
                        </Txt>
                      )}
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 9,
                          flexWrap: "wrap",
                        }}
                      >
                        {expense ? (
                          <>
                            <Button
                              secondary
                              small
                              label="View purchase"
                              accessibilityLabel={`View ${item.name} purchase`}
                              icon="Receipt"
                              onPress={() => onOpenPurchase(expense)}
                            />
                            {!expense.one_time && (
                              <Button
                                secondary
                                small
                                label="Buy again"
                                accessibilityLabel={`Buy ${item.name} again`}
                                icon="Plus"
                                onPress={() => start(item)}
                              />
                            )}
                          </>
                        ) : (
                          <>
                            <Button
                              small
                              label={
                                essential ? "Mark as Purchased" : "Log purchase"
                              }
                              accessibilityLabel={
                                essential
                                  ? `Mark ${item.name} as purchased`
                                  : `Log ${item.name} purchase`
                              }
                              disabled={Boolean(
                                essential && restocker !== currentMember?.id,
                              )}
                              icon="Check"
                              onPress={() => onPurchase(item)}
                            />
                            {!essential && (
                              <>
                                <Button
                                  secondary
                                  small
                                  label="Edit"
                                  accessibilityLabel={`Edit ${item.name}`}
                                  icon="Pencil"
                                  onPress={() => start(item, true)}
                                />
                                <Button
                                  secondary
                                  small
                                  label="Remove"
                                  accessibilityLabel={`Remove ${item.name}`}
                                  icon="Trash2"
                                  onPress={() => {
                                    setError("");
                                    setRemove(item);
                                  }}
                                />
                              </>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}
            </View>
          ))
      )}
      {adding && (
        <Sheet
          title={editing ? "Edit planned item" : "Add a shared expense"}
          onClose={() => {
            if (!busy) setAdding(false);
          }}
        >
          <Txt style={s.muted}>
            Catalog categories and items come from your Shared Expense List
            spreadsheet.
          </Txt>
          <View style={[s.row, { gap: 9, flexWrap: "wrap" }]}>
            <Chip
              label="From household catalog"
              active={!custom}
              onPress={() => {
                setCustom(false);
                if (!catalogId) {
                  setName("");
                  setCategory("Other");
                }
              }}
            />
            <Chip
              label="Custom expense"
              active={custom}
              onPress={() => {
                setCustom(true);
                setName("");
                setCatalogId(null);
                setCategory("Other");
                setAssigned("");
              }}
            />
          </View>
          {custom ? (
            <>
              <Field
                label="Custom item name"
                value={name}
                onChangeText={setName}
                placeholder="What else will you share?"
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
            </>
          ) : (
            <>
              <Field
                label="Search household catalog"
                value={query}
                onChangeText={(v: string) => {
                  setQuery(v);
                  if (v) setFilter("All");
                }}
                placeholder="Search 61 shared expenses…"
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {[
                  "All",
                  ...shoppingCategories.filter((c) => c !== "Other"),
                ].map((c) => (
                  <Chip
                    key={c}
                    label={c}
                    active={filter === c}
                    onPress={() => setFilter(c)}
                  />
                ))}
              </ScrollView>
              <View style={{ gap: 8 }}>
                {catalog.map((item) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={`Select ${item.name}`}
                    accessibilityState={{ checked: catalogId === item.id }}
                    aria-checked={catalogId === item.id}
                    key={item.id}
                    onPress={() => select(item)}
                    style={[
                      s.between,
                      {
                        padding: 13,
                        borderRadius: 9,
                        borderWidth: 1,
                        borderColor: catalogId === item.id ? C.green : C.line,
                        backgroundColor:
                          catalogId === item.id ? C.sage : C.white,
                      },
                    ]}
                  >
                    <View style={{ gap: 4, flex: 1 }}>
                      <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                        {item.name}
                      </Txt>
                      <Txt style={s.muted}>{item.category}</Txt>
                    </View>
                    {catalogId === item.id && (
                      <Icon name="Check" color={C.green} size={18} />
                    )}
                  </Pressable>
                ))}
                {!catalog.length && (
                  <Txt style={s.muted}>
                    Nothing matched. You can add a custom expense instead.
                  </Txt>
                )}
              </View>
              {catalogId && (
                <Txt style={{ fontFamily: "DMBold", color: C.green }}>
                  Selected: {name} · {category}
                </Txt>
              )}
            </>
          )}
          {last && (
            <View
              style={{
                backgroundColor: C.sage,
                padding: 14,
                borderRadius: 10,
                gap: 8,
              }}
            >
              <Txt style={{ fontFamily: "DMBold", color: C.green }}>
                Last bought by {member(last.paid_by)?.name || "Former roommate"}
              </Txt>
              <Txt style={{ fontSize: 12, color: C.green }}>
                {last.date} · {money(last.cents, st.household?.currency)}
                {last.one_time ? " · One-time purchase" : ""}
              </Txt>
              {suggested && (
                <>
                  <Txt style={{ fontSize: 12, color: C.green }}>
                    Suggested next buyer: {suggested.name}. You can change this
                    below.
                  </Txt>
                  <Button
                    secondary
                    small
                    label="Use suggested buyer"
                    onPress={() => setAssigned(suggested.id)}
                  />
                </>
              )}
            </View>
          )}
          <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
            Who will purchase this? *
          </Txt>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {active.map((m) => (
              <Chip
                key={m.id}
                label={m.name}
                active={assigned === m.id}
                onPress={() => setAssigned(m.id)}
              />
            ))}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="One-time planned purchase"
            accessibilityState={{ checked: oneTime }}
            aria-checked={oneTime}
            onPress={() => setOneTime(!oneTime)}
            style={[s.row, { gap: 10, minHeight: 44 }]}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: C.green,
                backgroundColor: oneTime ? C.green : C.white,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {oneTime && <Icon name="Check" color={C.white} size={15} />}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                One-time purchase
              </Txt>
              <Txt style={s.muted}>
                Save the history without offering a repeat buy.
              </Txt>
            </View>
          </Pressable>
          {error && (
            <Txt accessibilityRole="alert" style={{ color: C.red }}>
              {error}
            </Txt>
          )}
          <Button
            label={editing ? "Save planned item" : "Add to household list"}
            icon="Plus"
            loading={busy}
            onPress={save}
          />
        </Sheet>
      )}
      {remove && (
        <Sheet
          title="Remove planned item?"
          onClose={() => {
            if (!busy) setRemove(null);
          }}
        >
          <Txt>
            Remove “{remove.name}” from the shopping list? Recorded purchases
            and balances stay in your history.
          </Txt>
          {error && <Txt style={{ color: C.red }}>{error}</Txt>}
          <Button
            danger
            label="Confirm remove item"
            loading={busy}
            onPress={deleteItem}
          />
          <Button
            secondary
            label="Keep item"
            disabled={busy}
            onPress={() => setRemove(null)}
          />
        </Sheet>
      )}
    </>
  );
}
