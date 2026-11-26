import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { uploadFixture, reviewDocument } from "./documentFixtures";
test.setTimeout(90000);
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const pdf = (text: string) =>
  Buffer.from(
    `%PDF-1.4\n% Classroom test statement ${text}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`,
  );
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
async function nav(page: Page, name: string) {
  if ((page.viewportSize()?.width || 390) < 1000)
    await page.getByRole("tab", { name, exact: true }).click();
  else await page.getByText(name, { exact: true }).first().click();
}
async function total(page: Page) {
  await nav(page, "Overview");
  const text = await page.getByText(/^Total spent:/).innerText();
  return Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100);
}
async function records(page: Page) {
  return page.evaluate(() => {
    const p = JSON.parse(
        localStorage.getItem("splitcart-browser-preview-v1") || "null",
      ),
      d = JSON.parse(localStorage.getItem("splitcart-demo-v1") || "null");
    return (p || d)?.expenses || [];
  });
}
async function simple(
  page: Page,
  name: string,
  buffer: Buffer,
  reference = "INV-30",
  amount = "25.50",
) {
  await nav(page, "Overview");
  await button(page, "Add a purchase").click();
  await button(page, "Utility statement").click();
  await uploadFixture(page, buffer, "statement.pdf", "application/pdf");
  await page.getByLabel("What did you buy? *", { exact: true }).fill(name);
  await page.getByLabel("Total (USD) *", { exact: true }).fill(amount);
  await page
    .getByLabel("Store (optional)", { exact: true })
    .fill("Power Company");
  await page
    .getByLabel("Receipt or invoice number (optional)", { exact: true })
    .fill(reference);
  await reviewDocument(page);
}
async function save(page: Page, label = "Save purchase") {
  await button(page, label).click();
  await expect(button(page, label)).toHaveCount(0);
  await expect(
    page.getByText("Purchase saved. Everyone’s share is accounted for.", {
      exact: true,
    }),
  ).toBeVisible();
}
async function view(page: Page, name: string) {
  await nav(page, "Purchases");
  await button(page, `View ${name}`).click();
}

