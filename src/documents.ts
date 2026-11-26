export {
  assertDocumentDuplicates,
  documentMatches,
  normalizeDocumentText,
  validateDocument,
  spendingCategories,
} from "../supabase/functions/_shared/document-rules";
export type { ReceiptDocument } from "../supabase/functions/_shared/document-rules";
export type DocumentAsset = {
  uri: string;
  mimeType?: string | null;
  fileSize?: number;
  name?: string;
  fileName?: string | null;
};
