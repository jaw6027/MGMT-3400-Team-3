import { describe, it, expect } from "vitest";
import {
  balances,
  canEdit,
  equalSplit,
  money,
  parseMoney,
  settlements,
  validateExpense,
  validateImage,
} from "./core";
import { demoData, DEMO_USER } from "./demo";
describe("money and fair splitting", () => {
  it("parses decimal strings without float arithmetic", () => {
    expect(parseMoney("0.29")).toBe(29);
    expect(parseMoney(" 123.4 ")).toBe(12340);
    expect(parseMoney("1000000")).toBe(100000000);
  });
  it.each(["0", "-1", "1.001", "1e2", "Infinity", "1,000", "1000000.01", ""])(
    "rejects invalid amount %s",
    (s) => expect(() => parseMoney(s)).toThrow(),
  );
  it("distributes remainders deterministically independent of selection order", () => {
    expect(equalSplit(100, ["b", "c", "a"])).toEqual([
      { member_id: "a", cents: 34 },
      { member_id: "b", cents: 33 },
      { member_id: "c", cents: 33 },
    ]);
    expect(equalSplit(1, ["a", "b"])).toEqual([
      { member_id: "a", cents: 1 },
      { member_id: "b", cents: 0 },
    ]);
  });
  it("conserves every cent across many totals and household sizes", () => {
    for (let n = 1; n <= 12; n++)
      for (let cents = 1; cents < 5000; cents += 17) {
        const shares = equalSplit(
          cents,
          Array.from({ length: n }, (_, i) => String(i)),
        );
        expect(shares.reduce((sum, s) => sum + s.cents, 0)).toBe(cents);
        expect(
          Math.max(...shares.map((s) => s.cents)) -
            Math.min(...shares.map((s) => s.cents)),
        ).toBeLessThanOrEqual(1);
      }
  });
  it("rejects empty and repeated participants", () => {
    expect(() => equalSplit(100, [])).toThrow();
    expect(() => equalSplit(100, ["a", "a"])).toThrow();
  });
  it("validates custom totals, date, required fields and household membership", () => {
    const d = demoData(),
      e = d.expenses[0];
    expect(() => validateExpense(e, d.members)).not.toThrow();
    expect(() =>
      validateExpense(
        { ...e, shares: [{ member_id: "alex", cents: 1 }] },
        d.members,
      ),
    ).toThrow(/add up/);
    expect(() =>
      validateExpense({ ...e, date: "2026-02-30" }, d.members),
    ).toThrow();
    expect(() => validateExpense({ ...e, name: "" }, d.members)).toThrow();
    expect(() =>
      validateExpense(
        { ...e, shares: [{ member_id: "outsider", cents: e.cents }] },
        d.members,
      ),
    ).toThrow();
  });
});
describe("balances and settlements", () => {
  it("offsets paid amounts against shares and recorded repayments", () => {
    const d = demoData(),
      members = d.members.slice(0, 2);
    const expenses = [
      {
        ...d.expenses[0],
        cents: 2501,
        shares: equalSplit(
          2501,
          members.map((m) => m.id),
        ),
      },
    ];
    expect(balances(members, expenses, [])).toEqual({
      alex: 1250,
      jordan: -1250,
    });
    expect(
      balances(members, expenses, [{ ...d.repayments[0], cents: 1250 }]),
    ).toEqual({ alex: 0, jordan: 0 });
  });
  it("produces suggestions that settle the whole household without losing cents", () => {
    const d = demoData(),
      b = balances(d.members, d.expenses, d.repayments);
    expect(Object.values(b).reduce((a, b) => a + b, 0)).toBe(0);
    const after = { ...b };
    for (const r of settlements(b)) {
      expect(r.cents).toBeGreaterThan(0);
      after[r.from_id] += r.cents;
      after[r.to_id] -= r.cents;
    }
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
  });
  it("preserves former roommates in balances", () => {
    const d = demoData();
    d.members[1].left_at = "2026-11-01";
    expect(balances(d.members, d.expenses, d.repayments)).toEqual(
      balances(
        d.members.map((m) => ({ ...m, left_at: null })),
        d.expenses,
        d.repayments,
      ),
    );
  });
  it("gives zero balances for an empty household", () =>
    expect(balances(demoData().members, [], [])).toEqual({
      alex: 0,
      jordan: 0,
      sam: 0,
      riley: 0,
    }));
});
describe("client permissions and receipt validation", () => {
  it("allows only the active payer to edit", () => {
    const d = demoData(),
      e = d.expenses[0];
    expect(canEdit(DEMO_USER, e, d.members)).toBe(true);
    expect(canEdit("demo-jordan", e, d.members)).toBe(false);
    d.members[0].left_at = "2026-11-01";
    expect(canEdit(DEMO_USER, e, d.members)).toBe(false);
  });
  it("limits image types and sizes", () => {
    expect(() => validateImage("image/jpeg", 5242880)).not.toThrow();
    expect(() => validateImage("image/svg+xml", 100)).toThrow();
    expect(() => validateImage("image/png", 5242881)).toThrow();
    expect(() => validateImage("image/png", 0)).toThrow();
  });
  it("formats the household currency", () =>
    expect(money(1250, "EUR")).toBe("€12.50"));
});
