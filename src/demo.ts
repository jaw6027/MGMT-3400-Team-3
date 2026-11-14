import { Data, equalSplit, today } from "./core";
export const DEMO_USER = "demo-alex";
const receiptSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="540" viewBox="0 0 380 540"><rect width="380" height="540" fill="#e9e6df"/><path d="M45 22H335V518L320 508 305 518 290 508 275 518 260 508 245 518 230 508 215 518 200 508 185 518 170 508 155 518 140 508 125 518 110 508 95 518 80 508 65 518 45 508Z" fill="#fffdf8"/><g fill="#373c36" font-family="monospace" font-size="14"><text x="190" y="70" text-anchor="middle" font-size="22">GREEN MARKET</text><text x="190" y="96" text-anchor="middle">Your neighborhood grocer</text><text x="70" y="145">SAMPLE RECEIPT · DEMO</text><text x="70" y="177">----------------------------</text><text x="70" y="216">Fresh produce       $24.50</text><text x="70" y="248">Pantry staples      $32.00</text><text x="70" y="280">Oat milk x 3        $12.00</text><text x="70" y="312">Bread &amp; eggs        $17.00</text><text x="70" y="351">----------------------------</text><text x="70" y="389" font-size="18">TOTAL             $85.50</text><text x="190" y="449" text-anchor="middle">A little good, every day.</text><text x="190" y="475" text-anchor="middle">Thank you!</text></g></svg>`;
export const demoReceipt =
  "data:image/svg+xml;utf8," + encodeURIComponent(receiptSvg);
export function demoData(): Data {
  const members = [
    { id: "alex", user_id: DEMO_USER, name: "Alex Morgan" },
    { id: "jordan", user_id: "demo-jordan", name: "Jordan Lee" },
    { id: "sam", user_id: "demo-sam", name: "Sam Rivera" },
    { id: "riley", user_id: "demo-riley", name: "Riley Chen" },
  ];
  const ago = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const purchases = [
    ["Weekly grocery run", 8550, "alex", "Groceries", "Green Market", 0],
    ["Keeping things clean", 2499, "jordan", "Household", "Target", 1],
    ["Internet, sorted", 6000, "alex", "Utilities", "Google Fiber", 2],
    ["Friday pizza night", 4800, "sam", "Food & drinks", "Little Italy", 3],
    ["The coffee essentials", 3275, "riley", "Groceries", "Trader Joe’s", 4],
    ["A little greener", 1890, "alex", "Household", "The Sill", 6],
  ] as const;
  return {
    household: {
      id: "demo-house",
      name: "The Green House",
      currency: "USD",
      invite_code: "DEMO-GREEN",
    },
    members,
    expenses: purchases.map(
      ([name, cents, paid_by, category, store, n], i) => ({
        id: `demo-${i}`,
        household_id: "demo-house",
        name,
        cents,
        date: ago(n),
        paid_by,
        category,
        store,
        notes:
          i === 0
            ? "The essentials for a good week. Receipt attached so everyone can check in."
            : "",
        receipt: i === 0 ? demoReceipt : null,
        shares: equalSplit(
          cents,
          members.map((m) => m.id),
        ),
        created_at: ago(n) + "T12:00:00Z",
      }),
    ),
    repayments: [
      {
        id: "demo-repay",
        household_id: "demo-house",
        from_id: "jordan",
        to_id: "alex",
        cents: 1500,
        date: today(),
        recorded_by: DEMO_USER,
      },
    ],
  };
}
