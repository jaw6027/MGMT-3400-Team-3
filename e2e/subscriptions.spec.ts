import { expect, test, type Page } from "@playwright/test";
test.setTimeout(90000);
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function start(page: Page) {
  await page.goto("/");
  const sample = button(page, "Open sample household");
  await expect(
    sample.or(page.getByText("DEMO MODE", { exact: true })),
  ).toBeVisible();
  const preview = await sample.isVisible();
  if (preview) await sample.click();
  await expect(button(page, "Add a purchase")).toBeVisible();
  return preview;
}
async function subscriptions(page: Page) {
  if ((page.viewportSize()?.width || 390) < 1000)
    await page.getByRole("tab", { name: "Household", exact: true }).click();
  else await page.getByText("Household", { exact: true }).first().click();
  await button(page, "Compare plans and manage subscription").click();
  await expect(
    page.getByText("Choose your household plan", { exact: true }),
  ).toBeVisible();
}
async function subscriptionState(page: Page) {
  return page.evaluate(() => {
    const normal = JSON.parse(
      localStorage.getItem("splitcart-demo-v1") || "null",
    );
    const preview = JSON.parse(
      localStorage.getItem("splitcart-browser-preview-v1") || "null",
    );
    return normal?.subscription || preview?.subscriptions?.["demo-house"];
  });
}
async function ledger(page: Page) {
  return page.evaluate(() => {
    const normal = JSON.parse(
      localStorage.getItem("splitcart-demo-v1") || "null",
    );
    const preview = JSON.parse(
      localStorage.getItem("splitcart-browser-preview-v1") || "null",
    );
    const data = preview || normal;
    return { expenses: data?.expenses, repayments: data?.repayments };
  });
}
async function switchAccount(page: Page, email: string) {
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await button(page, "Switch preview account").click();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("splitcart-demo");
  await button(page, "Log in").click();
}

test("household trial, plan changes, failed billing, cancellation and reactivation preserve the expense ledger", async ({
  page,
}) => {
  const billingRequests: string[] = [];
  page.on("request", (r) => {
    if (/api.stripe.com|checkout.stripe.com/.test(r.url()))
      billingRequests.push(r.url());
  });
  await start(page);
  let before = await ledger(page);
  await subscriptions(page);
  for (const amount of ["$3.99", "$5.49", "$6.99"])
    await expect(page.getByText(amount, { exact: true })).toBeVisible();
  await expect(
    page.getByText(/No feature restrictions are enabled/).first(),
  ).toBeVisible();
  await button(page, "Select Basic").click();
  await button(page, "Start 30-day trial with Basic").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "30-day free trial · Basic · 4 active roommates covered",
  );
  const trial = await subscriptionState(page);
  expect(
    Date.parse(trial.trial_ends_at) - Date.parse(trial.trial_started_at),
  ).toBe(30 * 86400000);
  expect(trial.charges).toEqual([]);
  if (!before.expenses) {
    before = await ledger(page);
    expect(before.expenses).toHaveLength(6);
    expect(before.repayments).toHaveLength(1);
  }
  await page.reload();
  await subscriptions(page);
  await button(page, "Select Premium").click();
  await button(page, "Use Premium after trial").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Premium",
  );
  expect((await subscriptionState(page)).trial_ends_at).toBe(
    trial.trial_ends_at,
  );
  await button(page, "Simulate failure on next payment").click();
  await button(page, "Advance to trial expiration").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Payment needs attention",
  );
  await expect(
    page.getByText("Premium · $6.99 USD · Failed (simulated)", { exact: true }),
  ).toBeVisible();
  await button(page, "Retry simulated payment").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Active · Premium",
  );
  expect((await subscriptionState(page)).charges).toHaveLength(1);
  await button(page, "Select Basic").click();
  await button(page, "Schedule Basic at renewal").click();
  await expect(page.getByText(/Scheduled plan: Basic/)).toBeVisible();
  await button(page, "Advance to next renewal").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Active · Basic",
  );
  await button(page, "Select Plus").click();
  await button(page, "Schedule Plus at renewal").click();
  await button(page, "Advance to next renewal").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Active · Plus",
  );
  await button(page, "Cancel subscription").click();
  await button(page, "Confirm subscription cancellation").click();
  await expect(page.getByText(/Renewal is stopped/)).toBeVisible();
  await button(page, "Keep subscription renewing").click();
  await button(page, "Cancel subscription").click();
  await button(page, "Confirm subscription cancellation").click();
  await button(page, "Advance to next renewal").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Canceled",
  );
  expect((await subscriptionState(page)).charges).toHaveLength(3);
  await button(page, "Reactivate Plus").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Active · Plus",
  );
  const reactivated = await subscriptionState(page);
  expect(reactivated.trial_started_at).toBe(trial.trial_started_at);
  expect(reactivated.charges).toHaveLength(4);
  expect(reactivated.charges[3].cents).toBe(549);
  expect(await ledger(page)).toEqual(before);
  expect(billingRequests).toEqual([]);
  await page.getByRole("tab", { name: "Balances", exact: true }).click();
  await button(page, "Manage payments").click();
  await button(page, "Pay").click();
  await expect(button(page, "SplitCart app dues")).toHaveCount(0);
});

test("standalone preview: separate logins share one trial and enforce manager transfer and recovery", async ({
  page,
}) => {
  const preview = await start(page);
  test.skip(!preview, "Independent preview accounts are required.");
  await subscriptions(page);
  await button(page, "Start 30-day trial with Plus").click();
  const trial = await subscriptionState(page);
  await switchAccount(page, "jordan@splitcart.demo");
  await subscriptions(page);
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "30-day free trial · Plus",
  );
  await expect(button(page, "Select Basic")).toBeDisabled();
  await expect(button(page, "Cancel subscription")).toHaveCount(0);
  expect((await subscriptionState(page)).trial_started_at).toBe(
    trial.trial_started_at,
  );
  await switchAccount(page, "alex@splitcart.demo");
  await subscriptions(page);
  await button(page, "Assign Jordan Lee").click();
  await button(page, "Confirm billing manager transfer").click();
  await expect(button(page, "Select Basic")).toBeDisabled();
  await switchAccount(page, "jordan@splitcart.demo");
  await subscriptions(page);
  await button(page, "Select Premium").click();
  await button(page, "Use Premium after trial").click();
  await button(page, "Leave household").click();
  await button(page, "Confirm leave household").click();
  // Return to Alex through the setup screen's account-switch control.
  const signout = button(page, "Sign out");
  await signout.click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("alex@splitcart.demo");
  await page.getByLabel("Password", { exact: true }).fill("splitcart-demo");
  await button(page, "Log in").click();
  await subscriptions(page);
  await button(page, "Recover billing management").click();
  await expect(
    page.getByText("Billing manager: Alex Morgan (you)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Premium · 3 active roommates covered",
  );
  expect((await subscriptionState(page)).trial_started_at).toBe(
    trial.trial_started_at,
  );
});

test("desktop plan comparison remains readable and has no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await start(page);
  await subscriptions(page);
  await expect(button(page, "Select Basic")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "work/subscriptions-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(button(page, "Select Premium")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "work/subscriptions-phone.png",
    fullPage: true,
  });
});
