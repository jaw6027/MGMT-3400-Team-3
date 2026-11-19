# Grocery & Restock Rotation

Open **Grocery & Restock Rotation** in the sidebar or **Rotation** on the phone navigation. The Overview dashboard also has **Who's up next?**. Existing shopping, chores, accounts, payments and purchase flows remain in place.

## Demonstrate the feature

The existing demo has Alex, Jordan, Sam and Riley. No new sample accounts or paid services are needed.

1. Choose **Open sample household** in the packaged browser demo. Open Rotation → **Create grocery rotation**.
2. Choose the participating roommates in turn order (three are initially selected). Select Weekly, Every two weeks, or Custom schedule; custom intervals accept 1–365 days. Set the first turn date and save.
3. **Who's up next?** shows the current shopper, My Turn badge, next person and a four-turn schedule. Dates use UTC. Future turns cannot be completed early.
4. Under Household essentials, edit Toilet Paper to enter a remaining quantity and a preferred-brand/quantity note. Choose **Running Low**. Any active roommate can report a low item.
5. Open **shared shopping list**. The existing list now has the essential, its responsible shopper and note. Repeated low reports reuse the same active plan, including an already-planned matching catalog item.
6. As the assigned restocker, choose **Mark as Purchased** and enter the actual payer, total and shares in the existing purchase form. Saving records the expense, clears Running Low, resets the unverified remaining quantity to blank, and records the purchase date. It does not send money or complete the grocery trip.
7. In Rotation, choose **Mark turn complete** and confirm. The queue advances, completion history is saved, and the next due date is the later of the old due date and actual completion date, plus the selected interval.
8. In the completed trip's history, choose **Record shared grocery expense**. For example, enter $90 and select three roommates for three $30 shares. Shopping responsibility does not determine the payer or financial shares. **Record each receipt only once**: do not also record a trip total covering supplies already logged as separate purchases.
9. To demonstrate a swap, start from a household whose current turn is Alex's. Alex chooses **Swap Turn**, picks Jordan, and requests a swap. No assignment changes yet. In Household, choose **Switch preview account**, then log in as `jordan@splitcart.demo` using the documented sample password `splitcart-demo`. Open Rotation and choose **Accept turn swap**. Only Jordan can accept/decline that request; Alex can cancel it. Acceptance exchanges their queue positions.
10. The current shopper can instead choose **Skip my turn** and confirm. They move to the back; the next roommate inherits the same due date. A skip does not count as a completed trip. Completed turns, skips and schedule edits expire pending swaps.
11. Refresh the page to confirm persistence. Review **Sharing the responsibility**, **Household reminders**, and **Grocery & restock history**.

The plain Expo demo runs as Alex only. Use the packaged preview's separate sample logins to demonstrate agreement; it does not pretend Alex is Jordan. Resetting demo data removes the demo rotation along with the other sample data.

## Restock options

**Option A: Grocery Rotation** assigns every low item to the current grocery shopper. Completing/skipping a trip or accepting a swap also updates low-item shopping assignments.

**Option B: Separate Restock Rotation** lets the household choose its own restock participants, interval and start date. Each essential starts at a successive participant, wrapping through the list. Every full interval from the start date, all responsibilities advance by one participant. This is date-based and independent of trip completion and purchases. New items join at the next item position. Refresh the list if its assignment is stale; the purchase operation checks the current responsible person again.

Eight essentials are provided: toilet paper, paper towels, dish soap, laundry detergent, trash bags, cleaning supplies, hand soap and shared food items. **Add custom essential** supports other supplies using the existing shopping categories. Quantity is optional descriptive text; the app does not estimate consumption. Edit details updates the quantity/note and the associated pending plan. Grocery/restock history is preserved when schedules change. Deleted linked purchase records reopen the associated essential as Running Low so the list and ledger stay consistent.

Only the assigned restocker can record a linked restock purchase. Other household shopping items keep their existing permissions. The actual payer and people sharing the bill are chosen separately. Existing payer-only edit/delete permissions remain intact. A trip can have multiple different expense records, but the same receipt should never be counted twice.

## Storage, sharing and reminders

- **Normal demo:** reuses `splitcart-demo-v1` local storage/AsyncStorage. Grocery and associated shopping/expense operations serialize within the app. Web Locks coordinate same-browser tabs when supported. This remains a single-account local demo, not a secure shared service.
- **Browser preview:** reuses `splitcart-browser-preview-v1`, with grocery state keyed by household. Separate preview logins see the same browser's household state. Preview requests serialize; Web Locks also coordinate tabs where available. It does not synchronize across browsers/devices, authenticate real people or send payments/messages. Without Web Locks, use one tab to avoid cross-tab write races. Clearing browser storage or Reset demo removes local data.
- **Live mode:** uses one protected `grocery_states` document per household. All supported writes lock the household row and check the expected version. Request IDs make retries idempotent. Swaps validate the authenticated requester/recipient and the current turn. SQL access rules isolate households and reject direct/anonymous writes. Expense/restock updates commit in the same transaction. The history document is suitable for the class project; a larger deployment should paginate/archive long-running activity rather than loading unlimited household history.
- **Reminders:** visible in-app reminders show current/next turns, low essentials, recent trip completions and swap requests. They are derived from the saved schedule/history and refreshed while viewing the app. They do not use the payment notification providers, and do not send grocery push notifications, SMS or email in demo or live mode. Scheduled dates are plans, not background shopping or payments.
- **Membership changes:** departed roommates are filtered from active queues and retain historical completion credit. Edit the schedule to add newcomers or repair a rotation with no active participants. Schedule edits preserve surviving grocery participants' queue order and append newcomers; they do not erase history.

## Deploy and maintain

For an existing live Supabase project, apply **`supabase/migrations/202611190007_grocery_rotation.sql` once after all earlier migrations, before deploying the updated app**. It adds household-isolated state and an optional `expenses.grocery_trip_id`, and wraps existing purchase/shopping RPCs while retaining their validations. There are no new secrets or paid APIs. Live hosting, multi-device and provider integrations still require your own configured project; local database tests use actual migrations/RLS through PGlite.

Key files:

- `src/grocery.ts`: types, rotation/date calculations, local-demo state transitions, assignment and purchase guards, local write serialization.
- `src/GroceryRotation.tsx`: screen, Who's up next cards, schedule/essential forms, swap agreement, reminders, fairness and history.
- `src/store.tsx`, `src/browserPreview.ts`, `src/backend.ts`: existing persistence and live RPC integration.
- `src/ShoppingList.tsx`, `App.tsx`, `src/core.ts`: existing shopping/expense/navigation integration.
- `src/supportKnowledge.ts`: shorter help aliases, limited unambiguous one-character typo matching and grocery/restock/swap guidance. Ambiguous requests such as "cancel" ask for clarification unless there is relevant conversation context. No chatbot response performs a user action.

Validation commands from the repository root:

```sh
npm run typecheck
npm test -- --maxWorkers=2
npm run test:db
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e:households
npm run build:web -- --clear
npm run build:preview
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e:preview
```

Use your system Chromium path, or install Playwright's Chromium and omit the variable. Grocery unit/SQL tests cover rotation arithmetic, permissions, duplicates, stale versions, agreement, departure, household isolation and expense integration. Shared browser scenarios run on phone and desktop in both app and packaged demo, and preview accounts exercise real two-sided agreement. Rebuild and commit `preview/index.html` whenever source changes so the shared demo includes the feature.
