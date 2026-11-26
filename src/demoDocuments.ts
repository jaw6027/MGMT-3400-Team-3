/** Known classroom fixtures. These facts are provided with the sample, never extracted from an arbitrary upload. */
export function sampleHouseholdDocument(
  kind: "utility" | "mixed",
  currency: string,
  date: string,
) {
  const utility = kind === "utility",
    merchant = utility ? "Sample Electric" : "Sample Market";
  const reference = `${utility ? "UTILITY" : "RECEIPT"}-DEMO-${date}`;
  const items = utility
    ? [
        {
          name: "Current electricity charges",
          cents: 6000,
          category: "Utilities",
        },
      ]
    : [
        { name: "Milk and groceries", cents: 1000, category: "Groceries" },
        {
          name: "Household cleaning supplies",
          cents: 2000,
          category: "Household",
        },
      ];
  const total = utility ? 6000 : 3300;
  const lines = [
    "SPLITCART CLASSROOM SAMPLE - NOT A REAL BILL",
    merchant,
    `Date: ${date}`,
    `Invoice: ${reference}`,
    ...items.map((i) => `${i.name}: ${(i.cents / 100).toFixed(2)} ${currency}`),
    ...(!utility ? ["Tax: 3.00 " + currency] : []),
    `Total: ${(total / 100).toFixed(2)} ${currency}`,
    "Known sample facts. This is not an OCR result.",
  ];
  const escape = (value: string) => value.replace(/([()\\])/g, "\\$1");
  const stream = `BT /F1 12 Tf 45 740 Td ${lines.map((line, index) => `${index ? "0 -28 Td " : ""}(${escape(line)}) Tj`).join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return {
    asset: {
      uri: `data:application/pdf;base64,${btoa(pdf)}`,
      mimeType: "application/pdf",
      name: utility ? "sample-utility.pdf" : "sample-mixed-receipt.pdf",
      fileSize: pdf.length,
    },
    merchant,
    reference,
    total,
    items,
    taxCents: utility ? 0 : 300,
  };
}
