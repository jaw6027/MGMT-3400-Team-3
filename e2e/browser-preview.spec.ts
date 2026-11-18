import { test, expect, Page } from "@playwright/test";
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