test("PDF utility uploads block exact duplicates, allow confirmed similar bills, and update the pie chart on save/edit/delete", async ({
  page,
}) => {
  await start(page);
  const base = await total(page),
    bytes = pdf("first");
  await simple(page, "Reviewed electricity statement", bytes);
  await save(page);
  expect(await total(page)).toBe(base + 2550);
  await expect(page.getByLabel(/^Household spending pie chart/)).toBeVisible();
  let entries = await records(page);
  const original = entries.find(
    (e: any) => e.name === "Reviewed electricity statement",
  );
  expect(original.receipt_document.sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(original.receipt_document.kind).toBe("utility");
  await view(page, "Reviewed electricity statement");
  await button(page, "Open receipt viewer").click();
  await expect(button(page, "Open PDF document")).toBeVisible();
  await button(page, "Close dialog").last().click();
  await button(page, "Close dialog").click();
  await simple(page, "Renamed exact copy", bytes, "CHANGED", "99");
  await button(page, "Save purchase").click();
  await expect(
    page.getByText(/Exact duplicate document:/).first(),
  ).toBeVisible();
  expect(
    (await records(page)).filter((e: any) => e.name === "Renamed exact copy"),
  ).toHaveLength(0);
  await button(page, "Close dialog").click();
  await simple(page, "Legitimate second statement", pdf("second"));
  await expect(
    page.getByText("Possible duplicate document", { exact: true }),
  ).toBeVisible();
  await button(page, "Save purchase").click();
  await expect(
    page.getByText(/Confirm these are different expenses/),
  ).toBeVisible();
  await page
    .getByRole("switch", {
      name: "These are different purchases or statements",
      exact: true,
    })
    .click();
  await save(page);
  expect(await total(page)).toBe(base + 5100);
  await view(page, "Reviewed electricity statement");
  await button(page, "Edit purchase").click();
  await page.getByLabel("Total (USD) *", { exact: true }).fill("30");
  await page
    .getByLabel("Receipt or invoice number (optional)", { exact: true })
    .fill("INV-corrected");
  await button(page, "Internet").last().click();
  await reviewDocument(page);
  await save(page, "Save changes");
  expect(await total(page)).toBe(base + 5550);
  await expect(
    page.getByRole("progressbar", {
      name: "Internet share of spending",
      exact: true,
    }),
  ).toHaveAttribute("aria-valuetext", /\$30\.00/);
  await view(page, "Reviewed electricity statement");
  await button(page, "Delete").click();
  await button(page, "Delete purchase").click();
  expect(await total(page)).toBe(base + 2550);
  await expect(
    page.getByRole("progressbar", {
      name: "Internet share of spending",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("mixed-category itemized documents allocate adjustments once and retain date filters and older expenses", async ({
  page,
}) => {
  await start(page);
  const base = await total(page);
  const priorGroceries = await page
    .getByRole("progressbar", {
      name: "Groceries share of spending",
      exact: true,
    })
    .getAttribute("aria-valuetext");
  const previous = Math.round(
    Number(priorGroceries!.split(", ")[1].replace(/[^0-9.]/g, "")) * 100,
  );
  await button(page, "Add a purchase").click();
  await uploadFixture(page, pdf("mixed"), "mixed.pdf", "application/pdf");
  await page
    .getByLabel("What did you buy? *", { exact: true })
    .fill("Mixed household receipt");
  await button(page, "Itemize receipt and track cashback").click();
  await page.getByLabel("Receipt item 1 name", { exact: true }).fill("Milk");
  await page
    .getByLabel("Receipt item 1 line total (USD)", { exact: true })
    .fill("10");
  await button(page, "Groceries · item 1").click();
  await button(page, "Add receipt item").click();
  await page.getByLabel("Receipt item 2 name", { exact: true }).fill("Soap");
  await page
    .getByLabel("Receipt item 2 line total (USD)", { exact: true })
    .fill("20");
  await button(page, "Household · item 2").click();
  await page.getByLabel("Receipt tax (USD)", { exact: true }).fill("3");
  await page
    .getByRole("switch", {
      name: "I reviewed the receipt items, assignments and total",
      exact: true,
    })
    .click();
  await save(page);
  expect(await total(page)).toBe(base + 3300);
  await expect(
    page.getByRole("progressbar", {
      name: "Groceries share of spending",
      exact: true,
    }),
  ).toHaveAttribute(
    "aria-valuetext",
    new RegExp(money(previous + 1100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  const e = (await records(page)).find(
    (e: any) => e.name === "Mixed household receipt",
  );
  expect(e.cents).toBe(3300);
  expect(e.shares.reduce((n: number, s: any) => n + s.cents, 0)).toBe(3300);
  expect(e.receipt_details.items.map((i: any) => i.category)).toEqual([
    "Groceries",
    "Household",
  ]);
  await button(page, "Last month").click();
  await expect(
    page.getByText("Total spent: $0.00", { exact: true }),
  ).toBeVisible();
  await button(page, "All time").click();
  expect(await page.getByText(/^Total spent:/).innerText()).toContain(
    money(base + 3300),
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(page.getByLabel(/^Household spending pie chart/)).toBeVisible();
  await page.screenshot({
    path: "work/spending-pie-desktop.png",
    fullPage: true,
  });
});

test("standalone preview: another roommate cannot create an expense from the same file", async ({
  page,
}) => {
  const preview = await start(page);
  test.skip(!preview, "Separate preview logins are required.");
  const bytes = pdf("shared");
  await simple(page, "Shared document", bytes);
  await save(page);
  const before = (await records(page)).length;
  await nav(page, "Household");
  await button(page, "Switch preview account").click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("jordan@splitcart.demo");
  await page.getByLabel("Password", { exact: true }).fill("splitcart-demo");
  await button(page, "Log in").click();
  await expect(button(page, "Add a purchase")).toBeVisible();
  await simple(page, "Other roommate duplicate", bytes);
  await button(page, "Save purchase").click();
  await expect(
    page.getByText(/Exact duplicate document:/).first(),
  ).toBeVisible();
  expect((await records(page)).length).toBe(before);
});

test("known sample PDFs demonstrate a reviewed mixed receipt without claiming OCR", async ({
  page,
}) => {
  await start(page);
  const base = await total(page);
  await nav(page, "Household");
  await button(page, "Compare plans and manage subscription").click();
  await button(page, "Start 30-day trial with Plus").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "30-day free trial",
  );
  await nav(page, "Overview");
  await button(page, "Add a purchase").click();
  await expect(
    page.getByText(/These buttons do not perform OCR/),
  ).toBeVisible();
  await button(page, "Use sample mixed receipt PDF").click();
  await expect(
    page.getByText("Calculated receipt total: $33.00", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("switch", {
      name: "I reviewed the receipt items, assignments and total",
      exact: true,
    })
    .click();
  await save(page);
  expect(await total(page)).toBe(base + 3300);
  await nav(page, "Household");
  await button(page, "Compare plans and manage subscription").click();
  await button(page, "Cancel subscription").click();
  await button(page, "Confirm subscription cancellation").click();
  await button(page, "Advance to trial expiration").click();
  await expect(page.getByLabel("Household subscription status")).toContainText(
    "Canceled",
  );
  expect(await total(page)).toBe(base + 3300);
  expect(
    (await records(page)).find(
      (e: any) => e.name === "Sample mixed household receipt",
    ).receipt_document.mime,
  ).toBe("application/pdf");
});
