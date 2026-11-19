import React, { useState } from "react";
import { View } from "react-native";
import { useStore } from "./store";
import { C, Chip, Title, Txt, s } from "./ui";
import { money, today } from "./core";
import { spendingBreakdown, previousMonth } from "./spending";
export function SpendingBreakdown() {
  const st = useStore(),
    current = today().slice(0, 7);
  const [period, setPeriod] = useState("month");
  const month =
    period === "month"
      ? current
      : period === "previous"
        ? previousMonth(today())
        : undefined;
  const report = spendingBreakdown(st.expenses, month),
    fmt = (cents: number) => money(cents, st.household?.currency || "USD");
  return (
    <View style={[s.card, { gap: 16 }]}>
      <Title style={{ fontSize: 25 }}>Spending by category</Title>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[
          { id: "month", label: "This month" },
          { id: "previous", label: "Last month" },
          { id: "all", label: "All time" },
        ].map((p) => (
          <Chip
            key={p.id}
            label={p.label}
            active={period === p.id}
            onPress={() => setPeriod(p.id)}
          />
        ))}
      </View>
      <Txt style={{ fontFamily: "DMBold", fontSize: 22 }}>
        Total spent: {fmt(report.total)}
      </Txt>
      <Txt style={s.muted}>
        {month || "All dates"} · {report.count} recorded purchases · Full
        household totals, counted once per expense. Repayments, card fees,
        shopping plans, and future recurring schedules are excluded.
      </Txt>
      {!report.rows.length && (
        <Txt>
          No recorded expenses for this period. Add a purchase and choose its
          category to see the breakdown.
        </Txt>
      )}
      {report.rows.map((row) => (
        <View key={row.category} style={{ gap: 7 }}>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <Txt style={{ fontFamily: "DMBold" }}>{row.category}</Txt>
            <Txt>
              {fmt(row.cents)} · {row.percent.toFixed(1)}% · {row.count}{" "}
              purchase{row.count === 1 ? "" : "s"}
            </Txt>
          </View>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${row.category} share of spending`}
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(row.percent),
              text: `${row.percent.toFixed(1)} percent, ${fmt(row.cents)}`,
            }}
            style={{
              height: 10,
              borderRadius: 5,
              backgroundColor: C.line,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 10,
                width: `${row.percent}%`,
                backgroundColor: C.green,
              }}
            />
          </View>
        </View>
      ))}
      <Txt style={s.muted}>
        Dining includes older “Food & drinks” purchases. Recurring bills appear
        here only after you record the paid household expense.
      </Txt>
    </View>
  );
}
