import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/households.spec.ts",
  use: { ...base.use, baseURL: "http://localhost:8082" },
  webServer: {
    command: "npx expo start --web --offline --port 8082",
    url: "http://localhost:8082",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      EXPO_PUBLIC_DEMO_MODE: "true",
      EXPO_PUBLIC_SUPABASE_URL: "https://splitcart-test.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "test-public-anon-key",
      EXPO_NO_TELEMETRY: "1",
    },
  },
});
