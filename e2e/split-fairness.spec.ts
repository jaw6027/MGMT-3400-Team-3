import { expect, test } from "@playwright/test";

test("fairness distinguishes invalid, excluded and intentional zero shares without blocking save", async ({
  page,
}) => {
  await page.setViewportSize({ width: 340, height: 800 });
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const label = (name: string) => page.getByLabel(name, { exact: true });
  const sample = button("Open sample household");
  await expect(
    sample.or(page.getByText("DEMO MODE", { exact: true })),
  ).toBeVisible();
  if (await sample.isVisible()) await sample.click();

  await button("Add a purchase").click();
  await label("What did you buy? *").fill("Intentional unequal purchase");
  const total = label("Total (USD) *");
  await total.fill("10.01");
  for (const name of ["Sam Rivera", "Riley Chen"])
    await page.getByRole("checkbox", { name: `Split with ${name}` }).click();
  await button("Check fairness").click();
  await expect(
    page.getByText("An unequal split can be fair.", { exact: false }),
  ).toBeVisible();
  await expect(label("Alex Morgan, assigned: 50% · $5.01")).toBeVisible();
  await expect(label("Sam Rivera, assigned: Not included")).toBeVisible();

  await button("Custom").click();
  await label("Alex Morgan custom share").fill("10.01");
  await label("Jordan Lee custom share").fill("0");
  await expect(label("Jordan Lee, assigned: 0% · $0.00")).toBeVisible();
  await expect(label("Jordan Lee: Lower share")).toBeVisible();
  await total.fill("20.01");
  await expect(
    page.getByText(
      "Split incomplete or invalid. Shares must add up to the purchase total.",
    ),
  ).toBeVisible();

  await button("Percentage").click();
  await label("Alex Morgan percentage").fill("80");
  await label("Jordan Lee percentage").fill("10");
  await expect(
    page.getByText(
      "Split incomplete or invalid. Roommate percentages must total exactly 100%.",
    ),
  ).toBeVisible();
  await label("Jordan Lee percentage").fill("20");
  await expect(label("Alex Morgan, assigned: 80% · $16.01")).toBeVisible();
  await expect(label("Alex Morgan, vs. equal: +$6.00")).toBeVisible();

  await button("Show templates").click();
  await button("New template").click();
  await label("Template name").fill("Intentional split");
  await label("Alex Morgan template percentage").fill("100");
  await label("Jordan Lee template percentage").fill("0");
  await button("Save template").click();
  await expect(button("Use template Intentional split")).toBeVisible();
  await button("Compare splits").click();
  await button("Saved template").click();
  await expect(label("Alex Morgan, assigned: 80% · $16.01")).toBeVisible();
  await button("Apply template").click();
  await expect(label("Alex Morgan, assigned: 100% · $20.01")).toBeVisible();
  await expect(label("Jordan Lee, assigned: 0% · $0.00")).toBeVisible();
  await expect(page.getByText("Assigned zero", { exact: true })).toBeVisible();
  await expect(button("Save purchase")).toBeEnabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(340);
  await button("Save purchase").click();
  await expect(
    page.getByText("Purchase saved. Everyone’s share is accounted for."),
  ).toBeVisible();
});
