import React from "react";
import { View, Switch } from "react-native";
import { Member, money } from "./core";
import {
  ReceiptDraft,
  detailsFromDraft,
  calculateReceipt,
} from "./receiptItems";
import { Button, Chip, Field, Title, Txt, s, C } from "./ui";
export function ReceiptItemEditor({
  draft,
  onChange,
  members,
  currency,
  reviewed,
  onReviewed,
  busy,
  payerId,
}: {
  draft: ReceiptDraft;
  onChange: (d: ReceiptDraft) => void;
  members: Member[];
  currency: string;
  reviewed: boolean;
  onReviewed: (v: boolean) => void;
  busy: boolean;
  payerId: string;
}) {
  let result: ReturnType<typeof calculateReceipt> | undefined,
    error = "";
  try {
    result = calculateReceipt(
      detailsFromDraft(draft),
      members.map((m) => m.id),
    );
  } catch (e) {
    error = (e as Error).message;
  }
  const update = (
    index: number,
    patch: Partial<ReceiptDraft["items"][number]>,
  ) =>
    onChange({
      ...draft,
      items: draft.items.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  return (
    <View
      style={{
        gap: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: C.line,
        borderRadius: 12,
      }}
    >
      <Title style={{ fontSize: 23 }}>Receipt items & automatic split</Title>
      <Txt>
        Review each line total and choose who shares it. Tax, tip and discounts
        are allocated proportionally to each person’s item subtotal. No payment
        is sent when you save.
      </Txt>
      {draft.items.map((item, index) => (
        <View
          key={index}
          style={{
            gap: 9,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderColor: C.line,
          }}
        >
          <Field
            label={`Receipt item ${index + 1} name`}
            value={item.name}
            maxLength={120}
            onChangeText={(name: string) => update(index, { name })}
          />
          <Field
            label={`Receipt item ${index + 1} line total (${currency})`}
            value={item.amount}
            keyboardType="decimal-pad"
            onChangeText={(amount: string) => update(index, { amount })}
          />
          <Txt style={s.label}>SHARED BY</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
            {members.map((m) => (
              <Chip
                key={m.id}
                label={`${m.name} · item ${index + 1}`}
                active={item.members.includes(m.id)}
                onPress={() =>
                  update(index, {
                    members: item.members.includes(m.id)
                      ? item.members.filter((id) => id !== m.id)
                      : [...item.members, m.id],
                  })
                }
              />
            ))}
          </View>
          <Button
            secondary
            small
            label={`Remove receipt item ${index + 1}`}
            disabled={busy}
            onPress={() =>
              onChange({
                ...draft,
                items: draft.items.filter((_, i) => i !== index),
              })
            }
          />
        </View>
      ))}
      <Button
        secondary
        label="Add receipt item"
        disabled={busy || draft.items.length >= 100}
        onPress={() =>
          onChange({
            ...draft,
            items: [
              ...draft.items,
              {
                name: "",
                amount: "",
                members: members.filter((m) => !m.left_at).map((m) => m.id),
              },
            ],
          })
        }
      />
      {(
        [
          { key: "tax", label: "Receipt tax" },
          { key: "tip", label: "Receipt tip" },
          { key: "discount", label: "Receipt discount" },
          { key: "printedTotal", label: "Printed receipt total (optional)" },
        ] as const
      ).map((field) => (
        <Field
          key={field.key}
          label={`${field.label} (${currency})`}
          value={draft[field.key]}
          keyboardType="decimal-pad"
          onChangeText={(value: string) =>
            onChange({ ...draft, [field.key]: value })
          }
        />
      ))}
      <Title style={{ fontSize: 21 }}>Cashback tracker</Title>
      <Txt>
        Track cashback offered or received by your card or retailer. These are
        self-reported external rewards: SplitCart does not issue, verify or
        redeem cashback. Expected or received cashback never changes what
        roommates owe.
      </Txt>
      <Field
        label={`Expected cashback elsewhere (${currency})`}
        value={draft.expected}
        keyboardType="decimal-pad"
        onChangeText={(expected: string) => onChange({ ...draft, expected })}
      />
      <Field
        label={`Cashback received elsewhere (${currency})`}
        value={draft.received}
        keyboardType="decimal-pad"
        onChangeText={(received: string) => onChange({ ...draft, received })}
      />
      {error ? (
        <Txt style={{ color: C.red }}>{error}</Txt>
      ) : (
        result && (
          <View
            style={{
              gap: 7,
              backgroundColor: C.sage,
              padding: 12,
              borderRadius: 10,
            }}
          >
            <Txt style={{ fontFamily: "DMBold" }}>
              Calculated receipt total: {money(result.total, currency)}
            </Txt>
            {result.shares.map((share) => (
              <View key={share.member_id} style={{ gap: 2 }}>
                <Txt>
                  {members.find((m) => m.id === share.member_id)?.name}:{" "}
                  {money(share.cents, currency)}
                </Txt>
                <Txt style={s.muted}>
                  {share.member_id === payerId
                    ? "Payer’s own share · no repayment needed"
                    : `Owes ${members.find((m) => m.id === payerId)?.name || "the payer"} this amount`}
                </Txt>
              </View>
            ))}
          </View>
        )
      )}
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Txt style={{ flex: 1 }}>
          I reviewed the receipt items, assignments and total
        </Txt>
        <Switch
          accessibilityLabel="I reviewed the receipt items, assignments and total"
          value={reviewed}
          onValueChange={onReviewed}
        />
      </View>
    </View>
  );
}
