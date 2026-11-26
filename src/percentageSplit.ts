/** Convert percentage allocations into exact cent amounts without losing pennies. */
export function percentageSplit(totalCents: number, entries: {member_id: string; percentage: string}[]) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error("Enter a valid expense amount.");
  if (!entries.length) throw new Error("Select at least one roommate.");
  const values = entries.map(({member_id, percentage}) => {
    const value = percentage.trim();
    if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid percentage for each roommate.");
    const basisPoints = Math.round(Number(value) * 100);
    if (basisPoints < 0 || basisPoints > 10000) throw new Error("Percentages must be between 0 and 100.");
    return {member_id, basisPoints};
  });
  if (values.reduce((sum, v) => sum + v.basisPoints, 0) !== 10000) throw new Error("Roommate percentages must total exactly 100%.");
  const result = values.map((v, index) => {
    const numerator = totalCents * v.basisPoints;
    return {...v, index, cents: Math.floor(numerator / 10000), remainder: numerator % 10000};
  });
  let remaining = totalCents - result.reduce((sum, v) => sum + v.cents, 0);
  const order = [...result].sort((a,b) => b.remainder - a.remainder || a.index - b.index);
  for (let i=0; i<remaining; i++) order[i].cents++;
  return result.map(({member_id,cents}) => ({member_id,cents}));
}
