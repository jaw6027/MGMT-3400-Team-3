import {
  subscriptionPlans,
  subscriptionMoney,
  subscriptionPolicy,
} from "./subscriptions";
/** Editable, local support content. No network calls or access to household data. */
export type SupportDestination =
  | "Grocery & Restock Rotation"
  | "Overview"
  | "Shopping"
  | "Chore Tracker"
  | "Purchases"
  | "Balances"
  | "Household";
export type SupportTopic = {
  id: string;
  question: string;
  patterns: RegExp[];
  answer: string;
  destination?: SupportDestination;
  followUps: string[];
};

// Prices are classroom simulations. Proposed benefits never restrict existing tools.
export const subscriptionInfo = {
  monthlyPrice:
    subscriptionPlans
      .map((p) => `${p.name} ${subscriptionMoney(p.cents)}`)
      .join(", ") + " USD per household per month",
  freeFeatures: subscriptionPolicy.benefits,
  premiumFeatures: subscriptionPlans[2].benefits.join("; "),
  management: subscriptionPolicy.changes,
  cancellation: subscriptionPolicy.cancellation,
  dataAfterCancellation:
    "Household expense history is preserved after cancellation. Clearing browser storage or resetting demo data still removes local demo records.",
  householdSharing: subscriptionPolicy.sharing,
};
export const supportContact: string | null = null;
const plans = () =>
  `Open Household → Compare plans and manage subscription. ${subscriptionInfo.monthlyPrice}. ${subscriptionPolicy.trial} ${subscriptionPolicy.sharing} Only the designated household billing manager can activate, change or cancel.\n\nBasic proposes everyday expense sharing and shopping; Plus adds chore, grocery and recurring-bill organization; Premium adds itemized splits, spending insights and split comparison tools. ${subscriptionPolicy.benefits}\n\nThis is simulated classroom billing only. No real payment credentials are requested and no money moves. Use the subscription screen to see trial expiration and renewal dates, advance the billing clock, simulate a failed payment, or retry it. There is no permanent free-tier promise.`;

