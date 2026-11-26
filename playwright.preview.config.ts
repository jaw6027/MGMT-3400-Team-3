import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: [
    "**/browser-preview.spec.ts",
    "**/subscriptions.spec.ts",
    "**/documents-spending.spec.ts",
    "**/percentage-split.spec.ts",
    "**/split-templates.spec.ts",
    "**/split-comparison.spec.ts",
    "**/split-fairness.spec.ts",
    "**/shopping-preview.spec.ts",
    "**/chores-preview.spec.ts",
    "**/support-preview.spec.ts",
    "**/grocery-preview.spec.ts",
  ],
  use: { ...base.use, baseURL: "http://localhost:8083" },
  webServer: {
    command: "python3 -m http.server 8083 --bind 127.0.0.1 --directory preview",
    url: "http://localhost:8083",
    reuseExistingServer: true,
    timeout: 15000,
  },
});
