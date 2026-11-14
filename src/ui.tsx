import React from "react";
import {
  ActivityIndicator,
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
  return <I size={size} color={color} strokeWidth={1.7} />;
}
export function Txt({ children, style, ...rest }: any) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: "DM", fontSize: 14, color: C.ink }, style]}
    >
      {children}
    </Text>
  );
}
export function Title({ children, style }: any) {
  return (
    <Txt
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
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed, hovered }: any) => [
        {
          minHeight: small ? 38 : 48,
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
          fontSize: small ? 12 : 14,
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
}: any) {
  return (
    <View style={{ gap: 8, flex: 1, minWidth: 100 }}>
      <Txt style={{ fontFamily: "DMBold", fontSize: 12 }}>{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#969D96"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        style={{
          borderWidth: 1,
          borderColor: C.line,
          borderRadius: 9,
          paddingHorizontal: 14,
          paddingVertical: 13,
          fontFamily: "DM",
          fontSize: 14,
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
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
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
      {icon && <Icon name={icon} size={14} color={C.green} />}
      <Txt
        style={{
          fontSize: 12,
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
