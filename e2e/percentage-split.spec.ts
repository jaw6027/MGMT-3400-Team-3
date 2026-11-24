import { expect, test } from "@playwright/test";

test("demo: previews, saves and reopens a percentage split", async ({
  page,
}) => {
  await page.goto("/");
  const demoBadge = page.getByText("DEMO MODE", { exact: true });
  const openSample = page.getByRole("button", {
    name: "Open sample household",
    exact: true,
  });
  await expect(demoBadge.or(openSample)).toBeVisible();
  if (await openSample.isVisible()) await openSample.click();
  await expect(demoBadge).toBeVisible();
  await page
    .getByRole("button", { name: "Add a purchase", exact: true })
    .click();
  await page
    .getByLabel("What did you buy? *", { exact: true })
    .fill("Percentage groceries");
  const total = page.getByLabel("Total (USD) *", { exact: true });
  await total.fill("10.01");
  await page.getByRole("button", { name: "Percentage", exact: true }).click();
  await page.getByRole("checkbox", { name: "Split with Sam Rivera" }).click();
  await page.getByRole("checkbox", { name: "Split with Riley Chen" }).click();
  await expect(page.getByLabel("Sam Rivera percentage")).toHaveCount(0);

  await page.getByLabel("Alex Morgan percentage").fill("50.00");
  await page.getByLabel("Jordan Lee percentage").fill("49.99");
  await expect(
    page.getByText("Roommate percentages must total exactly 100%."),
  ).toBeVisible();
  const save = page.getByRole("button", { name: "Save purchase", exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel("Jordan Lee percentage").fill("50");
  await expect(page.getByLabel("Alex Morgan amount owed")).toHaveText("$5.01");
  await expect(page.getByLabel("Jordan Lee amount owed")).toHaveText("$5.00");
  await save.click();
  await expect(
    page.getByText("Purchase saved. Everyone’s share is accounted for."),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  const purchase = page.getByRole("button", {
    name: "View Percentage groceries",
    exact: true,
  });
  await purchase.click();
  const edit = page.getByRole("button", { name: "Edit purchase", exact: true });
  await edit.click();
  await expect(
    page.getByRole("button", { name: "Percentage", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Alex Morgan percentage")).toHaveValue("50.00");
  await expect(page.getByLabel("Jordan Lee percentage")).toHaveValue("50");
  await total.fill("20.01");
  await expect(page.getByLabel("Alex Morgan amount owed")).toHaveText("$10.01");
  await expect(page.getByLabel("Jordan Lee amount owed")).toHaveText("$10.00");
  await page.getByLabel("Alex Morgan percentage").fill("25");
  await page.getByLabel("Jordan Lee percentage").fill("75");
  await expect(page.getByLabel("Alex Morgan amount owed")).toHaveText("$5.00");
  await expect(page.getByLabel("Jordan Lee amount owed")).toHaveText("$15.01");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Purchase saved. Everyone’s share is accounted for."),
  ).toBeVisible();
  await purchase.click();
  await edit.click();
  await expect(total).toHaveValue("20.01");
  await expect(page.getByLabel("Alex Morgan percentage")).toHaveValue("25");
  await expect(page.getByLabel("Jordan Lee percentage")).toHaveValue("75");
  await expect(page.getByLabel("Jordan Lee amount owed")).toHaveText("$15.01");
});