export const supportTopics: SupportTopic[] = [
  {
    id: "groceryRotation",
    question: "Who's up next?",
    patterns: [
      /\b(who s up next|who s next|whose turn|my turn|grocery rotation|grocery schedule|shopping schedule|grocery trips?|shopping turns?)\b/,
    ],
    answer:
      "Open Grocery & Restock Rotation (Rotation on phone navigation). Who’s up next shows the current shopper, next roommate and upcoming dates. Create grocery rotation lets you choose participants and a weekly, every-two-weeks or custom 1–365-day interval.\n\nWhen it’s your turn and the date has started, choose Mark turn complete and confirm. The next roommate is assigned automatically. Completing a trip records your responsibility; it does not create a bill or mark individual supplies purchased. Use Record shared grocery expense in the trip history to enter the real amount and choose the payer and shares.",
    destination: "Grocery & Restock Rotation",
    followUps: ["Swap my turn", "Restock supplies"],
  },
  {
    id: "grocerySwap",
    question: "Swap my turn",
    patterns: [/\b(swap|skip|unavailable|can t shop|cannot shop|can t make)\b/],
    answer:
      "Open Rotation → Who’s up next. The current shopper can choose Swap Turn, pick another participant and Request turn swap. Your assignment stays the same until that roommate signs into their own account and selects Accept turn swap. They can decline; you can cancel a pending request. An accepted swap exchanges your positions.\n\nSkip my turn instead moves you to the end of the queue and assigns the next person with the same due date. Skips do not count as completed trips. Schedule edits, completion or skips expire pending swaps. Preview accounts can demonstrate both sides only in the same browser; normal demo mode has just the Alex account.",
    destination: "Grocery & Restock Rotation",
    followUps: ["Who's up next?", "Restock supplies"],
  },
  {
    id: "restock",
    question: "Restock supplies",
    patterns: [
      /\b(restock|restocking|running low|toilet paper|paper towels|dish soap|laundry detergent|trash bags|hand soap|essentials)\b/,
    ],
    answer:
      "Open Rotation → Household essentials. Any roommate can select Running Low. It reuses or adds one matching planned item in the existing Shopping list, with the assigned shopper and your preferred-brand/quantity notes. Edit details lets you record remaining quantity; Add custom essential adds your own supplies.\n\nOption A assigns low supplies to the grocery shopper. Option B rotates each item’s responsibility across separate participants on a date-based schedule. Only the assigned restocker can choose Mark as Purchased; the existing expense form records the amount, actual payer and split. Saving clears Running Low and records the purchase date. It does not send money or complete the grocery trip.",
    destination: "Grocery & Restock Rotation",
    followUps: ["Who's up next?", "How do shared shopping lists work?"],
  },
  {
    id: "plans",
    question: "Subscription Plans",
    patterns: [
      /\b(premium|pricing|price|plans?|free version|paid version|paid subscription|free tier|free plan|subscription benefits)\b/,
      /how much.*(cost|splitmate|splitcart)/,
      /\b(subscription|basic|plus|trial|billing manager|renewal|failed subscription payment)\b/,
    ],
    answer: plans(),
    destination: "Household",
    followUps: ["How do I upgrade?", "Is my subscription shared?"],
  },
  {
    id: "upgrade",
    question: "How do I upgrade?",
    patterns: [
      /\b(upgrade|change|switch|manage)\b.*\b(subscription|plan|premium)\b/,
      /\bupgrade\b/,
    ],
    answer: `Open Household → Compare plans and manage subscription. Only the household billing manager can select a plan and confirm the change. ${subscriptionPolicy.changes} A queued change can be replaced, or removed by selecting the current plan. No extra mid-cycle charge occurs. If a payment failed, use Retry simulated payment or cancel before changing the plan. This is simulated billing only.`,
    destination: "Household",
    followUps: ["Subscription Plans", "How do I cancel my subscription?"],
  },
  {
    id: "cancel",
    question: "How do I cancel my subscription?",
    patterns: [
      /\b(cancel|end|stop)\b.*\b(subscription|premium|plan|membership)\b/,
    ],
    answer: `Open Household → Compare plans and manage subscription → Cancel subscription, then confirm. Only the billing manager can do this. ${subscriptionPolicy.cancellation} Before the end date, Keep subscription renewing undoes scheduled cancellation. Reactivation after cancellation does not grant another trial and records an immediate simulated monthly charge. Recurring roommate bills in Balances → Autopay are separate. I cannot cancel anything for you.`,
    destination: "Household",
    followUps: [
      "Will I lose information if I cancel?",
      "How do recurring bills work?",
    ],
  },
  {
    id: "cancelData",
    question: "Will I lose information if I cancel?",
    patterns: [
      /\b(lose|keep|retain|delete|information|data)\b.*\b(cancel|subscription|premium|downgrade)\b/,
      /\bcancel\b.*\b(data|information|history)\b/,
    ],
    answer: `${subscriptionInfo.dataAfterCancellation} ${subscriptionPolicy.benefits} Cancellation changes subscription billing only; it never deletes purchases, receipts, balances or repayments.`,
    destination: "Household",
    followUps: [
      "Subscription Plans",
      "What happens when a roommate moves out?",
    ],
  },
  {
    id: "sharingPlan",
    question: "Is my subscription shared?",
    patterns: [
      /\b(subscription|premium|plan)\b.*\b(shared|roommates|household|everyone)\b/,
      /\bshare\b.*\b(subscription|premium|plan)\b/,
    ],
    answer: `${subscriptionPolicy.sharing} Roommates sign into their own accounts and see the same plan, trial expiration and renewal dates. New active members are included without an extra subscription charge. Only the billing manager can change the subscription or transfer management to another active roommate. If the manager leaves, the first remaining roommate can recover billing management from Household. This demo is local to one browser/device and uses simulated billing.`,
    destination: "Household",
    followUps: ["Subscription Plans", "Invite a Roommate"],
  },
  {
    id: "about",
    question: "What is SplitMate?",
    patterns: [
      /\bwhat (is|s|does) (splitmate|splitcart)\b/,
      /how (does|do) (splitmate|splitcart) work/,
      /\b(different|competitors|special)\b/,
    ],
    answer:
      "SplitCart helps roommates plan shopping, share expenses, see balances, record repayments and organize chores. I’m SplitMate Assistant, the in-app guide.\n\nStart with a household, add purchases and choose each person’s share. Balances uses those shares and recorded repayments to show who owes whom. The demo uses fictional local data; it does not send money or messages. No comparison with competitors has been verified.",
    destination: "Overview",
    followUps: ["How do I create an account?", "How to Split a Bill"],
  },
  {
    id: "account",
    question: "How do I create an account?",
    patterns: [
      /\b(create|make|register|sign up|signup|open)\b.*\b(account|login)\b/,
      /\b(sign up|signup|register)\b/,
    ],
    answer:
      "1. On the login screen, choose the account-creation option.\n2. Enter your name, email and a password of at least 8 characters.\n3. Choose Create a household or Join with a code, then select Create account.\n4. In live mode, confirm your email if requested, return and log in.\n\nThe browser preview uses made-up local accounts and sends no confirmation email. Open sample household is the quickest way to explore. In the normal demo, Household → Switch to live accounts opens real login, which requires a configured backend.",
    followUps: [
      "How do I set up my household?",
      "How do I join an existing household?",
    ],
  },
  {
    id: "setup",
    question: "How do I set up my household?",
    patterns: [
      /\b(create|set up|setup|make|start|name|rename)\b.*\b(household|home)\b/,
    ],
    answer:
      "1. During signup or after signing in without a household, choose Create a household.\n2. Enter a household name and choose its currency.\n3. Complete account creation or select Create household. Your invitation code appears when setup finishes.\n\nTo rename it later: Household → Make it your home → Household name → Save household name. A household uses one currency; currency conversion is not included.",
    destination: "Household",
    followUps: ["Invite a Roommate", "How do I join an existing household?"],
  },
  {
    id: "invite",
    question: "Invite a Roommate",
    patterns: [
      /\b(invite|invitation)\b/,
      /\b(copy|find|get|share)\b.*\bcode\b/,
      /\badd\b.*\b(roommate|member)\b/,
    ],
    answer:
      "1. Open Household → Invite your roommates.\n2. Choose Copy invitation code (or Share on a device).\n3. Ask your roommate to create their own account, choose Join with a code and enter it.\n\nTreat the code as private. Browser-preview accounts and codes only work in the same browser; normal demo codes are fictional. Real cross-device sharing requires the live backend.",
    destination: "Household",
    followUps: [
      "How do I join an existing household?",
      "Why can't I see my roommate's changes?",
    ],
  },
  {
    id: "join",
    question: "How do I join an existing household?",
    patterns: [
      /\bjoin\b.*\b(household|home|roommate|code)\b/,
      /\b(existing household|invalid code|wrong code)\b/,
    ],
    answer:
      "1. Ask a current roommate for the private invitation code.\n2. Choose Join with a code during signup, or on the household setup screen after login.\n3. Paste the code and complete signup/login. Spaces and letter case are accepted.\n\nIf a code is invalid, check it with your roommate and correct it on the setup screen; you do not need another account. Only one active household per account is supported. Preview codes are local to the same browser.",
    followUps: ["Invite a Roommate", "Can I use multiple households?"],
  },
  {
    id: "split",
    question: "How to Split a Bill",
    patterns: [
      /\b(split|divide|share)\b.*\b(bill|rent|expense|cost|groceries|purchase|utilities|dinner)\b/,
      /\b(add|log|record|enter|new)\b.*\b(expense|purchase|bill|rent)\b/,
      /\bsplit\b/,
    ],
    answer:
      "1. Open Purchases → Add purchase (or Add a purchase on Overview).\n2. Enter the item, total, date, category and who paid. For rent, choose Rent.\n3. Choose the roommates sharing it. Use Equally, or Custom for exact amounts.\n4. Review the shares and select Save purchase.\n\nCustom shares must add up to the total. Saving records an expense; it does not charge anyone or send a payment.",
    destination: "Purchases",
    followUps: [
      "Can I split expenses unevenly?",
      "How do I see who owes money?",
    ],
  },
  {
    id: "uneven",
    question: "Can I split expenses unevenly?",
    patterns: [
      /\b(unevenly|uneven|unequally|unequal|custom shares?|different amounts|not equally|percentage|percentages)\b/,
    ],
    answer:
      "Yes — use exact amounts.\n1. Add a purchase and select the roommates sharing it.\n2. Choose Custom in the split controls.\n3. Enter each roommate’s amount. The amounts must add up to the purchase total.\n4. Review and save.\n\nFor a percentage split, calculate the amounts first; the form accepts amounts rather than a percentage slider. Receipt itemization can also allocate individual items to different people.",
    destination: "Purchases",
    followUps: ["How to Split a Bill", "How do you calculate balances?"],
  },
  {
    id: "balances",
    question: "How do I see who owes money?",
    patterns: [/\b(owe|owes|owed|debt|debts|balance|balances|settle up)\b/],
    answer:
      "Open Balances to see each roommate’s net position and settlement suggestions. Positive means they should receive money; negative means they owe money.\n\nPurchases shows individual expense shares. Recording a purchase does not collect money. After an actual repayment, use Record repayment, or review the separate payment flow under Manage payments. Demo payments are simulations.",
    destination: "Balances",
    followUps: [
      "How do you calculate balances?",
      "How do I mark an expense as paid?",
    ],
  },
  {
    id: "calculation",
    question: "How do you calculate balances?",
    patterns: [
      /\b(calculate|calculated|calculation|math|rounding)\b/,
      /how.*work out.*ow/,
    ],
    answer:
      "For each roommate, SplitCart adds what they paid, subtracts their assigned expense shares, then adjusts for recorded repayments. Positive balances receive money; negative balances owe. Equal splits distribute spare cents consistently so all shares match the total. Settlement suggestions simplify who can repay whom. Credit-card fees are separate and do not pay down someone else’s share.",
    destination: "Balances",
    followUps: [
      "Can I split expenses unevenly?",
      "How do I mark an expense as paid?",
    ],
  },
  {
    id: "paid",
    question: "How do I mark an expense as paid?",
    patterns: [
      /\b(mark|record|log)\b.*\b(paid|repayment|repaid|payment)\b/,
      /\b(pay back|repay|paid back|already paid)\b/,
      /\b(send|transfer|pay)\b.*\b(money|now|roommate|rent|bill)\b/,
    ],
    answer:
      "There is no generic paid checkbox for an expense.\n1. After money has actually changed hands, open Balances → Record repayment.\n2. Choose who sent and received it, enter the amount and date, and confirm. This records a ledger entry; it does not transfer money.\n3. For bank/card or cash workflows, open Manage payments and review the status. Cash needs receiver confirmation.\n\nManual repayment entries cannot currently be edited/reversed in the app. I can explain the steps, but cannot make or mark payments for you. All demo payments are simulated.",
    destination: "Balances",
    followUps: [
      "How do I track previous expenses?",
      "Is my financial information safe?",
    ],
  },
  {
    id: "history",
    question: "How do I track previous expenses?",
    patterns: [
      /\b(previous|past|history|find|where|view|track|see)\b.*\b(expenses|purchases|expense history|spending)\b/,
      /\bexpense history\b/,
    ],
    answer:
      "Open Purchases for your household’s expense history. Search by item, store or notes, and use the payer, category and date filters. Open a purchase to see who paid, each share and any attached receipt. For bank/card payment statuses and receipts, open Balances → Manage payments → Activity.",
    destination: "Purchases",
    followUps: [
      "Can I edit or delete an expense?",
      "Why isn't an expense showing up?",
    ],
  },
  {
    id: "edit",
    question: "Can I edit or delete an expense?",
    patterns: [/\b(edit|delete|change|remove)\b.*\b(expense|purchase|bill)\b/],
    answer:
      "1. Open Purchases and select the saved purchase.\n2. If you are its current payer, choose Edit purchase or Delete.\n3. Review changes and save, or confirm deletion.\n\nOnly the current payer can edit/delete it. Changing its payer transfers that permission. Deleting an expense removes its shares and changes balances. I cannot edit or delete records for you.",
    destination: "Purchases",
    followUps: [
      "How do I track previous expenses?",
      "Can I split expenses unevenly?",
    ],
  },
  {
    id: "shopping",
    question: "How do shared shopping lists work?",
    patterns: [
      /\b(shopping|grocery list|groceries list|shopping lists?)\b/,
      /\b(add|create|share)\b.*\blist\b/,
      /roommates.*add.*items/,
    ],
    answer:
      "1. Open Shopping → Add item.\n2. Choose a household catalog item or Custom expense.\n3. Choose the buyer and any one-time setting, then Add to household list.\n\nActive household members can add shared items in live mode. Planned items are not expenses until someone logs a purchase. Demo edits stay on this device/browser and are not shared across devices.",
    destination: "Shopping",
    followUps: [
      "How do I mark something as purchased?",
      "Can I see who bought an item?",
    ],
  },
  {
    id: "bought",
    question: "How do I mark something as purchased?",
    patterns: [
      /\b(mark|log|record)\b.*\b(purchased|bought|shopping item)\b/,
      /\b(buy|complete)\b.*\b(list item|shopping item)\b/,
    ],
    answer:
      "1. In Shopping → Planned, find the item and select Log purchase.\n2. Confirm the actual payer, total and shares in the purchase form.\n3. Save purchase. The item moves to Purchased and links to its expense.\n\nThis records what was bought; it does not order goods or charge a card.",
    destination: "Shopping",
    followUps: ["Can I see who bought an item?", "How to Split a Bill"],
  },
  {
    id: "buyer",
    question: "Can I see who bought an item?",
    patterns: [
      /\b(who|which roommate|last buyer)\b.*\b(bought|purchased|buy|item)\b/,
    ],
    answer:
      "Yes. Open Shopping → Purchased: each item shows the actual buyer, date and amount. View purchase opens the linked expense. Planned items show an assigned buyer; that is a plan, not proof of purchase. Last bought by comes from recorded purchase history, and repeat items can suggest the next active roommate.",
    destination: "Shopping",
    followUps: [
      "How do shared shopping lists work?",
      "How do I mark something as purchased?",
    ],
  },
  {
    id: "recurring",
    question: "How do recurring bills work?",
    patterns: [
      /\b(recurring|autopay|automatic payment|monthly dues|monthly rent|cancel schedule|cancel autopay)\b/,
    ],
    answer:
      "Open Balances → Manage payments → Autopay. Name the monthly rent, internet, utility or subscription bill; choose a recipient, amount and due day. Use a manual due, or enable bank autopay only after reviewing its consent and verified bank requirements. Save and check Upcoming. Existing schedules have edit, pause and cancel controls.\n\nThese are fixed monthly household dues, not external biller integrations. Demo autopay never runs or moves money. A shared Netflix bill is different from a SplitCart app subscription.",
    destination: "Balances",
    followUps: ["How do reminders work?", "Subscription Plans"],
  },
  {
    id: "chores",
    question: "How do I organize chores?",
    patterns: [/\b(chore|chores|responsibilities|cleaning|housework)\b/],
    answer:
      "1. Open Chore Tracker (Chores on the phone navigation).\n2. Choose Add chore or Custom chore.\n3. Set its recurrence, fixed member or Take turns order, and next due date; select Save chore.\n4. Use Log completion when done and review Completion history.\n\nChore schedules track due dates; they do not send background push reminders.",
    destination: "Chore Tracker",
    followUps: ["How do reminders work?", "Find a Feature"],
  },
  {
    id: "profile",
    question: "How do I update my profile?",
    patterns: [
      /\b(profile|settings|display name|account settings|accessibility|larger text)\b/,
    ],
    answer:
      "Open Household (or the avatar at the top). Under Your profile, edit Display name and choose Save profile. Household also contains the household name, invitation code, account security, accessibility settings and sign-out controls. I can guide you, but I do not change your account.",
    destination: "Household",
    followUps: ["How do I reset my password?", "Invite a Roommate"],
  },
  {
    id: "password",
    question: "How do I reset my password?",
    patterns: [/\b(password|forgot login|locked out)\b/],
    answer:
      "On the login screen, select Forgot password?, enter your email and choose Send password reset link. In live mode, open the recovery email to choose and confirm a new password. Check spam and use a fresh link if it has expired.\n\nThe browser preview only displays a simulation message; it sends no email and does not change preview passwords. Never send me a password, verification code or recovery code.",
    followUps: [
      "How do I create an account?",
      "What should I do if a feature isn't working?",
    ],
  },
  {
    id: "missing",
    question: "Why isn't an expense showing up?",
    patterns: [
      /\b(expense|purchase)\b.*\b(missing|not showing|isn t showing|showing up|not appearing|disappeared|can t find)\b/,
      /\b(missing|can t find)\b.*\b(expense|purchase)\b/,
    ],
    answer:
      "1. Open Purchases and clear search, payer, category and date filters.\n2. Check that you saved the purchase, rather than only adding a planned shopping item.\n3. Confirm the account and household. In live mode, check your connection and pull down to refresh.\n\nDemo data is local to this browser/device. Another browser or a reset can show different data. If it still fails, note the steps and any error, without sharing private receipts or payment details.",
    destination: "Purchases",
    followUps: [
      "Why can't I see my roommate's changes?",
      "How do I contact support?",
    ],
  },
  {
    id: "sync",
    question: "Why can't I see my roommate's changes?",
    patterns: [
      /\b(roommate|others?|shared)\b.*\b(changes|updates|sync|not showing)\b/,
      /\b(sync|refresh|realtime|real time|offline)\b/,
    ],
    answer:
      "In live mode, make sure both accounts belong to the same household, check the connection and pull down on a screen to refresh. SplitCart refreshes after your own changes and login, but does not provide realtime updates or an offline write queue.\n\nNormal demo data stays on one device; browser-preview accounts and changes stay in the same browser. They do not synchronize across devices.",
    destination: "Household",
    followUps: [
      "How do I join an existing household?",
      "What should I do if a feature isn't working?",
    ],
  },
  {
    id: "trouble",
    question: "What should I do if a feature isn't working?",
    patterns: [
      /\b(not working|isn t working|broken|bug|error|crash|stuck|troubleshoot|troubleshooting)\b/,
    ],
    answer:
      "1. Note the screen, the steps you tried and the exact error.\n2. Check whether you are in demo or live mode. Live features need a connection and configured services.\n3. In live mode, refresh the screen and retry once. For payments, check Activity before trying again to avoid duplicate attempts.\n4. If needed, reload after checking that your work saved. Do not clear browser storage unless you intend to lose local demo data.\n\nShare a sanitized description with your project team; never include passwords, full card/bank details or private receipts.",
    followUps: [
      "How do I contact support?",
      "Why isn't an expense showing up?",
    ],
  },
  {
    id: "contact",
    question: "How do I contact support?",
    patterns: [
      /\b(contact|human|agent|email support|support team|customer service|support ticket)\b/,
    ],
    answer: supportContact
      ? `Support contact: ${supportContact}. Include the screen, steps and a sanitized error description. I cannot submit a ticket or contact support for you.`
      : "Support contact — placeholder: no public support address, live agent or ticket system is configured in this demo. Ask your class project team through the channel you already use. Include the screen, steps and a sanitized error description. I cannot submit a ticket or contact anyone for you.",
    followUps: [
      "What should I do if a feature isn't working?",
      "Find a Feature",
    ],
  },
  {
    id: "multiple",
    question: "Can I use multiple households?",
    patterns: [
      /\b(multiple|two|several|switch between)\b.*\b(households?|homes)\b/,
    ],
    answer:
      "Only one active household per account is supported. You cannot switch between multiple active households. Leaving preserves the old household’s purchase and repayment history; rejoining the same household restores the original membership. Check outstanding balances with roommates before leaving.",
    destination: "Household",
    followUps: [
      "What happens when a roommate moves out?",
      "How do I join an existing household?",
    ],
  },
  {
    id: "leave",
    question: "What happens when a roommate moves out?",
    patterns: [
      /\b(move[sd]? out|moving out|leave|leaves|leaving|former roommate)\b/,
      /\b(remove|kick|delete)\b.*\b(roommate|member)\b/,
    ],
    answer:
      "A roommate can open Household → Leave household and review the confirmation. Leaving keeps their past purchases, shares, names and repayments in household history; it does not erase what is owed. Rejoining the same household restores membership.\n\nThere is no control for removing another roommate in the current app. Arrange any remaining repayment together; I cannot remove members or settle balances.",
    destination: "Household",
    followUps: [
      "Can I use multiple households?",
      "How do I see who owes money?",
    ],
  },
  {
    id: "reminders",
    question: "How do reminders work?",
    patterns: [/\b(remind|reminders?|notifications?|texts?|sms|alerts)\b/],
    answer:
      "Open Balances → Manage payments → Reminders. Choose email/text reminders, timing and any advance autopay/status notices, then Save reminder preferences. Texts require consent and phone verification.\n\nDemo verification is simulated (sample code 123456); no emails, texts or automatic charges run. Live delivery requires deployed providers and a scheduled job. Chore due dates do not send background reminders, and push notifications are not included.",
    destination: "Balances",
    followUps: ["How do recurring bills work?", "How do I organize chores?"],
  },
  {
    id: "security",
    question: "Is my financial information safe?",
    patterns: [
      /\b(safe|secure|security|privacy|private|financial information|api key|bank details|card details)\b/,
    ],
    answer:
      "Use made-up information in the demo: it is a local rehearsal, not secure shared authentication. In the live design, Supabase access rules restrict household records and receipts; Stripe’s secure pages collect full bank/card details. Financial setup requires fresh two-step verification. These protections still need deployment and live integration testing; no app can promise zero risk.\n\nThis assistant uses local help content, sends no chat to an AI service and keeps chat only in memory for this session. Do not enter passwords, codes or bank/card numbers.",
    destination: "Household",
    followUps: ["How do I reset my password?", "How do I contact support?"],
  },
  {
    id: "navigation",
    question: "Find a Feature",
    patterns: [
      /\b(find a feature|navigation|navigate|where do i go|screens|help|hello|hi|hey|thanks|thank you)\b/,
    ],
    answer:
      "Here’s your map:\n• Overview: dashboard and recent purchases.\n• Purchases: add, search and view expenses.\n• Balances: debts, repayments and Manage payments.\n• Shopping: planned items and purchase history.\n• Chore Tracker: assignments and completion history.\n• Household: invitations, profile and settings.\n• Grocery & Restock Rotation: shopping turns, essentials and agreed swaps.\n\nChoose a section below, or ask me what you’d like to do.",
    followUps: ["How to Split a Bill", "How do shared shopping lists work?"],
  },
];

