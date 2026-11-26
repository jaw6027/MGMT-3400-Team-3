import React from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { C, Title, Txt } from "./ui";
export const chartColors = [
  "#397754",
  "#CE945D",
  "#7775A5",
  "#57969A",
  "#A3AF66",
  "#B86C73",
  "#567794",
  "#8C745E",
  "#8C9790",
];
export function SpendingPieChart({
  rows,
  total,
}: {
  rows: { category: string; percent: number; cents: number }[];
  total: string;
}) {
  const radius = 78,
    circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Household spending pie chart. Total ${total}. ${rows.map((r) => `${r.category}: ${r.percent.toFixed(1)} percent`).join(". ")}`}
      style={{ alignItems: "center", paddingVertical: 10 }}
    >
      <View
        style={{
          width: 220,
          height: 220,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Svg
          width={220}
          height={220}
          viewBox="0 0 220 220"
          style={{ position: "absolute" }}
          accessible={false}
        >
          <Circle
            cx={110}
            cy={110}
            r={radius}
            fill="none"
            stroke={C.line}
            strokeWidth={35}
          />
          {rows
            .filter((r) => r.cents > 0)
            .map((r, i) => {
              const length = (r.percent / 100) * circumference,
                start = offset;
              offset += length;
              return (
                <Circle
                  key={r.category}
                  cx={110}
                  cy={110}
                  r={radius}
                  fill="none"
                  stroke={chartColors[i % chartColors.length]}
                  strokeWidth={35}
                  strokeDasharray={`${length} ${Math.max(0, circumference - length)}`}
                  strokeDashoffset={-start}
                  rotation={-90}
                  origin="110,110"
                />
              );
            })}
        </Svg>
        <Txt style={{ color: C.muted, fontSize: 11 }}>TOTAL SPENT</Txt>
        <Title style={{ fontSize: 22, maxWidth: 142, textAlign: "center" }}>
          {total}
        </Title>
        <Txt style={{ color: C.muted, fontSize: 10 }}>Your household</Txt>
      </View>
    </View>
  );
}
