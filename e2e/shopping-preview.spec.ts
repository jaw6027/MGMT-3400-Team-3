import { test, expect, Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open sample household", exact: true })
    .click();
  await page.getByRole("tab", { name: "Shopping", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Household shopping list", exact: true }),
  ).toBeVisible();
});
const catalog = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Search household catalog", { exact: true }).fill(name);
  await page
    .getByRole("radio", { name: "Select " + name, exact: true })
    .click();
};
test("catalog plans require assignees, log actual purchases, and remember the real last buyer across accounts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await catalog(page, "Milk");
  await page
    .getByRole("button", { name: "Add to household list", exact: true })
    .click();
  await expect(
    page.getByText("Choose which roommate will purchase this item.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Alex Morgan", exact: true }).click();
  await page
    .getByRole("button", { name: "Add to household list", exact: true })
    .click();
  await expect(
    page.getByText("Assigned to Alex Morgan", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No recorded purchase yet.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Log Milk purchase", exact: true })
    .click();
  await expect(
    page.getByLabel("What did you buy? *", { exact: true }),
  ).toHaveValue("Milk");
  await page.getByLabel("Total (USD) *", { exact: true }).fill("10.01");
  // Jordan really paid, even though Alex was assigned the errand.
  await page.getByRole("button", { name: "Jordan", exact: true }).click();
  await page
    .getByRole("button", { name: "Save purchase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Purchased (1)", exact: true })
    .click();
  await expect(
    page.getByText("Jordan Lee bought this", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Buy Milk again", exact: true })
    .click();
  await expect(
    page.getByText("Last bought by Jordan Lee", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Suggested next buyer: Riley Chen.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sam Rivera", exact: true }).click();
  await page
    .getByRole("button", { name: "Add to household list", exact: true })
    .click();
  await expect(
    page.getByText("Assigned to Sam Rivera", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Last bought by Jordan Lee", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await page
    .getByRole("button", { name: "Switch preview account", exact: true })
    .click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("jordan@splitcart.demo");
  await page.getByLabel("Password", { exact: true }).fill("splitcart-demo");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("tab", { name: "Shopping", exact: true }).click();
  await expect(
    page.getByText("Assigned to Sam Rivera", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Purchased (1)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View Milk purchase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit purchase", exact: true })
    .click();
  await page.getByLabel("Total (USD) *", { exact: true }).fill("12");
  await page
    .getByRole("checkbox", { name: "One-time purchase", exact: true })
    .click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Buy Milk again", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("custom one-time expenses stay in history, support receipt/details, and are not offered as repeat buys", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page
    .getByRole("button", { name: "Custom expense", exact: true })
    .click();
  await page
    .getByLabel("Custom item name", { exact: true })
    .fill("Hallway light fixture");
  await page
    .getByRole("button", { name: "Household Items", exact: true })
    .click();
  await page.getByRole("button", { name: "Alex Morgan", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "One-time planned purchase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add to household list", exact: true })
    .click();
  await expect(
    page.getByText("Hallway light fixture", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Log Hallway light fixture purchase",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "One-time purchase", exact: true }),
  ).toBeChecked();
  await page.getByLabel("Total (USD) *", { exact: true }).fill("32.75");
  await page.getByText("Try a sample receipt", { exact: true }).click();
  await page
    .getByRole("button", { name: "Save purchase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Purchased (1)", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Buy Hallway light fixture again",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "View Hallway light fixture purchase",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("One-time purchase", { exact: true }).last(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open receipt viewer", exact: true })
    .click();
  await expect(
    page.getByText("Shared privately with your household.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).last().click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await page.getByRole("tab", { name: "Shopping", exact: true }).click();
  await page
    .getByRole("button", { name: "Purchased (1)", exact: true })
    .click();
  await expect(
    page.getByText("Hallway light fixture", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("planned items can be reassigned and removed without creating expenses or balances", async ({
  page,
}) => {
  await catalog(page, "Electricity");
  await page.getByRole("button", { name: "Alex Morgan", exact: true }).click();
  await page
    .getByRole("button", { name: "Add to household list", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit Electricity", exact: true })
    .click();
  await page.getByRole("button", { name: "Riley Chen", exact: true }).click();
  await page
    .getByRole("button", { name: "Save planned item", exact: true })
    .click();
  await expect(
    page.getByText("Assigned to Riley Chen", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Electricity", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep item", exact: true }).click();
  await expect(
    page.getByText("Assigned to Riley Chen", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Electricity", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm remove item", exact: true })
    .click();
  await expect(
    page.getByText("What’s next for your home?", { exact: true }),
  ).toBeVisible();
  const db = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("splitcart-browser-preview-v1")!),
  );
  expect(db.shoppingItems).toHaveLength(0);
  expect(db.expenses).toHaveLength(6);
});
