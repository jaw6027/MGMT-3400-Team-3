import React from "react";
import { View } from "react-native";
import { C, Txt } from "./ui";
import { transferProgress } from "../supabase/functions/_shared/payment-rules";
export function PaymentProgress({ status }: { status: string }) {
  const progress = transferProgress(status);
  return (
    <View style={{ gap: 10 }}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Roommate payment progress"
        accessibilityValue={{
          min: 0,
          max: 3,
          now: progress.step,
          text: progress.label,
        }}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
      >
        {["Started", "Processing", "Completed"].map((label, i) => (
          <View key={label} style={{ gap: 5, flexBasis: 85, flexGrow: 1 }}>
            <View
              style={{
                height: 5,
                borderRadius: 3,
                backgroundColor: progress.step > i ? C.green : C.line,
              }}
            />
            <Txt
              style={{
                fontFamily: progress.step === i + 1 ? "DMBold" : "DM",
                fontSize: 12,
              }}
            >
              {i + 1}. {label}
            </Txt>
          </View>
        ))}
      </View>
      <Txt style={{ color: progress.step === 0 ? C.red : C.muted }}>
        {progress.detail}
      </Txt>
    </View>
  );
}
