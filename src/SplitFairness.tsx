import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { money, type Member, type Share } from "./core";
import { analyzeSplitFairness, unevenShareThreshold } from "./splitFairness";
import type { SplitTemplate } from "./splitTemplates";
import { C, Chip, Title, Txt, s } from "./ui";

export function SplitFairness({
  cents,
  selected,
  shares,
  percentages,
  mode,
  members,
  currency,
  calculationError,
}: {
  cents: number;
  selected: string[];
  shares: Share[];
  percentages: SplitTemplate["allocations"] | null;
  mode: "equal" | "custom" | "percentage";
  members: Member[];
  currency?: string;
  calculationError: string;
}) {
  const [open, setOpen] = useState(false);
  const header = (
    <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
      <Title style={{ fontSize: 19 }}>Split fairness</Title>
      <Chip
        active={open}
        label={open ? "Hide fairness check" : "Check fairness"}
        onPress={() => setOpen(!open)}
      />
    </View>
  );
  if (!open) return header;
  const result = analyzeSplitFairness(
    cents,
    selected,
    shares,
    percentages,
    mode,
    calculationError,
  );
  const rows = new Map(result.rows.map((row) => [row.member_id, row]));
  const participants = new Set(selected);
  const uneven = result.rows.some((row) => row.comparison);
  const formatPercentage = (value: number) => `${Number(value.toFixed(2))}%`;

  return (
    <View style={styles.panel}>
      {header}
      <Txt style={s.muted}>
        Compared with an equal split among selected roommates. Unequal
        allocations can be intentional and are valid when they add up to the
        purchase total.
      </Txt>
      {result.error ? (
        <Txt style={styles.error} accessibilityLiveRegion="polite">
          Split incomplete or invalid. {result.error}
        </Txt>
      ) : (
        <Txt accessibilityLiveRegion="polite">
          {uneven
            ? `Valid split. Highlighted shares are at least ${unevenShareThreshold} percentage points above or below equal, after allowing for cent rounding.`
            : "Valid split. No large differences from equal."}
        </Txt>
      )}
      <View style={styles.row}>
        <Txt style={[styles.cell, styles.heading]}>Roommate</Txt>
        <Txt style={[styles.cell, styles.heading]}>Assigned</Txt>
        <Txt style={[styles.cell, styles.heading]}>Vs. equal</Txt>
      </View>
      {members.map(({ id, name, left_at }) => {
        const share = rows.get(id);
        const excluded = !participants.has(id);
        const amount = share ? money(share.amount, currency) : "—";
        const allocation = excluded
          ? "Not included"
          : share
            ? `${formatPercentage(share.percentage)} · ${amount}`
            : "—";
        const difference = !share
          ? "—"
          : !share.difference
            ? "Same"
            : `${share.difference < 0 ? "−" : "+"}${money(Math.abs(share.difference), currency)}`;
        return (
          <View key={id} style={[styles.row, styles.memberRow]}>
            <Txt style={styles.cell}>
              {name}
              {left_at ? " · former" : ""}
            </Txt>
            <View style={styles.cell}>
              <Txt accessibilityLabel={`${name}, assigned: ${allocation}`}>
                {allocation}
              </Txt>
              {share?.percentage === 0 && (
                <Txt style={s.muted}>Assigned zero</Txt>
              )}
            </View>
            <View style={styles.cell}>
              <Txt accessibilityLabel={`${name}, vs. equal: ${difference}`}>
                {difference}
              </Txt>
              {share?.comparison && (
                <Txt
                  style={s.muted}
                  accessibilityLabel={`${name}: ${share.comparison === "high" ? "Higher" : "Lower"} share`}
                >
                  {share.comparison === "high" ? "Higher share" : "Lower share"}
                </Txt>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 9,
    padding: 10,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 9,
  },
  row: { flexDirection: "row", gap: 6 },
  cell: { flex: 1, minWidth: 0 },
  heading: { fontFamily: "DMBold", fontSize: 12 },
  memberRow: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 },
  error: { color: C.red },
});
