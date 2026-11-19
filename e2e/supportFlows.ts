import { test, expect, Page } from "@playwright/test";

export function supportFlows(preview: boolean) {
  const open = async (page: Page) =>
    page
      .getByRole("button", { name: "Open SplitMate Assistant", exact: true })
      .click();
  const ask = async (page: Page, question: string) => {
    await page
      .getByLabel("Message SplitMate Assistant", { exact: true })
      .fill(question);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByLabel("Assistant is typing", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Assistant is typing", { exact: true }),
    ).toHaveCount(0);
  };
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1366, height: 900 },
  ]) {
    test(`${viewport.width < 600 ? "phone" : "desktop"}: assistant conversation, context, shortcuts and preserved app`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/");
      if (preview)
        await page
          .getByRole("button", { name: "Open sample household", exact: true })
          .click();
      await page.getByText("Recent purchases", { exact: true }).waitFor();
      await open(page);
      await expect(
        page.getByRole("heading", { name: "SplitMate Assistant", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/Hey! 👋 I'm your SplitMate Assistant/),
      ).toBeVisible();
      for (const label of [
        "How to Split a Bill",
        "Subscription Plans",
        "Invite a Roommate",
        "Find a Feature",
      ]) {
        await expect(
          page.getByRole("button", { name: label, exact: true }),
        ).toBeVisible();
      }
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Subscription Plans", exact: true })
        .click();
      await expect(
        page.getByText(/Subscription details — not yet defined/),
      ).toBeVisible();
      await ask(page, "How do I cancel it?");
      await expect(
        page.getByText(/Subscription cancellation — placeholder/),
      ).toBeVisible();
      await ask(page, "How do I split rent?");
      await expect(page.getByText(/For rent, choose Rent/)).toBeVisible();
      await ask(page, "What about unevenly?");
      await expect(page.getByText(/Yes — use exact amounts/)).toBeVisible();
      await page
        .getByRole("button", { name: "Close assistant", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "SplitMate Assistant", exact: true }),
      ).toHaveCount(0);
      await open(page);
      await expect(
        page.getByText("How do I split rent?", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Go to Purchases", exact: true })
        .last()
        .click();
      await expect(
        page.getByRole("button", { name: "Add purchase", exact: true }),
      ).toBeVisible();
      await open(page);
      await expect(page.getByText(/Yes — use exact amounts/)).toBeVisible();
      await ask(page, "What is tomorrow's weather?");
      await expect(page.getByText(/Could you rephrase/)).toBeVisible();
      await page
        .getByRole("button", { name: "Find a Feature", exact: true })
        .click();
      await expect(page.getByText(/Here’s your map/)).toBeVisible();
      const destinations = [
        ["Shopping", "Household shopping list"],
        ["Chore Tracker", "Chore Tracker"],
        ["Household", "Your profile"],
        ["Balances", "All squared up."],
        ["Overview", "Recent purchases"],
      ];
      for (const [section, heading] of destinations) {
        await page
          .getByRole("button", { name: `Go to ${section}`, exact: true })
          .last()
          .click();
        await expect(
          page.getByText(heading, { exact: true }).last(),
        ).toBeVisible();
        await open(page);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/assistant-${preview ? "preview" : "app"}-${viewport.width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("heading", { name: "SplitMate Assistant", exact: true }),
      ).toHaveCount(0);
      // Existing purchase editor remains usable after assistant navigation.
      await page
        .getByRole("button", { name: "Add a purchase", exact: true })
        .click();
      await expect(
        page.getByLabel("What did you buy? *", { exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
  if (preview)
    test("assistant helps before signup and clears history on account change", async ({
      page,
    }) => {
      await page.goto("/");
      await open(page);
      await ask(page, "How do I create an account?");
      await expect(
        page.getByText(/password of at least 8 characters/),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /^Go to / })).toHaveCount(
        0,
      );
      await page
        .getByRole("button", { name: "Close assistant", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Open sample household", exact: true })
        .click();
      await page.getByText("Recent purchases", { exact: true }).waitFor();
      await open(page);
      await expect(
        page.getByText("How do I create an account?", { exact: true }),
      ).toHaveCount(0);
      await ask(page, "How do I organize chores?");
      await page
        .getByRole("button", { name: "Go to Chore Tracker", exact: true })
        .click();
      await page.getByRole("tab", { name: "Household", exact: true }).click();
      await page
        .getByRole("button", { name: "Switch preview account", exact: true })
        .click();
      await open(page);
      await expect(
        page.getByText("How do I organize chores?", { exact: true }),
      ).toHaveCount(0);
    });
}
