# Receipt / utility documents and household spending

These additions continue the household subscription branch and leave its billing model and all existing tier access unchanged.

## Try all three objectives

Serve the rebuilt `preview/` directory (`python3 -m http.server 3100 --directory preview`) and open the page in the browser on that computer. Choose **Open sample household**. No payment account, external OCR account or Supabase project is needed for this classroom preview.

- **Subscriptions:** Household → Compare plans and manage subscription. Basic $3.99, Plus $5.49, Premium $6.99 per household/month, with the existing one-time 30-day trial and manager-only simulated billing controls. See [subscription documentation](household-subscriptions.md).
- **Utility PDF:** Add a purchase → Use sample utility PDF. This creates a real, viewable sample PDF with known statement facts, selects Utilities, and fills the sample date, provider, invoice number and $60.00 amount. Review the details and enable the document review switch before saving. To try your own made-up file, choose Utility statement → Choose PDF or document; enter the details yourself when extraction is unavailable.
- **Mixed receipt / pie chart:** Add a purchase → Use sample mixed receipt PDF. Its known sample items are $10 groceries and $20 household supplies, plus $3 tax. Review the item categories, roommate assignments and printed total, then enable the item review switch and save. Overview → Spending by category adds $11 to Groceries and $22 to Household, with a $33 increase in total spending. Try This month, Last month and All time, then edit/delete the purchase to see the chart recalculate.
- **Exact duplicate:** Upload the same PDF again with a different filename, amount, date or roommate login. It cannot create another expense. The existing purchase is identified. Close the form and use the existing purchase instead.
- **Suspected duplicate:** Upload different file bytes with matching provider/store, date and amount, or the same provider and invoice reference. Check the listed purchases. Legitimate separate purchases can be saved by enabling **These are different purchases or statements** and completing the normal document review. Confirmation never overrides an exact hash match.

The sample PDF buttons generate valid PDFs and fill **known fixture facts**. The older **Load sample receipt items** button explicitly replaces the attachment with the known sample image and loads its predefined items. None of these actions reads arbitrary images or PDFs or represents OCR. The original seeded receipt cannot create a second expense by being loaded as a sample again.

Both classroom modes compute actual SHA-256 hashes of uploaded file bytes. Separate preview logins (Alex/Jordan/Sam/Riley, password `splitcart-demo`) share one household within the same browser. Demo authentication and storage are local rehearsal data, not a secure shared service or cross-device sync. Use made-up documents.

## Guided upload and review

The purchase editor starts with document type, optional receipt/invoice number, camera/photo/PDF selection, file verification, optional extraction or manual entry, and item-level categorization. Saved expense totals, dates, payers, splits and notes still use the existing purchase form. Uploads alone do not affect spending.

JPEG, PNG, WebP and PDF are supported, up to 5 MB. File signatures are checked against MIME types, not just extensions. Photos retain the existing camera and library paths; native document selection uses Expo Document Picker. PDF attachments use the existing private signed-URL viewer with an Open PDF document action. Web data PDFs are opened through temporary blob URLs that are revoked when the viewer closes. Unknown/HTML/SVG uploads are not accepted; the preexisting bundled sample SVG remains a known demo illustration.

Manually entered item assignments, cent-perfect equal/custom/percentage shares, receipt taxes/tips/discounts, external cashback, one-time flags, shopping completion and grocery/restock links remain available. Itemized receipts still require item review, and simple verified documents require document/date/total review. Editing resets review as the relevant facts change. Only the current payer retains edit/delete permission.

## Deploy to a configured Supabase backend

1. Apply `supabase/migrations/202611260002_documents_spending.sql` after all previous migrations, including the subscription migration. Do not rewrite migrations already applied to a shared project.
2. Deploy `verify-document`. Supabase supplies its service-role key server-side; configure the existing `APP_URL` allowlist. No third-party OCR or billing key is needed for hashing or manual entry.
3. Deploy the updated `scan-receipt` only if optional extraction is wanted. Set the server-only `OPENAI_API_KEY` and an appropriate `RECEIPT_OCR_MODEL` (default `gpt-4.1-mini`). The provider/model must support PDF file input as well as images. Public Expo variables must never contain service-role or provider secrets.
4. Native custom builds must include the new Expo Document Picker dependency. Compatible SDK 54 Expo Go and the browser demo use the SDK-compatible package.

Document upload verification is required for new live attachments. An older backend without the new migration/function continues supporting existing household features and manual expenses, but new verified attachments display a setup error rather than silently bypassing duplicate protection. The deployment is provided and locally tested; this change does not apply migrations or configure external services in a shared live project.

