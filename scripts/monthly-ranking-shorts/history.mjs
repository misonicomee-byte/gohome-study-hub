const CHANNELS = Object.freeze(["youtube", "blog", "instagram"]);
const CANDIDATES = Object.freeze([
  Object.freeze({ placement: "hook", motion: "cutout-zoom" }),
  Object.freeze({ placement: "chapter", motion: "split-reveal" }),
  Object.freeze({ placement: "hook", motion: "letter-scatter" }),
  Object.freeze({ placement: "chapter", motion: "cutout-zoom" }),
  Object.freeze({ placement: "none", motion: "split-reveal" }),
]);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertChannel(channel) {
  if (!CHANNELS.includes(channel)) throw new Error("invalid channel");
}

function assertMonth(month) {
  if (typeof month !== "string" || !MONTH.test(month) || month.startsWith("0000-")) {
    throw new Error("invalid month");
  }
}

function isCandidate(entry) {
  return CANDIDATES.some((candidate) => candidate.placement === entry.placement && candidate.motion === entry.motion);
}

export function validateHistory(history) {
  if (!Array.isArray(history)) throw new Error("history must be an array");
  const seen = new Set();
  for (const entry of history) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid history entry");
    assertChannel(entry.channel);
    assertMonth(entry.month);
    if (!isCandidate(entry)) throw new Error("unsupported style");
    const key = `${entry.channel}:${entry.month}`;
    if (seen.has(key)) throw new Error("duplicate channel month");
    seen.add(key);
  }
  return history;
}

function monthIndex(month) {
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value - 1;
}

export function recommendStyle(channel, month, history) {
  assertChannel(channel);
  assertMonth(month);
  validateHistory(history);
  const prior = history
    .filter((entry) => entry.channel === channel && entry.month < month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const channelOffset = CHANNELS.indexOf(channel) * 2;
  const start = (monthIndex(month) + channelOffset) % CANDIDATES.length;
  for (let offset = 0; offset < CANDIDATES.length; offset += 1) {
    const candidate = CANDIDATES[(start + offset) % CANDIDATES.length];
    if (!prior || candidate.placement !== prior.placement || candidate.motion !== prior.motion) {
      return { ...candidate };
    }
  }
  throw new Error("no style candidate available");
}

export function recordStyle(channel, month, placement, motion, history) {
  assertChannel(channel);
  assertMonth(month);
  validateHistory(history);
  const next = history.filter((entry) => !(entry.channel === channel && entry.month === month));
  const entry = { channel, month, placement, motion };
  if (!isCandidate(entry)) throw new Error("unsupported style");
  next.push(entry);
  const kept = new Set();
  for (const currentChannel of CHANNELS) {
    next.filter((item) => item.channel === currentChannel)
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 6)
      .forEach((item) => kept.add(`${item.channel}:${item.month}`));
  }
  return next.filter((item) => kept.has(`${item.channel}:${item.month}`))
    .sort((a, b) => a.channel.localeCompare(b.channel) || a.month.localeCompare(b.month));
}
