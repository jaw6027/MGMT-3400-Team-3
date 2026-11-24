import { expect, test, type Page } from "@playwright/test";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const label = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });

test("compare live allocations and apply a split without saving a duplicate or changing a template", async ({
  page,
}) => {
  await page.setViewportSize({ width: 340, height: 800 });
  await page.goto("/");
  const sample = button(page, "Open sample household");
  await expect(
    sample.or(page.getByText("DEMO MODE", { exact: true })),
  ).toBeVisible();
  if (await sample.isVisible()) await sample.click();

  await button(page, "Add a purchase").click();
  await label(page, "What did you buy? *").fill("Comparison purchase");
  const total = label(page, "Total (USD) *");
  await total.fill("10.01");
  const sam = page.getByRole("checkbox", { name: "Split with Sam Rivera" });
  await sam.click();
  await page.getByRole("checkbox", { name: "Split with Riley Chen" }).click();

  await button(page, "Compare splits").click();
  const custom = button(page, "Apply custom dollars");
  await expect(custom).toBeDisabled();
  await label(page, "Alex Morgan comparison dollars").fill("6.01");
  await label(page, "Jordan Lee comparison dollars").fill("4");
  await expect(label(page, "Alex Morgan, equal: $5.01")).toBeVisible();
  await expect(label(page, "Alex Morgan, Custom dollars: $6.01")).toBeVisible();
  await expect(label(page, "Alex Morgan: +$1.00 vs equal")).toBeVisible();
  await expect(label(page, "Jordan Lee: −$1.00 vs equal")).toBeVisible();
  await total.fill("20.01");
  await expect(
    page.getByText("Custom dollars: Shares must add up to the purchase total."),
  ).toBeVisible();
  await expect(custom).toBeDisabled();
  await total.fill("10.01");
  await custom.click();
  await expect(label(page, "Alex Morgan custom share")).toHaveValue("6.01");
  await expect(label(page, "Jordan Lee custom share")).toHaveValue("4");
  await button(page, "Apply equal").click();
  await expect(label(page, "Alex Morgan custom share")).toHaveCount(0);

  await button(page, "Percentages").click();
  await label(page, "Alex Morgan comparison percentage").fill("60");
  await label(page, "Jordan Lee comparison percentage").fill("39.99");
  await expect(
    page.getByText(
      "Percentages: Roommate percentages must total exactly 100%.",
    ),
  ).toBeVisible();
  const percentage = button(page, "Apply percentages");
  await expect(percentage).toBeDisabled();
  await label(page, "Jordan Lee comparison percentage").fill("40");
  await expect(label(page, "Alex Morgan, Percentages: $6.01")).toBeVisible();
  await total.fill("20.01");
  await expect(label(page, "Alex Morgan, Percentages: $12.01")).toBeVisible();
  await expect(label(page, "Alex Morgan: +$2.00 vs equal")).toBeVisible();
  await percentage.click();
  await expect(label(page, "Alex Morgan percentage")).toHaveValue("60");

  await button(page, "Show templates").click();
  await button(page, "New template").click();
  await label(page, "Template name").fill("Utilities comparison");
  await button(page, "Jordan Lee").click();
  await button(page, "Sam Rivera").click();
  await label(page, "Sam Rivera template percentage").fill("40");
  await button(page, "Save template").click();
  await expect(button(page, "Use template Utilities comparison")).toBeVisible();
  await button(page, "Saved template").click();
  await expect(label(page, "Jordan Lee, Saved template: $0.00")).toBeVisible();
  await expect(label(page, "Sam Rivera, equal: $0.00")).toBeVisible();
  await expect(label(page, "Sam Rivera: +$8.00 vs equal")).toBeVisible();

  await button(page, "Apply template").click();
  await expect(label(page, "Sam Rivera percentage")).toHaveValue("40");
  await expect(label(page, "Jordan Lee percentage")).toHaveCount(0);
  await label(page, "Alex Morgan percentage").fill("65");
  await label(page, "Sam Rivera percentage").fill("35");
  await button(page, "Edit template Utilities comparison").click();
  await expect(label(page, "Alex Morgan template percentage")).toHaveValue(
    "60",
  );
  await expect(label(page, "Sam Rivera template percentage")).toHaveValue("40");
  await button(page, "Cancel").click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(340);

  await button(page, "Save purchase").click();
  await expect(
    page.getByText("Purchase saved. Everyone’s share is accounted for."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Purchases", exact: true }).click();
  const purchase = button(page, "View Comparison purchase");
  await expect(purchase).toHaveCount(1);
  await purchase.click();
  await button(page, "Edit purchase").click();
  await expect(label(page, "Sam Rivera percentage")).toHaveValue("35");
});
