import { test, expect } from "@playwright/test";
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
