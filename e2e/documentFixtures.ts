import { expect, type Page } from "@playwright/test";
export const testImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
export async function uploadFixture(
  page: Page,
  buffer: Buffer = testImage,
  name = "receipt.png",
  mimeType = "image/png",
) {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Choose PDF or document", exact: true })
    .click();
  await (await chooser).setFiles({ name, mimeType, buffer });
  await expect(page.getByText(/^Verified file:/)).toBeVisible();
}
export async function reviewDocument(page: Page) {
  const control = page.getByRole("switch", {
    name: "I reviewed the document, date, total and expense details",
    exact: true,
  });
  await expect(control).toBeVisible();
  if (!(await control.isChecked())) await control.click();
}
