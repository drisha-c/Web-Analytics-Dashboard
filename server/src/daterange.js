const RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
// Inclusive [startDate, endDate] in UTC; returns half-open [from, to) plus the equal-length previous period.
function parseRange(q) {
  const end = RE.test(q.endDate) ? q.endDate : iso(new Date());
  const start = RE.test(q.startDate) ? q.startDate : addDays(end, -29);
  if (isNaN(Date.parse(start)) || isNaN(Date.parse(end)) || start > end) { const e = new Error('Invalid date range'); e.status = 400; throw e; }
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (days > 366) { const e = new Error('Date range cannot exceed 366 days'); e.status = 400; throw e; }
  return { from: start, to: addDays(end, 1), prevFrom: addDays(start, -days), prevTo: start, days };
}
module.exports = { parseRange, addDays };
