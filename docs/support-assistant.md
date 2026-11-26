# SplitMate Assistant in SplitCart

SplitMate Assistant is an integrated guide for the existing SplitCart app. It uses the same DM Sans/Fraunces fonts, green palette and shared text components. The app name and existing workflows are unchanged.

## Use and behavior

Select the round chat button at bottom right (above phone navigation). Type a question or select a quick question. The assistant gives steps, related questions and, where available, a **Go to …** button for the existing app section. Close with the X, Escape on web or the native back action. Reopening and changing sections retain the conversation.

Chat is local, deterministic and free of external API requirements. No chat is sent to a model or backend. It does not read household records, submit support tickets, change accounts or perform payments. A short typing indicator is a UI delay. It keeps the most recent 60 messages in memory; reloading or changing account/household clears them. Do not enter passwords, codes or financial details. The assistant also appears before login, with navigation shortcuts disabled until household setup is complete.

Answers distinguish normal demo, browser preview and live backend behavior. In particular, demo accounts/codes do not create cross-device sharing and demo payments/messages/autopay are simulations. Native device functionality was not added or changed.

## Maintain the content

Edit **src/supportKnowledge.ts**:

- `supportTopics`: each entry has a stable `id`, a canonical `question`, phrase-matching `patterns`, an `answer`, an optional existing-screen `destination`, and one or two `followUps`.
- `answerSupport`: ordered intent matching gives specific topics priority over general terms. Explicit short follow-ups use the previous topic (for example, “How do I cancel it?” after Subscription Plans). Unrecognized requests ask for clarification instead of guessing.
- `subscriptionInfo`: shared configured Basic/Plus/Premium prices and policies from `src/subscriptions.ts`. The assistant describes the one-time 30-day household trial, manager-only changes, shared coverage, scheduled changes, cancellation/history preservation and simulated failure/retry. Benefits are proposed and no existing features are restricted. Recurring roommate bills and the credit-card surcharge remain separate.
- `supportContact`: currently undefined; there is no invented email address or ticket service.

Before real billing or feature restrictions are introduced, update answers to match those separately approved implementations. Current subscription guidance must clearly identify simulated classroom billing and the absence of real payment credentials or charges.

When adding topics, put their IDs in the intent priority order, add real-user phrasing tests, and ensure suggested questions resolve. Destinations use a restricted type matching the seven existing app sections. This is an on-device support system, not a general-purpose generative assistant; unfamiliar phrasing may need a new pattern.

**src/SupportChat.tsx** owns the responsive chat UI, session, input, typing status and shortcuts. **App.tsx** mounts it per account/household and connects shortcuts to the existing tab state. Support remains a local guide; subscription actions run only through the separate subscription interface and scoped backend. See [household subscriptions](household-subscriptions.md).

## Validate and publish the demo

From the repository root:

```sh
npm run typecheck
npm test -- --maxWorkers=2
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
npm run build:web
npm run build:preview
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e:preview
```

Use your installed Chromium path, or omit the variable after `npx playwright install chromium`. The normal suite runs `e2e/support.spec.ts`; the self-contained preview suite runs `e2e/support-preview.spec.ts`. Both use shared browser scenarios from `e2e/supportFlows.ts`. Unit coverage in `src/supportKnowledge.test.ts` checks over 50 different questions, context, unsupported requests, subscription honesty and every suggested follow-up. Browser coverage checks phone/desktop sizing, open/close/reopen, typing, session continuity, navigation to all seven sections and continued purchase-editor operation. Preview coverage also checks pre-login help and account-change isolation.

For manual testing, run `npm run web`, or serve `preview/` with a static server after rebuilding. In the packaged demo choose **Open sample household**, open the assistant, and try:

1. “How do I split rent?” followed by “What about unevenly?”
2. “Subscription Plans” followed by “How do I cancel it?”
3. “Why can't I see my roommate's changes?”
4. “Find a Feature”, then each navigation shortcut.
5. Close/reopen, resize to phone and desktop, and verify the conversation remains.

Commit the rebuilt **preview/index.html** with the feature. The shared demo is generated; source changes alone do not update it. Fetch immediately before pushing, preserve teammates' changes, rerun affected checks after any integration, and never force-push.

Short help prompts and grocery guidance are also defined in `src/supportKnowledge.ts`. Edit `shortSupport` to add exact brief phrases; the assistant permits a one-character typo only when it leads unambiguously to one topic. Context resolves short follow-ups such as “how?” or “cancel” where the previous topic makes the meaning clear. Grocery, swap and restock answers link to the existing Grocery & Restock Rotation screen. See [the grocery feature guide](grocery-rotation.md).


The assistant also explains PDF/utility uploads, verified hashes versus suspected document matches, manual review, item categories and the spending pie chart. Sample PDF buttons and the sample-image loader are explicitly identified as known fixtures rather than OCR. See [document and spending implementation](documents-spending.md).
