export function previousMonthPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((accumulator, part) => ({
    ...accumulator,
    [part.type]: part.value,
  }), {});
  const year = Number(parts.year);
  const month = Number(parts.month);
  const targetYear = month === 1 ? year - 1 : year;
  const targetMonth = month === 1 ? 12 : month - 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const paddedMonth = String(targetMonth).padStart(2, "0");

  return {
    month: `${targetYear}-${paddedMonth}`,
    startDate: `${targetYear}-${paddedMonth}-01`,
    endDate: `${targetYear}-${paddedMonth}-${String(lastDay).padStart(2, "0")}`,
    timezone: "Asia/Tokyo",
  };
}
