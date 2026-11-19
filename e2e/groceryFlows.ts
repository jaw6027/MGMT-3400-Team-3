import { test, expect, Page } from "@playwright/test";
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
export async function groceryNav(page: Page) {
  if ((page.viewportSize()?.width || 0) < 1000)
    await page
      .getByRole("tab", { name: "Grocery & Restock Rotation", exact: true })
      .click();
  else
    await page
      .getByText("Grocery & Restock Rotation", { exact: true })
      .first()
      .click();
  await page
    .getByRole("heading", { name: "Grocery & Restock Rotation", exact: true })
    .waitFor();
}
export async function startGroceries(page: Page, preview: boolean) {
  await page.goto("/");
  if (preview) await button(page, "Open sample household").click();
  await button(page, "Set up grocery rotation").click();
  await button(page, "Create grocery rotation").click();
  await button(page, "Save grocery schedule").click();
  await expect(
    page.getByText("Grocery rotation saved.", { exact: true }),
  ).toBeVisible();
}
export function groceryFlows(preview: boolean) {
  for (const width of [390, 1366])
    test(`${width < 1000 ? "phone" : "desktop"}: rotation, restocking, shared expense and persisted fairness`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await startGroceries(page, preview);
      await expect(page.getByText("My Turn", { exact: true })).toBeVisible();
      await button(page, "Edit Toilet Paper details").click();
      await page
        .getByLabel("Quantity remaining (optional)", { exact: true })
        .fill("2 rolls");
      await page
        .getByLabel("Restock notes (optional)", { exact: true })
        .fill("Unscented, buy 12 rolls");
      await button(page, "Save essential").click();
      await button(page, "Running Low Toilet Paper").click();
      await expect(button(page, "Running Low Toilet Paper")).toBeDisabled();
      await button(page, "Open shared shopping list").click();
      await expect(
        page.getByText(/Restock essential · Unscented, buy 12 rolls/),
      ).toBeVisible();
      await expect(button(page, "Mark Toilet Paper as purchased")).toHaveCount(
        1,
      );
      await button(page, "Mark Toilet Paper as purchased").click();
      await expect(
        page.getByLabel("What did you buy? *", { exact: true }),
      ).toHaveValue("Toilet Paper");
      await page.getByLabel("Total (USD) *", { exact: true }).fill("12.00");
      await button(page, "Save purchase").click();
      await groceryNav(page);
      await expect(button(page, "Running Low Toilet Paper")).toBeEnabled();
      await expect(
        page.getByText(/Alex Morgan purchased Toilet Paper/),
      ).toBeVisible();
      await button(page, "Mark turn complete").click();
      await button(page, "Confirm grocery trip completed").click();
      await expect(
        page.getByText(
          "Grocery trip completed. The next roommate is assigned.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(button(page, "Mark turn complete")).toBeDisabled();
      await expect(
        page.getByText("Alex Morgan completed a grocery trip", { exact: true }),
      ).toBeVisible();
      await button(page, "Record shared grocery expense").click();
      await expect(
        page.getByLabel("What did you buy? *", { exact: true }),
      ).toHaveValue("Grocery trip");
      await page.getByLabel("Total (USD) *", { exact: true }).fill("90.00");
      await page
        .getByRole("checkbox", { name: "Split with Riley Chen", exact: true })
        .click();
      await button(page, "Save purchase").click();
      await expect(button(page, "View Grocery trip · $90.00")).toBeVisible();
      const saved = await page.evaluate(
        (preview) =>
          JSON.parse(
            localStorage.getItem(
              preview ? "splitcart-browser-preview-v1" : "splitcart-demo-v1",
            )!,
          ),
        preview,
      );
      const rotation = preview
        ? saved.groceryStates["demo-house"]
        : saved.grocery;
      expect(
        rotation.history.filter((e: any) => e.kind === "complete"),
      ).toHaveLength(1);
      const expense = saved.expenses.find((e: any) => e.grocery_trip_id);
      expect(expense.shares).toHaveLength(3);
      expect(expense.shares.every((s: any) => s.cents === 3000)).toBe(true);
      expect(rotation.rotation.queue[0]).toBe("jordan");
      await page.reload();
      await page.getByText("Recent purchases", { exact: true }).waitFor();
      await groceryNav(page);
      await expect(button(page, "View Grocery trip · $90.00")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("heading", {
          name: "Grocery & Restock Rotation",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/grocery-${preview ? "preview" : "app"}-${width}.png`,
      });
      expect(errors).toEqual([]);
    });
  if (preview)
    test("preview accounts must agree to swaps; skipping moves to the back; separate restock mode persists", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await startGroceries(page, true);
      await button(page, "Swap Turn").click();
      await button(page, "Request turn swap").click();
      await expect(
        page.getByText("Turn swap awaiting agreement", { exact: true }),
      ).toBeVisible();
      await expect(button(page, "Accept turn swap")).toHaveCount(0);
      await page.getByRole("tab", { name: "Household", exact: true }).click();
      await button(page, "Switch preview account").click();
      await page
        .getByLabel("Email address", { exact: true })
        .fill("jordan@splitcart.demo");
      await page.getByLabel("Password", { exact: true }).fill("splitcart-demo");
      await button(page, "Log in").click();
      await page.getByText("Recent purchases", { exact: true }).waitFor();
      await groceryNav(page);
      await expect(button(page, "Mark turn complete")).toBeDisabled();
      await button(page, "Accept turn swap").click();
      await expect(
        page.getByText("Turn swap accepted. The schedule has been updated.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(button(page, "Mark turn complete")).toBeEnabled();
      await button(page, "Skip my turn").click();
      await button(page, "Confirm skip turn").click();
      await expect(
        page.getByText("Turn skipped. You're at the back of the queue.", {
          exact: true,
        }),
      ).toBeVisible();
      await button(page, "Edit grocery schedule").click();
      await button(page, "Option B: Separate Restock Rotation").click();
      await page
        .getByLabel("Days between restock assignments (1–365)", { exact: true })
        .fill("14");
      await button(page, "Save grocery schedule").click();
      await button(page, "Running Low Toilet Paper").click();
      await expect(
        button(page, "Mark Toilet Paper as purchased"),
      ).toBeDisabled();
      await button(page, "Add custom essential").click();
      await page
        .getByLabel("Essential name", { exact: true })
        .fill("Coffee beans");
      await page
        .getByLabel("Restock notes (optional)", { exact: true })
        .fill("Decaf, one bag");
      await button(page, "Save essential").click();
      await expect(button(page, "Running Low Coffee beans")).toBeEnabled();
      await page.reload();
      await page.getByText("Recent purchases", { exact: true }).waitFor();
      await groceryNav(page);
      await expect(
        page.getByText(/Separate restock rotation: each item/),
      ).toBeVisible();
      const stored = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("splitcart-browser-preview-v1")!)
            .groceryStates["demo-house"],
      );
      expect(stored.rotation.mode).toBe("separate");
      expect(stored.rotation.restockDays).toBe(14);
      expect(
        stored.history.filter((e: any) => e.kind === "complete"),
      ).toHaveLength(0);
      expect(stored.swaps[0].status).toBe("accepted");
      expect(stored.rotation.queue.at(-1)).toBe("jordan");
    });
}
