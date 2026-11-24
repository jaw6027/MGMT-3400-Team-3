import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { money, type Member } from "./core";
import {
  compareSplits,
  type ComparisonOption,
  type PurchaseSplit,
} from "./splitComparison";
import type { SplitTemplate } from "./splitTemplates";
import { Button, C, Chip, Title, Txt, s } from "./ui";

const methods = [
  { mode: "custom", label: "Custom dollars" },
  { mode: "percentage", label: "Percentages" },
  { mode: "template", label: "Saved template" },
] as const;

export function SplitComparison({
  cents,
  selected,
  members,
  currency,
  templates,
  customAmounts,
  percentages,
  onApply,
}: {
  cents: number;
  selected: string[];
  members: Member[];
  currency?: string;
  templates: SplitTemplate[];
  customAmounts: Record<string, string>;
  percentages: Record<string, string>;
  onApply: (split: PurchaseSplit) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ComparisonOption["mode"]>("custom");
  const [templateId, setTemplateId] = useState<string>();
  const [customEdits, setCustomEdits] = useState<Record<string, string>>({});
  const [percentageEdits, setPercentageEdits] = useState<
    Record<string, string>
  >({});
  const [notice, setNotice] = useState("");
  const toggle = () => {
    setOpen(!open);
    setNotice("");
  };
  const header = (
    <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
      <Title style={{ fontSize: 19 }}>Split comparison</Title>
      <Chip
        active={open}
        label={open ? "Hide comparison" : "Compare splits"}
        onPress={toggle}
      />
    </View>
  );
  if (!open) return header;

  const sortedTemplates = [...templates].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const template =
    sortedTemplates.find(({ id }) => id === templateId) ??
    (templateId === undefined ? sortedTemplates[0] : undefined);
  const dollars = { ...customAmounts, ...customEdits };
  const percents = { ...percentages, ...percentageEdits };
  const option: ComparisonOption =
    mode === "template"
      ? { mode, template }
      : mode === "custom"
        ? { mode, amounts: dollars }
        : {
            mode,
            allocations: selected.map((member_id) => ({
              member_id,
              percentage: (percents[member_id] || "").trim(),
            })),
          };
  const comparison = compareSplits(cents, selected, option, members);
  const label = methods.find((method) => method.mode === mode)!.label;
  const format = (value: number | null) =>
    value === null ? "—" : money(value, currency);
  const apply = (split: PurchaseSplit, name: string) => {
    onApply(split);
    if (split.mode === "custom") setCustomEdits({});
    if (split.mode === "percentage") setPercentageEdits({});
    setNotice(`Applied ${name} to this purchase.`);
  };

  return (
    <View style={styles.panel}>
      {header}
      <Txt style={s.muted}>
        Equal uses the roommates selected above. A saved template can include
        different roommates.
      </Txt>
      <View style={[s.row, styles.actions]}>
        {methods.map((method) => (
          <Chip
            key={method.mode}
            label={method.label}
            active={mode === method.mode}
            onPress={() => {
              setMode(method.mode);
              setNotice("");
            }}
          />
        ))}
      </View>
      {mode === "template" &&
        (sortedTemplates.length ? (
          <View style={[s.row, styles.actions]}>
            {sortedTemplates.map((entry) => (
              <Chip
                key={entry.id}
                label={entry.name}
                active={entry.id === template?.id}
                onPress={() => {
                  setTemplateId(entry.id);
                  setNotice("");
                }}
              />
            ))}
          </View>
        ) : (
          <Txt style={s.muted}>
            Create a template in Split templates to compare it here.
          </Txt>
        ))}
      <View style={styles.row}>
        <Txt style={styles.heading}>Roommate</Txt>
        <Txt style={styles.heading}>Equal</Txt>
        <Txt style={styles.heading}>{label}</Txt>
      </View>
      {comparison.rows.map(
        ({ memberId, equalCents, alternativeCents, difference }) => {
          const name =
            members.find(({ id }) => memberId === id)?.name ||
            "Former roommate";
          const equalAmount = format(equalCents);
          const alternativeAmount = format(alternativeCents);
          const delta =
            difference === null
              ? null
              : difference === 0
                ? "Same as equal"
                : `${difference > 0 ? "+" : "−"}${money(Math.abs(difference), currency)} vs equal`;
          return (
            <View key={memberId} style={[styles.row, styles.memberRow]}>
              <Txt style={styles.cell}>{name}</Txt>
              <Txt
                style={styles.cell}
                accessibilityLabel={`${name}, equal: ${equalAmount}`}
              >
                {equalAmount}
              </Txt>
              <View style={[styles.cell, { gap: 4 }]}>
                {mode !== "template" && (
                  <TextInput
                    accessibilityLabel={`${name} comparison ${mode === "custom" ? "dollars" : "percentage"}`}
                    keyboardType="decimal-pad"
                    placeholder={mode === "custom" ? "0.00" : "%"}
                    placeholderTextColor={C.muted}
                    value={
                      (mode === "custom" ? dollars : percents)[memberId] || ""
                    }
                    onChangeText={(value) => {
                      setNotice("");
                      if (mode === "custom")
                        setCustomEdits((previous) => ({
                          ...previous,
                          [memberId]: value,
                        }));
                      else
                        setPercentageEdits((previous) => ({
                          ...previous,
                          [memberId]: value,
                        }));
                    }}
                    style={styles.input}
                  />
                )}
                <Txt
                  accessibilityLabel={`${name}, ${label}: ${alternativeAmount}`}
                >
                  {alternativeAmount}
                </Txt>
                {delta && (
                  <Txt style={s.muted} accessibilityLabel={`${name}: ${delta}`}>
                    {delta}
                  </Txt>
                )}
              </View>
            </View>
          );
        },
      )}
      {comparison.equal.error && (
        <Txt style={styles.error}>Equal: {comparison.equal.error}</Txt>
      )}
      {comparison.alternative.error && (
        <Txt style={styles.error} accessibilityLiveRegion="polite">
          {label}: {comparison.alternative.error}
        </Txt>
      )}
      <View style={[s.row, styles.actions]}>
        <Button
          small
          secondary
          label="Apply equal"
          disabled={!comparison.equal.shares}
          onPress={() => apply({ mode: "equal" }, "equal splitting")}
        />
        <Button
          small
          label={
            mode === "template"
              ? "Apply template"
              : mode === "custom"
                ? "Apply custom dollars"
                : "Apply percentages"
          }
          disabled={!comparison.preferred}
          onPress={() => {
            if (comparison.preferred)
              apply(
                comparison.preferred,
                mode === "template" && template
                  ? template.name
                  : label.toLowerCase(),
              );
          }}
        />
      </View>
      {!!notice && (
        <Txt style={s.muted} accessibilityLiveRegion="polite">
          {notice}
        </Txt>
      )}
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
  actions: { flexWrap: "wrap", gap: 7 },
  row: { flexDirection: "row", gap: 6 },
  cell: { flex: 1, minWidth: 0 },
  heading: { flex: 1, minWidth: 0, fontFamily: "DMBold", fontSize: 12 },
  memberRow: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 },
  input: {
    width: "100%",
    maxWidth: 90,
    minHeight: 44,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 7,
    paddingHorizontal: 6,
    color: C.ink,
    fontFamily: "DM",
  },
  error: { color: C.red, fontSize: 12 },
});