export type SupportReply = {
  topic: string | null;
  text: string;
  destination?: SupportDestination;
  followUps: string[];
};
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
// Short prompts deliberately map to a guide, never to an account/payment action.
const shortSupport: Record<string, string> = {
  bill: "split",
  bills: "split",
  rent: "split",
  expense: "split",
  "add expense": "split",
  "split bill": "split",
  expenses: "history",
  purchases: "history",
  history: "history",
  money: "balances",
  owe: "balances",
  debt: "balances",
  balance: "balances",
  balances: "balances",
  paid: "paid",
  payment: "paid",
  payments: "paid",
  pay: "paid",
  repay: "paid",
  shopping: "shopping",
  groceries: "shopping",
  grocery: "shopping",
  list: "shopping",
  items: "shopping",
  "add item": "shopping",
  bought: "bought",
  purchased: "bought",
  "shopping list": "shopping",
  rotation: "groceryRotation",
  schedule: "groceryRotation",
  turn: "groceryRotation",
  "my turn": "groceryRotation",
  next: "groceryRotation",
  "who s next": "groceryRotation",
  "who next": "groceryRotation",
  "whos next": "groceryRotation",
  "who s up next": "groceryRotation",
  done: "groceryRotation",
  complete: "groceryRotation",
  swap: "grocerySwap",
  skip: "grocerySwap",
  restock: "restock",
  supplies: "restock",
  low: "restock",
  "running low": "restock",
  invite: "invite",
  code: "invite",
  roommate: "invite",
  roommates: "invite",
  join: "join",
  signup: "account",
  account: "account",
  household: "setup",
  chores: "chores",
  chore: "chores",
  reminders: "reminders",
  profile: "profile",
  settings: "profile",
  password: "password",
  reset: "password",
  price: "plans",
  pricing: "plans",
  cost: "plans",
  free: "plans",
  premium: "plans",
  subscription: "plans",
  plans: "plans",
  upgrade: "upgrade",
  support: "contact",
  broken: "trouble",
  error: "trouble",
  help: "navigation",
  where: "navigation",
  safe: "security",
};
function shortTopic(q: string, previous?: string | null): string | undefined {
  const prompt = q
    .replace(
      /^(please |help (me )?(with )?|what about |how about |how (do i|to) |where (is|are) (my|the) )/,
      "",
    )
    .replace(/ please$/, "");
  if (
    [
      "how",
      "how do i",
      "where is it",
      "more",
      "details",
      "that",
      "it",
    ].includes(prompt) &&
    previous
  )
    return previous;
  if (
    ["cancel", "change it", "cancel it"].includes(prompt) &&
    previous &&
    ["plans", "upgrade", "cancel", "cancelData", "sharingPlan"].includes(
      previous,
    )
  )
    return prompt.startsWith("change") ? "upgrade" : "cancel";
  if (
    prompt === "cancel" &&
    previous &&
    ["groceryRotation", "grocerySwap"].includes(previous)
  )
    return "grocerySwap";
  if (
    ["edit", "delete", "change"].includes(prompt) &&
    previous &&
    ["split", "history", "edit"].includes(previous)
  )
    return "edit";
  if (shortSupport[prompt]) return shortSupport[prompt];
  // One missing/extra/wrong character in a single help keyword, only if unambiguous.
  if (!/^[a-z]{4,16}$/.test(prompt)) return undefined;
  const distance = (a: string, b: string) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(
          next[j - 1] + 1,
          row[j] + 1,
          row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      row = next;
    }
    return row[b.length];
  };
  const matches = [
    ...new Set(
      Object.keys(shortSupport)
        .filter((key) => !key.includes(" ") && distance(prompt, key) === 1)
        .map((key) => shortSupport[key]),
    ),
  ];
  return matches.length === 1 ? matches[0] : undefined;
}
export function answerSupport(
  question: string,
  previousTopic?: string | null,
): SupportReply {
  const q = normalize(question);
  // Specific matches override broad terms such as "subscription" or "balance".
  const priority = [
    "grocerySwap",
    "restock",
    "groceryRotation",
    "cancelData",
    "sharingPlan",
    "upgrade",
    "cancel",
    "recurring",
    "calculation",
    "uneven",
    "missing",
    "sync",
    "trouble",
    "buyer",
    "bought",
    "edit",
    "paid",
    "multiple",
    "leave",
    "password",
    "contact",
    "security",
    "invite",
    "join",
    "setup",
    "account",
    "chores",
    "reminders",
    "shopping",
    "history",
    "split",
    "balances",
    "profile",
    "plans",
    "about",
    "navigation",
  ];
  let topic = priority
    .map((id) => supportTopics.find((t) => t.id === id)!)
    .find((t) => t.patterns.some((p) => p.test(q)));
  const brief = shortTopic(q, previousTopic);
  if (brief) topic = supportTopics.find((t) => t.id === brief);
  const previous = supportTopics.find((t) => t.id === previousTopic);
  // Resolve explicit contextual follow-ups without guessing about unrelated questions.
  if (
    /^(and |but |so |what about |how about )?(can i |how (do|can) i )?(cancel|change|upgrade) (it|that|this)( please)?$/.test(
      q,
    ) &&
    previous &&
    ["plans", "upgrade", "cancel", "cancelData", "sharingPlan"].includes(
      previous.id,
    )
  ) {
    topic = supportTopics.find(
      (t) => t.id === (q.includes("cancel") ? "cancel" : "upgrade"),
    );
  } else if (
    /^(and |what about |how about )?(unevenly|unequally|custom|not equally)$/.test(
      q,
    ) &&
    previous &&
    ["split", "uneven"].includes(previous.id)
  ) {
    topic = supportTopics.find((t) => t.id === "uneven");
  } else if (
    /^(where (is|do i find) (it|that)|how do i do that|tell me more|what about on (mobile|desktop)|and on (mobile|desktop))$/.test(
      q,
    ) &&
    previous
  ) {
    topic = previous;
  }
  if (!topic)
    return {
      topic: previousTopic ?? null,
      text: "I’m not sure which feature you mean. Could you rephrase that with the screen or task, such as ‘split rent’ or ‘find my shopping list’? I can help with expenses, households, shopping, chores, subscription details, grocery turns, restocking and troubleshooting. I can explain steps, but cannot perform account or payment actions.",
      followUps: ["Find a Feature", "How do I contact support?"],
    };
  return {
    topic: topic.id,
    text: topic.answer,
    destination: topic.destination,
    followUps: topic.followUps,
  };
}
