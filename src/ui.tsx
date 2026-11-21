import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  useWindowDimensions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import {
  ShoppingBasket,
  ArrowUpRight,
  Leaf,
  Home,
  Receipt,
  Wallet,
  Users,
  Plus,
  ChevronRight,
  Check,
  X,
  Camera,
  Image as ImageIcon,
  Search,
  SlidersHorizontal,
  ArrowLeft,
  ArrowRight,
  LogOut,
  Copy,
  CheckCircle2,
  Trash2,
  Pencil,
  CalendarDays,
  ChevronDown,
  Settings,
  Mail,
  Lock,
  ArrowDownLeft,
  RefreshCw,
  Link,
  Info,
  Coffee,
  Wifi,
  SprayCan,
  UtensilsCrossed,
  ShoppingBag,
} from "lucide-react-native";
export const icons = {
  ShoppingBasket,
  ArrowUpRight,
  Leaf,
  Home,
  Receipt,
  Wallet,
  Users,
  Plus,
  ChevronRight,
  Check,
  X,
  Camera,
  ImageIcon,
  Search,
  SlidersHorizontal,
  ArrowLeft,
  ArrowRight,
  LogOut,
  Copy,
  CheckCircle2,
  Trash2,
  Pencil,
  CalendarDays,
  ChevronDown,
  Settings,
  Mail,
  Lock,
  ArrowDownLeft,
  RefreshCw,
  Link,
  Info,
  Coffee,
  Wifi,
  SprayCan,
  UtensilsCrossed,
  ShoppingBag,
};
export type IconName = keyof typeof icons;
export const C = {
  bg: "#F8F9F5",
  white: "#FFFFFF",
  ink: "#253C32",
  muted: "#637267",
  line: "#E6EAE3",
  green: "#397754",
  dark: "#204E39",
  sage: "#EAF1E5",
  lime: "#DCEABF",
  orange: "#E8AF75",
  red: "#AE4E43",
};
export function Icon({
  name,
  size = 20,
  color = C.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const I = icons[name];
  return (
    <I
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      size={size}
      color={color}
      strokeWidth={1.7}
    />
  );
}
const TextPreferences = createContext({
  scale: 1,
  setLarge: (_large: boolean) => {},
});
export function AccessibilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    AsyncStorage.getItem("splitcart-large-text")
      .then((v) => {
        if (v === "true") setScale(1.2);
      })
      .catch(() => {});
  }, []);
  const setLarge = (large: boolean) => {
    setScale(large ? 1.2 : 1);
    void AsyncStorage.setItem("splitcart-large-text", String(large)).catch(
      () => {},
    );
  };
  return (
    <TextPreferences.Provider value={{ scale, setLarge }}>
      {children}
    </TextPreferences.Provider>
  );
}
export function AccessibilitySettings() {
  const { scale, setLarge } = useContext(TextPreferences);
  return (
    <View style={[s.card, { gap: 16 }]}>
      <Title style={{ fontSize: 25 }}>Accessibility</Title>
      <Txt>
        Text follows your device’s text-size setting. You can also increase text
        size within SplitCart.
      </Txt>
      <Button
        secondary
        label={scale > 1 ? "Use standard text size" : "Use larger text"}
        onPress={() => setLarge(scale === 1)}
      />
    </View>
  );
}
export function Txt({ children, style, ...rest }: any) {
  const { scale } = useContext(TextPreferences);
  const flat = StyleSheet.flatten(style) || {};
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: "DM", fontSize: 14, color: C.ink },
        style,
        {
          fontSize: (flat.fontSize || 14) * scale,
          ...(flat.lineHeight ? { lineHeight: flat.lineHeight * scale } : {}),
        },
      ]}
    >
      {children}
    </Text>
  );
}
export function Title({ children, style }: any) {
  return (
    <Txt
      accessibilityRole="header"
      style={[
        { fontFamily: "Fraunces", fontSize: 34, letterSpacing: -1 },
        style,
      ]}
    >
      {children}
    </Txt>
  );
}
export function Button({
  label,
  accessibilityLabel,
  onPress,
  icon,
  secondary = false,
  small = false,
  danger = false,
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  small?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed, hovered }: any) => [
        {
          minHeight: small ? 44 : 48,
          flexShrink: 1,
          paddingHorizontal: small ? 14 : 20,
          borderRadius: 10,
          flexDirection: "row",
          gap: 9,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: danger ? "#FBEFEC" : secondary ? C.white : C.green,
          borderWidth: secondary ? 1 : 0,
          borderColor: C.line,
          opacity: disabled || loading ? 0.6 : pressed ? 0.8 : 1,
          transform: [{ translateY: hovered ? -1 : 0 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? C.green : C.white} />
      ) : (
        icon && (
          <Icon
            name={icon}
            size={small ? 16 : 18}
            color={danger ? C.red : secondary ? C.ink : C.white}
          />
        )
      )}
      <Txt
        style={{
          fontFamily: "DMBold",
          fontSize: 14,
          flexShrink: 1,
          textAlign: "center",
          color: danger ? C.red : secondary ? C.ink : C.white,
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  multiline = false,
  ...inputProps
}: any) {
  const { scale } = useContext(TextPreferences);
  return (
    <View style={{ gap: 8, flex: 1, minWidth: 100 }}>
      <Txt style={{ fontFamily: "DMBold", fontSize: 12 }}>{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={C.muted}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        {...inputProps}
        style={{
          borderWidth: 1,
          borderColor: C.line,
          borderRadius: 9,
          paddingHorizontal: 14,
          paddingVertical: 13,
          fontFamily: "DM",
          fontSize: 16 * scale,
          color: C.ink,
          backgroundColor: C.white,
          minHeight: 48,
          ...(multiline ? { minHeight: 90, textAlignVertical: "top" } : {}),
        }}
      />
    </View>
  );
}
export function Chip({
  label,
  active = false,
  onPress,
  icon,
  leading,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: IconName;
  leading?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-pressed={active}
      onPress={onPress}
      style={{
        minHeight: 44,
        maxWidth: "100%",
        flexShrink: 1,
        flexDirection: "row",
        gap: 6,
        alignItems: "center",
        paddingHorizontal: 13,
        paddingVertical: 9,
        borderRadius: 8,
        backgroundColor: active ? C.sage : C.white,
        borderWidth: 1,
        borderColor: active ? "#A7C3A8" : C.line,
      }}
    >
      {leading}
      {icon && <Icon name={icon} size={14} color={C.green} />}
      <Txt
        style={{
          fontSize: 14,
          flexShrink: 1,
          color: active ? C.green : C.muted,
          fontFamily: active ? "DMBold" : "DM",
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}
const avatarColors = [
  ["#E8EDDC", "#63764A"],
  ["#F2E3D9", "#9D7357"],
  ["#E5E5F1", "#7A749B"],
  ["#E8ECEB", "#637E7A"],
];
export function Avatar({
  name,
  index = 0,
  size = 36,
}: {
  name: string;
  index?: number;
  size?: number;
}) {
  const c = avatarColors[index % 4];
  return (
    <View
      style={{
        height: size,
        width: size,
        borderRadius: size / 2,
        backgroundColor: c[0],
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: C.white,
      }}
    >
      <Txt style={{ fontFamily: "DMBold", fontSize: size * 0.31, color: c[1] }}>
        {name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </Txt>
    </View>
  );
}
export function CategoryIcon({
  category,
  size = 43,
}: {
  category: string;
  size?: number;
}) {
  const names: Record<string, IconName> = {
    Groceries: "ShoppingBasket",
    Household: "SprayCan",
    Utilities: "Wifi",
    "Food & drinks": "UtensilsCrossed",
    Other: "ShoppingBag",
  };
  const colors: Record<string, string> = {
    Groceries: "#EDF2E3",
    Household: "#F7EDE1",
    Utilities: "#EBECF8",
    "Food & drinks": "#F8E9E5",
    Other: "#E9F0EC",
  };
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        backgroundColor: colors[category] || C.sage,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon
        name={names[category] || "ShoppingBag"}
        size={size * 0.45}
        color={
          category === "Utilities"
            ? "#8D86AF"
            : category === "Household"
              ? "#B18B5A"
              : C.green
        }
      />
    </View>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", padding: 36, gap: 12 }}>
      <View style={{ padding: 15, borderRadius: 50, backgroundColor: C.sage }}>
        <Icon name="ShoppingBasket" size={30} color={C.green} />
      </View>
      <Title style={{ fontSize: 23 }}>{title}</Title>
      <Txt
        style={{
          color: C.muted,
          textAlign: "center",
          maxWidth: 300,
          lineHeight: 22,
        }}
      >
        {description}
      </Txt>
      {action}
    </View>
  );
}
export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  card: {
    backgroundColor: C.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 22,
  },
  muted: { color: C.muted, fontSize: 12 },
  label: {
    fontFamily: "DMBold",
    fontSize: 11,
    letterSpacing: 1.4,
    color: C.muted,
  },
  divider: { height: 1, backgroundColor: C.line },
  gap: { gap: 18 },
  link: { color: C.green, fontFamily: "DMBold", fontSize: 12 },
});

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(22,40,29,0.36)",
          justifyContent: "center",
          alignItems: "center",
          padding: width > 600 ? 28 : 10,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 620,
            maxHeight: "95%",
            backgroundColor: C.bg,
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <View
            style={[
              s.between,
              {
                padding: 21,
                borderBottomWidth: 1,
                borderColor: C.line,
                backgroundColor: C.white,
              },
            ]}
          >
            <Title style={{ fontSize: 25 }}>{title}</Title>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              onPress={onClose}
              style={{ padding: 7 }}
            >
              <Icon name="X" />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 23, gap: 20 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
