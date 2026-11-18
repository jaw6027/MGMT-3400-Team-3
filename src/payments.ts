export {
  quote,
  dueDate,
  reminderDate,
  validateReminder,
} from "../supabase/functions/_shared/payment-rules";
export type { Funding } from "../supabase/functions/_shared/payment-rules";
export type PaymentMethod = {
  id: string;
  label: string;
  funding: "bank" | "credit" | "debit";
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
export type PaymentState = {
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
