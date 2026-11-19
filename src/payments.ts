export {
  quote,
  dueDate,
  reminderDate,
  validateReminder,
} from "../supabase/functions/_shared/payment-rules";
export type { Funding } from "../supabase/functions/_shared/payment-rules";
export type PaymentMethod = {
  issue?: string;
  brand?: string;
  id: string;
  label: string;
  funding: "bank" | "credit" | "debit";
  verification?: "verified" | "pending";
};
export type Due = {
  id: string;
  recipient: string;
  cents: number;
  day: number;
  automatic: boolean;
  method: string;
  consent: boolean;
  paused?: boolean;
  created_at?: string;
};
export type Payment = {
  completed_at?: string | null;
  funding?: "bank" | "credit" | "debit";
  failureCode?: string | null;
  methodLabel?: string;
  dueId?: string;
  dueDate?: string;
  requestId?: string;
  id: string;
  cents: number;
  fee: number;
  status: string;
  created_at: string;
  recipient: string;
};
export type Reminder = {
  email: boolean;
  sms: boolean;
  phone: string;
  days: number;
  consent: boolean;
  autopayNotices?: boolean;
  paymentUpdates?: boolean;
};
export type PaymentRequest = {
  id: string;
  requester: string;
  payer: string;
  cents: number;
  note: string;
  expenseId?: string;
  canceled: boolean;
  created_at: string;
  status?: string;
};
export type PaymentNotice = { id: string; message: string; created_at: string };
export type BankLinkAttempt = {
  id: string;
  label: string;
  status:
    | "awaiting_details"
    | "verification_pending"
    | "verified"
    | "failed"
    | "expired"
    | "unavailable";
  canVerify: boolean;
  canResume?: boolean;
  arrivalDate?: string;
};
export type IncomingPayment = {
  funding?: string;
  failureCode?: string | null;
  id: string;
  cents: number;
  status: string;
  created_at: string;
  sender: string;
};
export type PaymentState = {
  bankIssues?: { id: string; state: string; message: string }[];
  security?: {
    verifiedUntil: number;
    recoveryCodesRemaining?: number;
    recoveryPending?: boolean;
    canResumeRecovery?: boolean;
  };
  demoRecoveryHashes?: string[];
  bankLinks?: BankLinkAttempt[];
  incomingPayments?: IncomingPayment[];
  payoutStatus?:
    | "not_started"
    | "needs_details"
    | "verification_pending"
    | "ready"
    | "restricted";
  requests?: PaymentRequest[];
  notifications?: PaymentNotice[];
  phoneVerified: boolean;
  methods: PaymentMethod[];
  payoutReady: boolean;
  dues: Due[];
  payments: Payment[];
  reminder: Reminder;
  appDues: number;
  available: boolean;
};
export const emptyPayments: PaymentState = {
  phoneVerified: false,
  methods: [],
  payoutReady: false,
  dues: [],
  payments: [],
  appDues: 0,
  available: false,
  reminder: { email: false, sms: false, phone: "", days: 3, consent: false },
};