### Private, authoritative duplicate protection

`verify-document` authenticates the account and active household membership before reading a private object. It accepts only household paths and the uploader's own folder (or an already shared expense attachment). It downloads the immutable original, validates size/type/signature, hashes its bytes with SHA-256, and registers that hash using server-only authority. Client-provided hashes are never trusted for live expense saves.

The private `household_documents` registry is not directly readable/writable by clients. A new wrapper around the existing `save_expense` chain resolves the verified hash, validates review and item categories, and checks all household expenses, including former roommates' history. Household row locks serialize competing save requests, so two simultaneous uploads cannot both create an expense for the same bytes. Shopping/grocery-linked saves pass through the same checks atomically; old internal wrappers remain non-callable by authenticated clients.

Exact matches use content hash or an existing attachment path and cannot be overridden to create another expense. Existing historical records can still be corrected when their document identity is unchanged; changing an expense to somebody else’s already-counted document is blocked. Suspected matches normalize provider/store and reference punctuation/case, then compare merchant/date/amount or invoice identity. The server recomputes matching IDs on save; a new concurrent match requires another confirmation. Successful confirmations are stored with the expense. Different households do not share or disclose document matches. No feature removes existing expenses automatically or alters roommate repayment history.

Older live uploads are indexed on demand before accepting new documents: up to 50 legacy expense rows per verification call, with progress saved privately. Larger households retry to complete indexing; duplicate protection is never skipped. Inaccessible/corrupted old files must be restored or their expense attachments corrected before indexing can complete. Browser preview uploads similarly index older locally stored attachments. Legacy purchases without attachments remain compatible.

Uploads abandoned before an expense is saved may remain private orphan objects, as with the existing receipt workflow. The client cannot overwrite/delete immutable evidence; any future orphan retention cleanup belongs in a separate operator-controlled maintenance task.

### Optional extraction and manual fallback

`scan-receipt` sends a reviewed user's private image or PDF to the configured external service only after they choose scanning. Its structured response includes merchant/provider, date, currency, invoice/receipt reference, document type, item names/totals/categories, tax, tip, discount and printed total. Utility extraction asks for current charges/amount due once rather than summing subtotal/previous-balance/total rows. The existing per-user daily scan limit and household access checks remain in effect.

Extraction can be unavailable, illegible or wrong. Every extracted field is editable and must be reviewed; inconsistent totals or invalid categories cannot be saved as itemized expenses. Manual entry with a verified attachment works without any external extraction service. No automatic bank/biller feed, real payment or background bill payment is introduced.

## Spending calculations

`spendingBreakdown` consumes recorded household expenses. Each expense contributes its full total once. Item categories are optional; missing categories fall back to the purchase category, and historical Food & drinks continues reporting as Dining. The recorded date and household currency drive the unchanged period filters and formatting.

For valid itemized expenses, their recorded total (including tax, tip and discount) is allocated to item weights using integer cents and deterministic largest remainders, then grouped by category. Rounding never creates or loses a cent. Cashback does not reduce spending. The category purchase counts may overlap for a mixed receipt, while the overall count remains one per expense. Invalid legacy item metadata safely falls back to the recorded purchase total/category.

The accessible pie/donut chart and color-matched legend show category amounts and percentages. Existing progress bars and filter controls are retained. The report derives from the store's current expenses, so saves, edits and deletions recalculate without a separate reporting ledger. Repayments, card surcharges, shopping plans, future bills and simulated subscription charges are excluded.

Recognized historical duplicates are counted once by household-scoped hash (or expense ID), selecting the earliest created record before date filtering. An explicit report notice explains exclusions; the original purchases remain in history for payer review. The report does not silently delete or rewrite older debts. Different files explicitly confirmed as legitimate similar purchases are both counted.

## Tests

- `npm run typecheck`
- `npm test` and `npm run test:db` (all migrations with PGlite)
- `npm run test:e2e -- documents-spending.spec.ts subscriptions.spec.ts`
- `npm run build:web` and `npm run build:preview`
- `npm run test:e2e:preview`
- From `supabase/functions`: `deno task check` and `deno task test`

On managed cloud machines, the tests can serve the exported normal demo on 3103 and packaged preview on 3102 to avoid reserved system ports. The repository's existing default Playwright ports remain unchanged for classmates. Tests cover exact and suspected duplicates, concurrency, forged hashes and unauthorized access, review, mixed categories, rounding/filter compatibility, PDF/image signatures, real byte hashing, external-service fallback, subscriptions, and live chart updates after save/edit/delete.
