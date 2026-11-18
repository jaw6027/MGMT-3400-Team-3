import { test, expect, Page } from "@playwright/test";
async function verifySampleSecurity(page: import("@playwright/test").Page) {
  await page.getByLabel("Authenticator code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify security code", exact: true })
    .click();
}
const signout = async (page: Page) => {
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await page
    .getByRole("button", { name: "Switch preview account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open sample household", exact: true })
    .waitFor();
};
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  const entry = page.getByRole("button", {
    name: "Open sample household",
    exact: true,
  });
  await entry.waitFor();
  expect((await entry.boundingBox())!.y).toBeLessThan(200);
  await page
    .getByRole("button", { name: "Open sample household", exact: true })
    .click();
  await page.getByText("Recent purchases", { exact: true }).waitFor();
});
test("packaged page runs without external requests: purchases, custom splits, uploaded receipts, editing, and deletion", async ({
  page,
}) => {
  const failures: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://localhost:8083") &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await page
    .getByRole("button", { name: "Add a purchase", exact: true })
    .click();
  await page
    .getByLabel("What did you buy? *", { exact: true })
    .fill("Browser preview groceries");
  await page.getByLabel("Total (USD) *", { exact: true }).fill("10.01");
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  for (const [name, amount] of [
    ["Alex Morgan", "4.01"],
    ["Jordan Lee", "2"],
    ["Sam Rivera", "2"],
    ["Riley Chen", "2"],
  ])
    await page.getByLabel(name + " custom share").fill(amount);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose photo", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page
    .getByRole("button", { name: "Save purchase", exact: true })
    .click();
  await expect(
    page.getByText("Purchase saved. Everyone’s share is accounted for."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  await page.getByLabel("Search purchases").fill("Browser preview");
  await page
    .getByRole("button", {
      name: "View Browser preview groceries",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Open receipt viewer" }).click();
  await expect(
    page.getByText("Shared privately with your household.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).last().click();
  await page
    .getByRole("button", { name: "Edit purchase", exact: true })
    .click();
  await expect(page.getByLabel("Alex Morgan custom share")).toHaveValue("4.01");
  await page
    .getByLabel("What did you buy? *", { exact: true })
    .fill("Edited preview purchase");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByLabel("Search purchases").fill("Edited preview");
  await page
    .getByRole("button", { name: "View Edited preview purchase", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete purchase", exact: true })
    .click();
  await expect(page.getByText("Nothing here just yet")).toBeVisible();
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
});
test("separate preview logins, household codes, custom names, profile persistence, and payer permissions", async ({
  page,
}) => {
  await signout(page);
  await page
    .getByText("New to SplitCart? Create an account", { exact: true })
    .click();
  await page.getByLabel("Your name", { exact: true }).fill("Taylor Preview");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("taylor@example.test");
  await page.getByLabel("Password", { exact: true }).fill("preview-pass123");
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Browser Family");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("Your household is ready", { exact: true }),
  ).toBeVisible();
  const code = (
    await page.getByLabel("Household invitation code").innerText()
  ).replace(/\s/g, "");
  await page
    .getByRole("button", { name: "Go to dashboard", exact: true })
    .click();
  await signout(page);
  await page
    .getByText("New to SplitCart? Create an account", { exact: true })
    .click();
  await page.getByLabel("Your name", { exact: true }).fill("Second Roommate");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("second@example.test");
  await page.getByLabel("Password", { exact: true }).fill("preview-pass123");
  await page
    .getByRole("button", { name: "Join with a code", exact: true })
    .click();
  await page
    .getByLabel("Invitation code", { exact: true })
    .fill(code.toUpperCase());
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByText("Hey Second, welcome home.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await expect(page.getByText("Taylor Preview", { exact: true })).toBeVisible();
  await page
    .getByLabel("Household name", { exact: true })
    .fill("Renamed Browser Family");
  await page
    .getByRole("button", { name: "Save household name", exact: true })
    .click();
  await page.getByLabel("Display name", { exact: true }).fill("Second Updated");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.reload();
  await expect(
    page.getByText("Hey Second, welcome home.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Renamed Browser Family", { exact: true }).first(),
  ).toBeVisible();
  await signout(page);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("jordan@splitcart.demo");
  await page.getByLabel("Password", { exact: true }).fill("splitcart-demo");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  await page
    .getByRole("button", { name: "View Weekly grocery run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit purchase", exact: true }),
  ).toHaveCount(0);
});
test("simulates card and bank payments, manual repayments, autopay consent, and reminder settings", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await page
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await page.getByLabel("Amount (USD)", { exact: true }).fill("1.00");
  await page
    .getByRole("button", { name: "Confirm recorded payment", exact: true })
    .click();
  await expect(
    page.getByText("Repayment recorded. Your balances are up to date."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Manage payments", exact: true })
    .click();
  await verifySampleSecurity(page);
  await page
    .getByRole("button", { name: "Add sample credit card", exact: true })
    .click();
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("10.20");
  await expect(
    page.getByText("Estimated total: $10.46", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    page.getByText("Total charged: $10.46", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm demo payment", exact: true })
    .click();
  await expect(
    page.getByText("Demo payment simulated. No money moved.", { exact: true }),
  ).toBeVisible();
  const db = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("splitcart-browser-preview-v1")!),
  );
  expect(db.repayments).toHaveLength(3);
  expect(db.repayments[0].cents).toBe(1020);
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page
    .getByRole("button", { name: "Add sample bank", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Complete sample bank verification",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Autopay", exact: true }).click();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("25");
  await page
    .getByLabel("Monthly due day (1–28, UTC)", { exact: true })
    .fill("8");
  await page
    .getByRole("switch", {
      name: "Automatically pay this monthly due",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save monthly due", exact: true })
    .click();
  await expect(
    page.getByText("Choose a bank account and authorize automatic payments.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("switch", {
      name: "I authorize the selected bank account to be charged this amount each month on the due day until I cancel",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save monthly due", exact: true })
    .click();
  await expect(
    page.getByText("Day 8 each month (UTC) · Bank autopay · Demo", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reminders", exact: true }).click();
  await page
    .getByLabel("Reminder phone number", { exact: true })
    .fill("+12025550123");
  await page
    .getByRole("switch", {
      name: "I agree to receive payment reminders and verification texts. Message/data rates may apply; reply STOP to stop texts",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Send phone verification code", exact: true })
    .click();
  await page
    .getByLabel("Phone verification code", { exact: true })
    .fill("123456");
  await page.getByRole("button", { name: "Verify phone", exact: true }).click();
  await page
    .getByRole("switch", { name: "Email payment reminders", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "Text payment reminders", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save reminder preferences", exact: true })
    .click();
  await expect(
    page.getByText(
      "Demo reminder preferences saved. No text or email will be sent.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await page
    .getByRole("button", { name: "Manage payments", exact: true })
    .click();
  await verifySampleSecurity(page);
  await page.getByRole("button", { name: "Reminders", exact: true }).click();
  await expect(
    page.getByLabel("Reminder phone number", { exact: true }),
  ).toHaveValue("+12025550123");
  await page.getByRole("button", { name: "Autopay", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Cancel monthly due to Jordan Lee",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("No monthly dues scheduled.", { exact: true }),
  ).toBeVisible();
});

test("upcoming dues link to completed payments, searchable history, and downloadable receipts", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await button("Manage payments").click();
  await verifySampleSecurity(page);
  await button("Add sample bank").click();
  await button("Complete sample bank verification").click();
  await button("Autopay").click();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("42.50");
  const day = Math.min(new Date().getUTCDate(), 28);
  await page
    .getByLabel("Monthly due day (1–28, UTC)", { exact: true })
    .fill(String(day));
  await button("Save monthly due").click();
  await button("Upcoming").click();
  await expect(
    page.getByText("$42.50 to Jordan Lee", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Autopay off · Pay manually", { exact: true }),
  ).toBeVisible();
  const payDue = page.getByRole("button", {
    name: /^Pay due to Jordan Lee on/,
  });
  const name = await payDue.getAttribute("aria-label");
  await payDue.click();
  await expect(
    page.getByLabel("Payment amount (USD)", { exact: true }),
  ).not.toBeEditable();
  await button("Review payment").click();
  await button("Confirm demo payment").click();
  await button("Activity").click();
  await page.getByLabel("Search payment history").fill("Jordan");
  await expect(
    page.getByText("$42.50 to Jordan Lee · Completed (demo)", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download receipt / }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^splitcart-receipt-.*\.txt$/);
  const { readFileSync } = await import("node:fs");
  const receipt = readFileSync((await download.path())!, "utf8");
  expect(receipt).toContain("Total: $42.50 USD");
  expect(receipt).toContain("DEMO — no money moved");
  expect(receipt).toContain("Demo checking");
  await page.getByLabel("Search payment history").fill("no-match");
  await expect(page.getByText("No payments match your search.")).toBeVisible();
  await button("Upcoming").click();
  await expect(
    page.getByRole("button", { name: name!, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(
    page.getByText("Upcoming payments", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("$42.50 to Jordan Lee", { exact: true }),
  ).toBeVisible();
});
test("autopay schedules can be edited and paused without losing the schedule", async ({
  page,
}) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button("Manage payments").click();
  await verifySampleSecurity(page);
  await button("Add sample bank").click();
  await button("Complete sample bank verification").click();
  await button("Autopay").click();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("25");
  await page
    .getByLabel("Monthly due day (1–28, UTC)", { exact: true })
    .fill("8");
  await page
    .getByRole("switch", {
      name: "Automatically pay this monthly due",
      exact: true,
    })
    .click();
  const consent =
    "I authorize the selected bank account to be charged this amount each month on the due day until I cancel";
  await page.getByRole("switch", { name: consent, exact: true }).click();
  await button("Save monthly due").click();
  await button("Pause monthly due to Jordan Lee").click();
  await expect(
    page.getByText("Paused · No future automatic charge or due reminders", {
      exact: true,
    }),
  ).toBeVisible();
  await button("Edit monthly due to Jordan Lee").click();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("30");
  await button("Save schedule changes").click();
  await expect(
    page.getByText("Choose a bank account and authorize automatic payments.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("switch", { name: consent, exact: true }).click();
  await button("Save schedule changes").click();
  await expect(
    page.getByText("$30.00 to Jordan Lee", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Next automatic charge: .* \$30.00/),
  ).toBeVisible();
  const dues = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("splitcart-payments-demo-v1-"),
    )!;
    return JSON.parse(localStorage.getItem(key)!).dues;
  });
  expect(dues).toHaveLength(1);
  expect(dues[0].paused).toBe(false);
  expect(dues[0].cents).toBe(3000);
});
test("roommates can request payment with a purchase and see the paid result across preview accounts", async ({
  page,
}) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button("Manage payments").click();
  await verifySampleSecurity(page);
  await button("Requests").click();
  await page.getByLabel("Requested amount (USD)").fill("12.75");
  await page.getByLabel("Request note (optional)").fill("Your grocery share");
  await button("Weekly grocery run").click();
  await button("Send payment request").click();
  await expect(
    page.getByText("$12.75 · Requested from Jordan Lee", { exact: true }),
  ).toBeVisible();
  await signout(page);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("jordan@splitcart.demo");
  await page.getByLabel("Password", { exact: true }).fill("splitcart-demo");
  await button("Log in").click();
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button("Manage payments").click();
  await verifySampleSecurity(page);
  await button("Add sample bank").click();
  await button("Complete sample bank verification").click();
  await button("Requests").click();
  await expect(
    page.getByText("Purchase: Weekly grocery run", { exact: true }),
  ).toBeVisible();
  await button("Pay request from Alex Morgan").click();
  await button("Review payment").click();
  await button("Confirm demo payment").click();
  await button("Requests").click();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  await expect(button("Pay request from Alex Morgan")).toHaveCount(0);
  await signout(page);
  await button("Open sample household").click();
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button("Manage payments").click();
  await verifySampleSecurity(page);
  await button("Requests").click();
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  await expect(button("Cancel request to Jordan Lee")).toHaveCount(0);
});
test("larger text persists, browser biometrics are unavailable, and reset preview is honest", async ({
  page,
}) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await expect(button("Enable biometric unlock")).toBeDisabled();
  await button("Use larger text").click();
  await page.reload();
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await expect(button("Use standard text size")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await button("Use standard text size").click();
  await signout(page);
  await button("Forgot password?").click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("alex@splitcart.demo");
  await button("Send password reset link").click();
  await expect(
    page.getByText(/Preview only: no password-reset email was sent/),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await button("Back to login").click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("pending, processing and failed history entries explain the next step without claiming completion", async ({
  page,
}) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button("Manage payments").click();
  await verifySampleSecurity(page);
  await button("Add sample bank").click();
  await button("Complete sample bank verification").click();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("splitcart-payments-demo-v1-"),
    )!;
    const state = JSON.parse(localStorage.getItem(key)!);
    state.payments = ["created", "processing", "failed"].map((status, i) => ({
      id: `sample-status-${i}`,
      recipient: "app",
      cents: 500,
      fee: 0,
      status,
      created_at: new Date().toISOString(),
      methodLabel: "Sample checking •••• 6789",
    }));
    localStorage.setItem(key, JSON.stringify(state));
  });
  await button("Refresh payment status").click();
  await button("Activity").click();
  await expect(
    page.getByText("$5.00 to SplitCart · Pending (demo)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("$5.00 to SplitCart · Processing (demo)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("$5.00 to SplitCart · Failed (demo)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/bank is processing this payment/)).toBeVisible();
  await expect(
    page.getByText(/Check your bank details and available funds/),
  ).toBeVisible();
});

test("bank linking requires two-step verification and bank ownership completion before a payment", async ({
  page,
}) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button("Manage payments").click();
  await expect(button("Add sample bank")).toBeDisabled();
  await page.getByLabel("Authenticator code").fill("000000");
  await button("Verify security code").click();
  await expect(
    page.getByText("Use sample code 123456.", { exact: true }),
  ).toBeVisible();
  await verifySampleSecurity(page);
  await button("Add sample bank").click();
  await expect(
    page.getByText("Bank ownership verification pending", { exact: true }),
  ).toBeVisible();
  await button("Pay").click();
  await page.getByLabel("Payment amount (USD)", { exact: true }).fill("5");
  await button("Review payment").click();
  await expect(
    page.getByText("Complete bank verification in Accounts before paying.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(button("Confirm demo payment")).toHaveCount(0);
  await button("Accounts").click();
  await button("Complete sample bank verification").click();
  await expect(
    page.getByText("Bank ownership verified · Ready to pay", { exact: true }),
  ).toBeVisible();
  await button("Pay").click();
  await button("Review payment").click();
  await expect(button("Confirm demo payment")).toBeVisible();
});
test("cash repayments are explicitly marked in household history and update balances", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await page
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByLabel("Amount (USD)", { exact: true }).fill("12.50");
  await expect(
    page.getByText(/Only record cash that has already been handed over/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm cash payment", exact: true })
    .click();
  await expect(page.getByText(/Cash payment ·/)).toBeVisible();
  const db = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("splitcart-browser-preview-v1")!),
  );
  expect(db.repayments[0].method).toBe("cash");
  expect(db.repayments[0].cents).toBe(1250);
});
test("advance autopay notices and payment updates persist with chosen delivery channels", async ({
  page,
}) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button("Manage payments").click();
  await button("Reminders").click();
  for (const name of [
    "Email/text advance autopay notices",
    "Email/text payment status updates",
    "Email payment reminders",
    "I agree to receive payment reminders and verification texts. Message/data rates may apply; reply STOP to stop texts",
  ])
    await page.getByRole("switch", { name, exact: true }).click();
  await button("Save reminder preferences").click();
  await page.reload();
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button("Manage payments").click();
  await button("Reminders").click();
  for (const name of [
    "Email/text advance autopay notices",
    "Email/text payment status updates",
    "Email payment reminders",
  ])
    await expect(page.getByRole("switch", { name, exact: true })).toBeChecked();
});
