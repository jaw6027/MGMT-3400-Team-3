import { test, expect, Page } from "@playwright/test";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await button(page, "Open sample household").click();
  await page.getByRole("tab", { name: "Chore Tracker", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Chore Tracker", exact: true }),
  ).toBeVisible();
});
test("spreadsheet chores rotate, persist, and expose a dated history across separate logins", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await button(page, "Add chore").click();
  await page.getByLabel("Find a chore", { exact: true }).fill("Trash");
  await button(page, "Take Out Trash").click();
  await button(page, "Biweekly").click();
  await button(page, "Take turns").click();
  await button(page, "Save chore").click();
  await expect(page.getByRole("alert")).toContainText(
    "Choose current household members",
  );
  await button(page, "Alex Morgan").click();
  await button(page, "Jordan Lee").click();
  await page
    .getByLabel("Next due date (YYYY-MM-DD)", { exact: true })
    .fill("2026-01-01");
  await button(page, "Save chore").click();
  await expect(
    page.getByText("Assigned to Alex Morgan", { exact: true }),
  ).toBeVisible();
  await button(page, "Log completion for Take Out Trash").click();
  await page
    .getByLabel("Completed on (YYYY-MM-DD)", { exact: true })
    .fill("2026-01-02");
  await expect(
    page.getByText("Next: Jordan Lee · due 2026-01-16", { exact: true }),
  ).toBeVisible();
  await button(page, "Save completion").click();
  await expect(
    page.getByText("Assigned to Jordan Lee", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Chore Tracker", exact: true }).click();
  await expect(
    page.getByText("Assigned to Jordan Lee", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await button(page, "Switch preview account").click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("jordan@splitcart.demo");
  await page.getByLabel("Password", { exact: true }).fill("splitcart-demo");
  await button(page, "Log in").click();
  await page.getByRole("tab", { name: "Chore Tracker", exact: true }).click();
  await button(page, "Log completion for Take Out Trash").click();
  await page
    .getByLabel("Completed on (YYYY-MM-DD)", { exact: true })
    .fill("2026-01-03");
  await button(page, "Save completion").click();
  await expect(
    page.getByText("Assigned to Alex Morgan", { exact: true }),
  ).toBeVisible();
  await button(page, "Completion history").click();
  await expect(
    page.getByText("Jordan Lee completed this on 2026-01-03.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Alex Morgan completed this on 2026-01-02.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("custom fixed chores support validation, undo, editing, archive and restore", async ({
  page,
}) => {
  await button(page, "Custom chore").click();
  await page
    .getByLabel("Chore name", { exact: true })
    .fill("Water balcony plants");
  await button(page, "Monthly").click();
  await button(page, "Sam Rivera").click();
  await page
    .getByLabel("Next due date (YYYY-MM-DD)", { exact: true })
    .fill("2026-01-31");
  await button(page, "Save chore").click();
  await button(page, "Log completion for Water balcony plants").click();
  await page
    .getByLabel("Completed on (YYYY-MM-DD)", { exact: true })
    .fill("2999-01-01");
  await button(page, "Save completion").click();
  await expect(page.getByRole("alert")).toContainText("today");
  await page
    .getByLabel("Completed on (YYYY-MM-DD)", { exact: true })
    .fill("2026-01-31");
  await expect(
    page.getByText("Next: Sam Rivera · due 2026-02-28", { exact: true }),
  ).toBeVisible();
  await button(page, "Save completion").click();
  await button(page, "Completion history").click();
  await button(page, "Undo my completion").click();
  await button(page, "Confirm undo").click();
  await expect(
    page.getByText("Water balcony plants · Undone", { exact: true }),
  ).toBeVisible();
  await button(page, "Upcoming").click();
  await expect(
    page.getByText("Overdue · 2026-01-31", { exact: true }),
  ).toBeVisible();
  await button(page, "Edit Water balcony plants").click();
  await page.getByLabel("Chore name", { exact: true }).fill("Water all plants");
  await button(page, "Daily").click();
  await button(page, "Save chore").click();
  await button(page, "Archive Water all plants").click();
  await button(page, "Archive chore").click();
  await expect(button(page, "Log completion for Water all plants")).toHaveCount(
    0,
  );
  await button(page, "Archived").click();
  await button(page, "Restore Water all plants").click();
  await button(page, "Restore chore").click();
  await button(page, "Upcoming").click();
  await expect(
    page.getByText("Water all plants", { exact: true }),
  ).toBeVisible();
});
