import { test, expect } from "@playwright/test";
async function verifySampleSecurity(page: import("@playwright/test").Page) {
  await page.getByLabel("Authenticator code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify security code", exact: true })
    .click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByText("Recent purchases", { exact: true }).waitFor();
});
test("phone: add custom expense, preserve shares on edit, inspect receipt, filter and delete", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.getByText("DEMO MODE")).toBeVisible();
  await page
    .getByRole("button", { name: "Add a purchase", exact: true })
    .click();
  await page
    .getByLabel("What did you buy? *", { exact: true })
    .fill("Test pantry restock");
  await page.getByLabel("Total (USD) *", { exact: true }).fill("10.01");
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByLabel("Alex Morgan custom share").fill("4.01");
  await page.getByLabel("Jordan Lee custom share").fill("2");
  await page.getByLabel("Sam Rivera custom share").fill("2");
  await page.getByLabel("Riley Chen custom share").fill("1");
  await page
    .getByRole("button", { name: "Save purchase", exact: true })
    .click();
  await expect(
    page.getByText("Shares must add up to the purchase total."),
  ).toBeVisible();
  await page.getByLabel("Riley Chen custom share").fill("2");
  await page.getByText("Try a sample receipt", { exact: true }).click();
  await page
    .getByRole("button", { name: "Save purchase", exact: true })
    .click();
  await expect(
    page.getByText("Purchase saved. Everyone’s share is accounted for."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  await page.getByLabel("Search purchases").fill("Test pantry");
  await page
    .getByRole("button", { name: "View Test pantry restock", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit purchase", exact: true })
    .click();
  await expect(page.getByLabel("Alex Morgan custom share")).toHaveValue("4.01");
  await page
    .getByLabel("What did you buy? *", { exact: true })
    .fill("Test pantry updated");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("button", { name: "View Test pantry updated", exact: true })
    .click();
  await page.getByRole("button", { name: "Open receipt viewer" }).click();
  await expect(
    page.getByText("Shared privately with your household."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).last().click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText(
      "Delete this purchase? Its shares will be removed and everyone’s balance will change.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete purchase", exact: true })
    .click();
  await expect(page.getByText("Nothing here just yet")).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("phone: record repayment, update profile and restrict another payer’s purchase", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  await page.getByRole("button", { name: "View Keeping things clean" }).click();
  await expect(
    page.getByRole("button", { name: "Edit purchase", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await expect(
    page.getByText("SplitCart calculates balances and records payments.", {
      exact: false,
    }),
  ).toBeVisible();
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
  const raw = await page.evaluate(() =>
    localStorage.getItem("splitcart-demo-v1"),
  );
  expect(JSON.parse(raw!).repayments).toHaveLength(2);
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Alex Test");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.getByText("Alex Test (you)", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Hey Alex, welcome home.")).toBeVisible();
});
test("desktop: overview, history filters, and live login fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(
    page.getByText("Your little household", { exact: true }),
  ).toBeVisible();
  await page.getByText("View all", { exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: "Utilities", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View Internet, sorted" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Friday pizza night" }),
  ).toHaveCount(0);
  await page.getByLabel("From date", { exact: true }).fill("2099-01-01");
  await expect(page.getByText("Nothing here just yet")).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByText("Household", { exact: true }).first().click();
  await page
    .getByRole("button", { name: "Switch to live accounts", exact: true })
    .click();
  await expect(page.getByText("Welcome home.", { exact: true })).toBeVisible();
  await page.getByLabel("Email address").fill("alex@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(
    page.getByText("Live accounts need Supabase configuration.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Explore the demo", exact: true })
    .click();
  await expect(
    page.getByText("Recent purchases", { exact: true }),
  ).toBeVisible();
});

test("payments: credit surcharge is disclosed and only principal settles the demo balance", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await page
    .getByRole("button", { name: "Manage payments", exact: true })
    .click();
  await verifySampleSecurity(page);
  await expect(
    page.getByText("Demo payments · no money moves", { exact: true }),
  ).toBeVisible();
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
  const ledger = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("splitcart-demo-v1")))!,
  );
  expect(ledger.repayments).toHaveLength(2);
  expect(ledger.repayments[0].cents).toBe(1020);
  const payment = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("splitcart-payments-demo-v1-"),
    )!;
    return JSON.parse(localStorage.getItem(key)!).payments[0];
  });
  expect(payment.fee).toBe(26);
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
  await page
    .getByRole("button", { name: "Set up sample receiving bank", exact: true })
    .click();
  await expect(
    page.getByText("Receiving payments is ready.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(
    page.getByText("Estimated total: $10.20", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await expect(
    page.getByText("Total charged: $10.20", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel payment review", exact: true })
    .click();
});

test("payments: bank autopay consent, verified reminders, persistence and cancellation", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await page
    .getByRole("button", { name: "Manage payments", exact: true })
    .click();
  await verifySampleSecurity(page);
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
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Remove Demo checking •••• 6789",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Cancel automatic dues using this method before removing it.",
      { exact: true },
    ),
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
  await page.getByRole("button", { name: "1 day before", exact: true }).click();
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
  await expect(
    page.getByRole("switch", { name: "Email payment reminders", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Text payment reminders", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "1 day before", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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

test("household names persist and long names keep phone and desktop navigation usable", async ({
  page,
}) => {
  const name = "OurSharedHome".repeat(6);
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await page.getByLabel("Household name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Save household name", exact: true })
    .click();
  await expect(
    page.getByText("Your household name has been updated.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1000, height: 900 });
  const avatar = await page
    .getByLabel("Household settings", { exact: true })
    .boundingBox();
  expect(avatar).not.toBeNull();
  expect(avatar!.x + avatar!.width).toBeLessThanOrEqual(1000);
});
