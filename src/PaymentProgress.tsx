import React from "react";
import { View } from "react-native";
import { C, Txt } from "./ui";
import { transferProgress } from "../supabase/functions/_shared/payment-rules";
import {
  arrivalEstimate,
  failureExplanation,
} from "../supabase/functions/_shared/payment-safety";
export function PaymentProgress({
  status,
  created_at,
  funding,
  failureCode,
  recipient,
}: {
  status: string;
  created_at?: string;
  funding?: string;
  failureCode?: string | null;
  recipient?: string;
}) {
  const estimate =
    created_at && recipient !== "app"
      ? arrivalEstimate(created_at, funding, status)
      : null;
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
      {estimate && (
        <View style={{ gap: 5 }}>
          <Txt style={{ fontFamily: "DMBold" }}>
            Estimated recipient bank arrival: {estimate.earliest} –{" "}
            {estimate.latest}
          </Txt>
          <Txt style={{ color: C.muted }}>
            Planning estimate in UTC, not a confirmed payout date. Weekends
            excluded; holidays, bank reviews, and the recipient’s payout
            schedule may delay arrival. Payment completion does not confirm
            money is available in their bank.
          </Txt>
          {estimate.overdue && (
            <Txt style={{ color: C.red }}>
              The estimated window has passed. Refresh status and ask the
              recipient to check their bank; contact support with this payment
              reference. Do not pay again while it is processing.
            </Txt>
          )}
        </View>
      )}
      {status === "failed" && (
        <Txt style={{ color: C.red }}>
          Why it failed: {failureExplanation(failureCode)}
        </Txt>
      )}
      <Txt style={{ color: progress.step === 0 ? C.red : C.muted }}>
        {progress.detail}
      </Txt>
    </View>
  );
}
