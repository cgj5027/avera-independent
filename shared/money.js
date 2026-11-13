/** Shared, finite currency rounding. */
export const round2 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON * Math.abs(n)) * 100) / 100;
};
