import { expect, test, type Page } from "@playwright/test";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const label = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });

async function openEditor(page: Page) {
  await button(page, "Add a purchase").click();
  await button(page, "Show templates").click();
}

async function startSplit(page: Page) {
  await button(page, "Percentage").click();
  await page.getByRole("checkbox", { name: "Split with Sam Rivera" }).click();
  await page.getByRole("checkbox", { name: "Split with Riley Chen" }).click();
  await label(page, "Alex Morgan percentage").fill("50");
  await label(page, "Jordan Lee percentage").fill("50");
}

async function switchAccount(page: Page) {
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await button(page, "Switch preview account").click();
  await expect(button(page, "Open sample household")).toBeVisible();
}

test("create, reuse, edit and delete a persistent household split template", async ({
  page,
}) => {
  await page.goto("/");
  const sample = button(page, "Open sample household");
  const demo = page.getByText("DEMO MODE", { exact: true });
  await expect(sample.or(demo)).toBeVisible();
  if (await sample.isVisible()) await sample.click();

  await openEditor(page);
  await startSplit(page);
  await button(page, "New template").click();
  await label(page, "Template name").fill("Utilities");
  await expect(label(page, "Alex Morgan template percentage")).toHaveValue(
    "50",
  );
  await expect(label(page, "Sam Rivera template percentage")).toHaveCount(0);
  await button(page, "Sam Rivera").click();
  await expect(label(page, "Sam Rivera template percentage")).toBeVisible();
  await button(page, "Sam Rivera").click();
  await label(page, "Jordan Lee template percentage").fill("49.99");
  await button(page, "Save template").click();
  await expect(
    page.getByText("Roommate percentages must total exactly 100%.", {
      exact: true,
    }),
  ).toBeVisible();
  await label(page, "Alex Morgan template percentage").fill("55");
  await label(page, "Jordan Lee template percentage").fill("45");
  await button(page, "Save template").click();
  await expect(button(page, "Use template Utilities")).toBeVisible();
  await expect(label(page, "Alex Morgan percentage")).toHaveValue("50");

  await page.reload();
  await openEditor(page);
  await label(page, "What did you buy? *").fill("Utilities test purchase");
  await label(page, "Total (USD) *").fill("10.01");
  await button(page, "Use template Utilities").click();
  await expect(label(page, "Alex Morgan percentage")).toHaveValue("55");
  await expect(label(page, "Jordan Lee amount owed")).toHaveText("$4.50");
  await expect(label(page, "Sam Rivera percentage")).toHaveCount(0);
  await label(page, "Alex Morgan percentage").fill("60");
  await label(page, "Jordan Lee percentage").fill("40");
  await button(page, "Save purchase").click();
  await expect(
    page.getByText("Purchase saved. Everyone’s share is accounted for."),
  ).toBeVisible();

  await openEditor(page);
  await button(page, "Edit template Utilities").click();
  await expect(label(page, "Alex Morgan template percentage")).toHaveValue(
    "55",
  );
  await label(page, "Template name").fill("Joint bills");
  await label(page, "Alex Morgan template percentage").fill("65");
  await label(page, "Jordan Lee template percentage").fill("35");
  await button(page, "Save template").click();
  await button(page, "Use template Joint bills").click();
  await expect(label(page, "Alex Morgan percentage")).toHaveValue("65");

  await button(page, "Delete template Joint bills").click();
  await button(page, "Cancel").click();
  await button(page, "Delete template Joint bills").click();
  await button(page, "Delete template").click();
  await expect(page.getByText("Template deleted.")).toBeVisible();
  await page.reload();
  await openEditor(page);
  await expect(button(page, "Use template Joint bills")).toHaveCount(0);
});

test("standalone preview: a former roommate blocks reuse until a template is repaired", async ({
  page,
}) => {
  await page.goto("/");
  const sample = button(page, "Open sample household");
  await expect(
    sample.or(page.getByText("DEMO MODE", { exact: true })),
  ).toBeVisible();
  test.skip(
    !(await sample.isVisible()),
    "Preview account switching is required.",
  );
  await sample.click();
  await openEditor(page);
  await startSplit(page);
  await button(page, "New template").click();
  await label(page, "Template name").fill("Shared bills");
  await button(page, "Save template").click();
  await expect(button(page, "Use template Shared bills")).toBeVisible();
  await button(page, "Close dialog").click();

  await switchAccount(page);
  await label(page, "Email address").fill("jordan@splitcart.demo");
  await label(page, "Password").fill("splitcart-demo");
  await button(page, "Log in").click();
  await openEditor(page);
  await expect(button(page, "Use template Shared bills")).toBeEnabled();
  await button(page, "Close dialog").click();
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await button(page, "Leave household").click();
  await button(page, "Confirm leave household").click();
  await expect(
    page.getByRole("tab", { name: "Household", exact: true }),
  ).toHaveCount(0);
  await button(page, "Sign out").click();

  await sample.click();
  await openEditor(page);
  await expect(button(page, "Use template Shared bills")).toBeDisabled();
  await expect(
    page.getByText(
      "Edit this template before using it. A roommate is no longer in the household.",
    ),
  ).toBeVisible();
  await button(page, "Edit template Shared bills").click();
  await expect(label(page, "Jordan Lee template percentage")).toHaveCount(0);
  await label(page, "Alex Morgan template percentage").fill("100");
  await button(page, "Save template").click();
  await button(page, "Use template Shared bills").click();
  await expect(label(page, "Alex Morgan percentage")).toHaveValue("100");
  await expect(label(page, "Jordan Lee percentage")).toHaveCount(0);
});
