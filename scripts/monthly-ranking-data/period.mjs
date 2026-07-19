const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function jstYearMonth(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now).reduce((accumulator, part) => ({
    ...accumulator,
    [part.type]: part.value,
  }), {});
  return { year: Number(parts.year), month: Number(parts.month) };
}

function lastDayOfMonth(year, month) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

function period(year, month) {
  const paddedMonth = String(month).padStart(2, "0");
  const lastDay = lastDayOfMonth(year, month);
  return {
    month: `${String(year).padStart(4, "0")}-${paddedMonth}`,
    startDate: `${String(year).padStart(4, "0")}-${paddedMonth}-01`,
    endDate: `${String(year).padStart(4, "0")}-${paddedMonth}-${String(lastDay).padStart(2, "0")}`,
    timezone: "Asia/Tokyo",
  };
}

export function periodFromMonth(month, now = new Date()) {
  const match = typeof month === "string" ? MONTH.exec(month) : null;
  if (!match || match[1] === "0000") throw new Error("month must be a real YYYY-MM calendar month");
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const current = jstYearMonth(now);
  if (year > current.year || (year === current.year && monthNumber > current.month)) {
    throw new Error("month must not be in the future in Asia/Tokyo");
  }
  return period(year, monthNumber);
}

export function previousMonthPeriod(now = new Date()) {
  const { year, month } = jstYearMonth(now);
  const targetYear = month === 1 ? year - 1 : year;
  const targetMonth = month === 1 ? 12 : month - 1;
  return period(targetYear, targetMonth);
}
