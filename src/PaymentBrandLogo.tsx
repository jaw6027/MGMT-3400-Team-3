import React from "react";
import { Image, View } from "react-native";
import { SvgCss } from "react-native-svg/css";
import { paymentBrandAssets } from "./paymentBrandAssets";
import { PaymentBrandId } from "./paymentBrands";
import { Icon, C } from "./ui";
export function PaymentBrandLogo({
  brand,
  size = 36,
}: {
  brand?: PaymentBrandId;
  size?: number;
}) {
  const asset = brand ? paymentBrandAssets[brand] : undefined;
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size + 10,
        height: size,
        flexShrink: 0,
        backgroundColor: "#fff",
        borderRadius: 6,
        padding: 3,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {!asset ? (
        <Icon name="Wallet" size={size * 0.6} color={C.muted} />
      ) : asset.format === "svg" ? (
        <SvgCss xml={asset.content} width="100%" height="100%" />
      ) : (
        <Image
          source={{ uri: asset.content }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="contain"
        />
      )}
    </View>
  );
}
