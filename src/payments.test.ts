import { describe, it, expect } from "vitest";
import { quote, dueDate, reminderDate, validateReminder } from "./payments";
describe("payment rules", () => {
  it("charges 2.5% on credit only, using integer cent rounding", () => {
    expect(quote(10000, "credit")).toEqual({
      cents: 10000,
      fee: 250,
      total: 10250,
    });
    expect(quote(10000, "bank").fee).toBe(0);
    expect(quote(10000, "debit").fee).toBe(0);
    expect(quote(1020, "credit").fee).toBe(26);
    expect(quote(1019, "credit").fee).toBe(25);
  });
  it("rejects invalid, fractional and unsupported payments", () => {
    for (const n of [0, 49, -1, NaN, Infinity, 50.1, 100000001])
      expect(() => quote(n, "bank")).toThrow();
    expect(() => quote(1000, "unknown" as any)).toThrow();
    expect(quote(99999999, "bank").total).toBe(99999999);
    expect(() => quote(99999999, "credit")).toThrow(/including surcharge/);
    expect(() => quote(100000000, "bank")).toThrow(/including surcharge/);
  });
  it("uses explicit monthly UTC dates and reminders across month/year boundaries", () => {
    expect(dueDate("2027-01", 1)).toBe("2027-01-01");
    expect(reminderDate("2027-01-01", 7)).toBe("2026-12-25");
    expect(reminderDate("2028-03-01", 1)).toBe("2028-02-29");
    expect(reminderDate("2027-03-01", 0)).toBe("2027-03-01");
    for (const day of [0, 29, 31, 2.5, NaN])
      expect(() => dueDate("2027-01", day)).toThrow();
    expect(() => dueDate("2027-13", 1)).toThrow();
    expect(() => reminderDate("2027-01-01", 2)).toThrow();
  });
  it("requires opt-in and international phone numbers for text reminders", () => {
    expect(() => validateReminder(true, false, "", false)).toThrow(/Agree/);
    expect(() => validateReminder(false, true, "555", true)).toThrow(
      /international/,
    );
    expect(() =>
      validateReminder(false, true, "+14155550123", true),
    ).not.toThrow();
    expect(() => validateReminder(false, false, "", false)).not.toThrow();
  });
});
