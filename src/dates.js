// ISO 8601 week helpers. All dates are handled as UTC calendar days and
// exchanged as 'YYYY-MM-DD' strings, so time zones never shift a day.

const DAY_MS = 86400000;

export const DAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function toDateStr(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function fromDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function todayStr() {
  const n = new Date();
  return toDateStr(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
}

export function addDays(dateStr, n) {
  return toDateStr(new Date(fromDateStr(dateStr).getTime() + n * DAY_MS));
}

/** Monday of the ISO week that contains the given day. */
export function weekStartOf(dateStr) {
  const d = fromDateStr(dateStr);
  const dow = d.getUTCDay() || 7;
  return addDays(dateStr, 1 - dow);
}

/** ISO week number and ISO week-year of the given day. */
export function isoWeek(dateStr) {
  const d = fromDateStr(dateStr);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7),
  };
}

export function currentWeekStart() {
  return weekStartOf(todayStr());
}

export function shiftWeek(weekStart, delta) {
  return addDays(weekStart, delta * 7);
}

/** The seven days (Mon to Sun) of a week as date strings. */
export function weekDates(weekStart) {
  return DAY_IDS.map((_, i) => addDays(weekStart, i));
}

/** '2026-KW47' style key, as printed on reports. */
export function weekKey(weekStart) {
  const { year, week } = isoWeek(weekStart);
  return `${year}-KW${String(week).padStart(2, '0')}`;
}

export function fmtDE(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

export function weekRangeStr(weekStart) {
  return `${fmtDE(weekStart)} - ${fmtDE(addDays(weekStart, 6))}`;
}

export function currentMonthStr() {
  return todayStr().slice(0, 7);
}

/** All days of a 'YYYY-MM' month as date strings. */
export function monthDates(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= count; d++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

export function formatHoursHHMM(num) {
  const val = Number(num) || 0;
  let hrs = Math.floor(val);
  let mins = Math.round((val - hrs) * 60);
  if (mins === 60) {
    hrs += 1;
    mins = 0;
  }
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
