import type { Data, Member, ShoppingItem, Expense } from "./core";
import { canonicalShoppingItem } from "./shopping";

export type GroceryRotation = {
  queue: string[];
  days: number;
  due: string;
  mode: "grocery" | "separate";
  restockQueue: string[];
  restockDays: number;
  restockStart: string;
  turn: number;
};
export type Essential = {
  id: string;
  name: string;
  category: string;
  quantity: string;
  notes: string;
  low: boolean;
  shoppingId: string | null;
  lastPurchased: string | null;
};
export type GrocerySwap = {
  id: string;
  from: string;
  to: string;
  turn: number;
  status: "pending" | "accepted" | "declined" | "canceled" | "expired";
};
export type GroceryEvent = {
  id: string;
  kind: string;
  actor: string;
  date: string;
  command?: GroceryCommand;
  target?: string;
  item?: string;
  expenseId?: string;
};
export type GroceryState = {
  version: number;
  rotation: GroceryRotation | null;
  essentials: Essential[];
  swaps: GrocerySwap[];
  history: GroceryEvent[];
};
type Config = {
  participants: string[];
  days: number;
  due: string;
  mode: "grocery" | "separate";
  restockParticipants: string[];
  restockDays: number;
  restockStart: string;
};
export type GroceryCommand = { id: string } & (
  | ({ kind: "configure" } & Config)
  | {
      kind: "essential";
      item: Pick<Essential, "id" | "name" | "category" | "quantity" | "notes">;
    }
  | { kind: "low"; essentialId: string; shoppingId: string }
  | { kind: "complete" }
  | { kind: "skip" }
  | { kind: "requestSwap"; target: string }
  | {
      kind: "resolveSwap";
      swapId: string;
      decision: "accept" | "decline" | "cancel";
    }
);
export const groceryToday = () => new Date().toISOString().slice(0, 10);
export const defaultEssentials = [
  ["Toilet Paper", "Bathroom"],
  ["Paper Towels", "Kitchen"],
  ["Dish Soap", "Household Items"],
  ["Laundry Detergent", "Household Items"],
  ["Trash Bags", "Household Items"],
  ["Cleaning Supplies", "Household Items"],
  ["Hand Soap", "Bathroom"],
  ["Shared Food Items", "Food"],
];
export function emptyGrocery(): GroceryState {
  return {
    version: 0,
    rotation: null,
    swaps: [],
    history: [],
    essentials: defaultEssentials.map(([name, category], i) => ({
      id: `70000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      name,
      category,
      quantity: "",
      notes: "",
      low: false,
      shoppingId: null,
      lastPurchased: null,
    })),
  };
}
export function groceryDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function addGroceryDays(day: string, days: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function groceryQueue(queue: string[], members: Member[]) {
  return queue.filter((id) => members.some((m) => m.id === id && !m.left_at));
}
export function restockOwner(
  state: GroceryState,
  essential: Essential,
  members: Member[],
  day = groceryToday(),
): string | null {
  const r = state.rotation;
  if (!r) return null;
  if (r.mode === "grocery") return groceryQueue(r.queue, members)[0] || null;
  const queue = groceryQueue(r.restockQueue, members);
  if (!queue.length) return null;
  const periods = Math.max(
    0,
    Math.floor(
      (Date.parse(day + "T00:00:00Z") -
        Date.parse(r.restockStart + "T00:00:00Z")) /
        86400000 /
        r.restockDays,
    ),
  );
  const index = state.essentials.findIndex((e) => e.id === essential.id);
  return queue[(periods + Math.max(0, index)) % queue.length];
}
export function upcomingGroceries(
  state: GroceryState,
  members: Member[],
  count = 4,
) {
  const r = state.rotation;
  if (!r) return [];
  const queue = groceryQueue(r.queue, members);
  if (!queue.length) return [];
  return Array.from({ length: count }, (_, i) => ({
    memberId: queue[i % queue.length],
    due: addGroceryDays(r.due, r.days * i),
  }));
}
export function syncGroceryShopping(data: Data, day = groceryToday()): Data {
  const state = data.grocery;
  if (!state?.rotation) return data;
  return {
    ...data,
    shoppingItems: (data.shoppingItems || []).map((item) => {
      const essential = state.essentials.find(
        (e) => e.shoppingId === item.id && e.low,
      );
      if (!essential || item.expense_id) return item;
      const owner = restockOwner(state, essential, data.members, day);
      return {
        ...item,
        ...canonicalShoppingItem(essential.name, essential.category),
        assigned_to: owner || item.assigned_to,
      };
    }),
  };
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function validParticipants(ids: string[], members: Member[]) {
  assert(
    Array.isArray(ids) &&
      ids.length > 0 &&
      ids.length <= 30 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => members.some((m) => m.id === id && !m.left_at)),
    "Choose distinct current household roommates for the rotation.",
  );
}
function interval(days: number) {
  assert(
    Number.isInteger(days) && days >= 1 && days <= 365,
    "Choose an interval from 1 to 365 days.",
  );
}
function expire(state: GroceryState) {
  state.swaps.forEach((s) => {
    if (s.status === "pending") s.status = "expired";
  });
}

/** Authoritative local-demo transition; live mode applies the same rules in PostgreSQL. */
export function applyGrocery(
  data: Data,
  userId: string,
  command: GroceryCommand,
  expectedVersion: number,
  day = groceryToday(),
): Data {
  const actor = data.members.find((m) => m.user_id === userId && !m.left_at);
  assert(
    actor && data.household,
    "Join this household before changing its grocery rotation.",
  );
  assert(command.id && command.id.length <= 100, "Provide a request ID.");
  const result = JSON.parse(JSON.stringify(data)) as Data;
  const state = (result.grocery ||= emptyGrocery());
  const oldEvent = state.history.find((e) => e.id === command.id);
  if (oldEvent) {
    assert(
      oldEvent.actor === actor.id &&
        JSON.stringify(oldEvent.command) === JSON.stringify(command),
      "This request ID was already used.",
    );
    return syncGroceryShopping(result, day);
  }
  if (
    command.kind === "low" &&
    state.essentials.some((e) => e.id === command.essentialId && e.low)
  )
    return syncGroceryShopping(result, day);
  assert(
    state.version === expectedVersion,
    "This grocery schedule changed. Refresh and try again.",
  );
  const r = state.rotation;
  const event: GroceryEvent = {
    id: command.id,
    kind: command.kind,
    actor: actor.id,
    date: day,
    command,
  };
  if (command.kind === "configure") {
    validParticipants(command.participants, result.members);
    interval(command.days);
    interval(command.restockDays);
    assert(
      groceryDate(command.due) && groceryDate(command.restockStart),
      "Choose valid schedule dates (YYYY-MM-DD).",
    );
    assert(
      command.mode === "grocery" || command.mode === "separate",
      "Choose a restock mode.",
    );
    validParticipants(command.restockParticipants, result.members);
    const kept = r
      ? groceryQueue(r.queue, result.members).filter((id) =>
          command.participants.includes(id),
        )
      : [];
    state.rotation = {
      queue: [
        ...kept,
        ...command.participants.filter((id) => !kept.includes(id)),
      ],
      days: command.days,
      due: command.due,
      mode: command.mode,
      restockQueue: [...command.restockParticipants],
      restockDays: command.restockDays,
      restockStart: command.restockStart,
      turn: (r?.turn || 0) + 1,
    };
    expire(state);
  } else if (command.kind === "essential") {
    const item = command.item;
    const canonical = canonicalShoppingItem(item.name, item.category);
    assert(
      item.id && item.notes.length <= 300 && item.quantity.length <= 60,
      "Keep notes under 300 characters and quantity under 60.",
    );
    assert(
      !state.essentials.some(
        (e) =>
          e.id !== item.id &&
          e.name.toLowerCase() === canonical.name.toLowerCase() &&
          e.category === canonical.category,
      ),
      "This essential already exists. Use its Running Low button.",
    );
    const old = state.essentials.find((e) => e.id === item.id);
    const updated: Essential = {
      ...(old || { low: false, shoppingId: null, lastPurchased: null }),
      ...item,
      name: canonical.name,
      category: canonical.category,
    };
    state.essentials = old
      ? state.essentials.map((e) => (e.id === item.id ? updated : e))
      : [...state.essentials, updated];
    event.item = updated.name;
  } else if (command.kind === "low") {
    assert(r, "Create a grocery rotation first.");
    const item = state.essentials.find((e) => e.id === command.essentialId);
    assert(item, "This essential is unavailable.");
    const owner = restockOwner(state, item, result.members, day);
    assert(owner, "Choose active restock participants in the schedule.");
    const canonical = canonicalShoppingItem(item.name, item.category);
    // Reuse the household's existing matching planned item, including catalog items.
    const planned = (result.shoppingItems || []).find(
      (s) =>
        s.household_id === result.household!.id &&
        s.item_key === canonical.item_key &&
        !s.expense_id,
    );
    assert(
      planned ||
        !(result.shoppingItems || []).some((s) => s.id === command.shoppingId),
      "This shopping request ID was already used.",
    );
    const shopping: ShoppingItem = planned
      ? { ...planned, assigned_to: owner }
      : {
          id: command.shoppingId,
          household_id: result.household!.id,
          ...canonical,
          assigned_to: owner,
          one_time: false,
          expense_id: null,
          created_by: userId,
          created_at: new Date().toISOString(),
        };
    result.shoppingItems = [
      shopping,
      ...(result.shoppingItems || []).filter((s) => s.id !== shopping.id),
    ];
    item.low = true;
    item.shoppingId = shopping.id;
    event.item = item.name;
  } else {
    assert(r, "Create a grocery rotation first.");
    const queue = groceryQueue(r.queue, result.members);
    assert(queue.length, "Choose active participants in the schedule.");
    if (command.kind === "complete" || command.kind === "skip") {
      assert(
        actor.id === queue[0],
        "Only the roommate whose turn it is can complete or skip it.",
      );
      if (command.kind === "complete") {
        assert(r.due <= day, "This turn has not started yet.");
        r.due = addGroceryDays(day > r.due ? day : r.due, r.days);
      } else
        assert(
          queue.length > 1,
          "Add another participant before skipping a turn.",
        );
      r.queue = [...queue.slice(1), queue[0]];
      r.turn += 1;
      expire(state);
    } else if (command.kind === "requestSwap") {
      assert(
        actor.id === queue[0],
        "Only the current shopper can request a swap.",
      );
      assert(
        command.target !== actor.id && queue.includes(command.target),
        "Choose another active rotation participant.",
      );
      assert(
        !state.swaps.some((s) => s.status === "pending" && s.turn === r.turn),
        "Resolve or cancel the pending swap first.",
      );
      state.swaps.push({
        id: command.id,
        from: actor.id,
        to: command.target,
        turn: r.turn,
        status: "pending",
      });
      event.target = command.target;
    } else {
      const swap = state.swaps.find((s) => s.id === command.swapId);
      assert(
        swap?.status === "pending" &&
          swap.turn === r.turn &&
          queue[0] === swap.from &&
          queue.includes(swap.to),
        "This swap is no longer available.",
      );
      if (command.decision === "cancel") {
        assert(
          actor.id === swap.from,
          "Only the requester can cancel this swap.",
        );
        swap.status = "canceled";
      } else {
        assert(
          actor.id === swap.to,
          "Only the invited roommate can accept or decline this swap.",
        );
        assert(
          command.decision === "accept" || command.decision === "decline",
          "Choose an accept or decline decision.",
        );
        swap.status = command.decision === "accept" ? "accepted" : "declined";
        if (command.decision === "accept") {
          const target = queue.indexOf(swap.to);
          [queue[0], queue[target]] = [queue[target], queue[0]];
          r.queue = queue;
          r.turn += 1;
          expire(state);
        }
      }
      event.target = swap.from;
    }
  }
  state.version += 1;
  state.history.unshift(event);
  return syncGroceryShopping(result, day);
}
export function groceryEssentialFor(data: Data, shoppingId: string) {
  return data.grocery?.essentials.find(
    (e) => e.low && e.shoppingId === shoppingId,
  );
}
export function checkGroceryPurchase(
  data: Data,
  userId: string,
  shoppingId: string,
  day = groceryToday(),
) {
  const item = groceryEssentialFor(data, shoppingId);
  if (!item || !data.grocery) return;
  const owner = restockOwner(data.grocery, item, data.members, day);
  assert(
    data.members.some(
      (m) => m.id === owner && m.user_id === userId && !m.left_at,
    ),
    "Only the assigned restocker can mark this item as purchased. Refresh to check whose turn it is.",
  );
}
export function checkGroceryTripExpense(
  data: Data,
  userId: string,
  expense: Expense,
) {
  if (!expense.grocery_trip_id) return;
  const trip = data.grocery?.history.find(
    (e) => e.id === expense.grocery_trip_id && e.kind === "complete",
  );
  assert(
    trip &&
      data.members.some(
        (m) => m.id === trip.actor && m.user_id === userId && !m.left_at,
      ),
    "Link an expense to a grocery trip you completed in this household.",
  );
}
export function completeGroceryRestock(
  data: Data,
  shoppingId: string,
  expense: Expense,
  userId: string,
): Data {
  const item = groceryEssentialFor(data, shoppingId);
  if (!item) return data;
  const result = JSON.parse(JSON.stringify(data)) as Data;
  const state = result.grocery!;
  const updated = state.essentials.find((e) => e.id === item.id)!;
  updated.low = false;
  updated.quantity = "";
  updated.lastPurchased = expense.date;
  state.version += 1;
  state.history.unshift({
    id: `purchase:${expense.id}`,
    kind: "restock",
    actor: data.members.find((m) => m.user_id === userId)!.id,
    date: expense.date,
    item: item.name,
    expenseId: expense.id,
  });
  return result;
}
export function reopenDeletedGroceryPurchase(
  data: Data,
  expenseId: string,
): Data {
  if (!data.grocery) return data;
  const reopened = data.grocery.essentials.filter(
    (e) =>
      e.shoppingId &&
      (data.shoppingItems || []).some(
        (s) => s.id === e.shoppingId && s.expense_id === expenseId,
      ),
  );
  if (!reopened.length) return data;
  return {
    ...data,
    grocery: {
      ...data.grocery,
      version: data.grocery.version + 1,
      essentials: data.grocery.essentials.map((e) =>
        reopened.some((x) => x.id === e.id)
          ? { ...e, low: true, lastPurchased: null }
          : e,
      ),
    },
  };
}

// Same-browser tabs serialize preview writes with Web Locks when available.
// Native/older browsers serialize within this JS instance; demo data is not a server.
let localQueue = Promise.resolve();
export function groceryLocalLock<T>(job: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> =>
    typeof navigator !== "undefined" && navigator.locks
      ? await navigator.locks.request("splitcart-local-data", job)
      : await job();
  const next = localQueue.then(run, run);
  localQueue = next.then(
    () => {},
    () => {},
  );
  return next;
}
