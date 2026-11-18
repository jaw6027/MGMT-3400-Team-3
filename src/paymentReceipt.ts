import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
export async function downloadReceipt(id: string, text: string) {
  const filename = `splitcart-receipt-${id.replace(/[^a-z0-9-]/gi, "")}.txt`;
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("Receipt sharing is unavailable on this device.");
    const file = new File(Paths.cache, filename);
    file.write(text);
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/plain",
      dialogTitle: "Save payment receipt",
    });
  }
}
