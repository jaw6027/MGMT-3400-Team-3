import type { Expense, Member, ShoppingItem } from "./core";
import { shoppingCatalog, shoppingCategories } from "./shoppingCatalog";
export { shoppingCatalog, shoppingCategories };
export const normalizedShoppingName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
export function shoppingIdentity(
  value: Pick<ShoppingItem, "name" | "category" | "catalog_id">,
) {
  return value.catalog_id
    ? "catalog:" + value.catalog_id
    : "custom:" +
        value.category.trim().toLowerCase() +
        ":" +
        normalizedShoppingName(value.name);
}
export function canonicalShoppingItem(
  name: string,
  category: string,
  catalogId: string | null = null,
) {
  if (!shoppingCategories.some((c) => c === category))
    throw new Error("Choose a shopping category.");
  const found = catalogId
    ? shoppingCatalog.find((c) => c.id === catalogId)
    : shoppingCatalog.find(
        (c) =>
          c.category === category &&
          normalizedShoppingName(c.name) === normalizedShoppingName(name),
      );
  if (catalogId && !found)
    throw new Error("Choose an item from the catalog or add a custom item.");
  const item = found
    ? { name: found.name, category: found.category, catalog_id: found.id }
    : { name: name.trim().replace(/\s+/g, " "), category, catalog_id: null };
  if (!item.name || item.name.length > 120)
    throw new Error("Enter an item name, up to 120 characters.");
  return { ...item, item_key: shoppingIdentity(item) };
}
export function validateShoppingItem(item: ShoppingItem, members: Member[]) {
  const canonical = canonicalShoppingItem(
    item.name,
    item.category,
    item.catalog_id,
  );
  if (canonical.item_key !== item.item_key)
    throw new Error("The item and category do not match.");
  if (!members.some((m) => m.id === item.assigned_to && !m.left_at))
    throw new Error("Choose a current roommate to purchase this item.");
  if (typeof item.one_time !== "boolean")
    throw new Error("Choose whether this is a one-time purchase.");
}
export function lastShoppingPurchase(
  item: Pick<ShoppingItem, "household_id" | "item_key">,
  list: ShoppingItem[],
  expenses: Expense[],
) {
  const linked = new Set(
    list
      .filter(
        (s) =>
          s.household_id === item.household_id &&
          s.item_key === item.item_key &&
          s.expense_id,
      )
      .map((s) => s.expense_id),
  );
  return (
    expenses
      .filter((e) => e.household_id === item.household_id && linked.has(e.id))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.created_at.localeCompare(a.created_at) ||
          b.id.localeCompare(a.id),
      )[0] || null
  );
}
export function suggestedShopper(last: Expense | null, members: Member[]) {
  if (!last || last.one_time) return null;
  const active = members
    .filter((m) => !m.left_at)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!active.length) return null;
  const index = active.findIndex((m) => m.id === last.paid_by);
  return active[(index + 1) % active.length];
}
export function purchaseCategory(category: string) {
  return category === "Food"
    ? "Groceries"
    : ["Utilities", "Subscription Services"].includes(category)
      ? "Utilities"
      : category === "Other"
        ? "Other"
        : "Household";
}
