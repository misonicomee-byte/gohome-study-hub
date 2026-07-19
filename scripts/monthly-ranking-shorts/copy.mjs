const CHANNEL_LABELS = Object.freeze({
  youtube: "YouTube Shorts",
  blog: "ブログ",
  instagram: "Instagram",
});

const CHANNEL_TAGS = Object.freeze({
  youtube: "#YouTubeShorts",
  blog: "#クリニックブログ",
  instagram: "#Instagram",
});

function japaneseMonth(month) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || match[1] === "0000") throw new Error("invalid manifest month");
  return `${Number(match[1])}年${Number(match[2])}月`;
}

function validatedItems(items) {
  if (!Array.isArray(items) || items.length !== 3 || items.some((item, index) => item?.rank !== index + 1)) {
    throw new Error("manifest must contain exact TOP3");
  }
  for (const item of items) {
    if (typeof item.title !== "string" || !item.title.trim() ||
        !Number.isFinite(item.metricValue) || typeof item.url !== "string" || !item.url.startsWith("https://")) {
      throw new Error(`invalid rank ${item.rank}`);
    }
  }
  return items;
}

export function buildCopy(manifest) {
  if (!manifest || !CHANNEL_LABELS[manifest.channel] || typeof manifest.rankingLabel !== "string") {
    throw new Error("invalid manifest copy input");
  }
  const month = japaneseMonth(manifest.period?.month);
  const items = validatedItems(manifest.items);
  const ordered = [...items].sort((a, b) => b.rank - a.rank);
  const lines = [`${month}の${CHANNEL_LABELS[manifest.channel]}人気コンテンツ、トップ3をご紹介します。`];
  for (const item of ordered) {
    lines.push(`第${item.rank}位、${item.title}。${manifest.rankingLabel}は${item.metricValue.toLocaleString("ja-JP")}でした。`);
  }
  lines.push("気になる内容は、ごうホームクリニック公式チャンネルとサイトからご覧ください。");
  const title = `【${month}】${CHANNEL_LABELS[manifest.channel]} 人気コンテンツTOP3`;
  const rankingLines = items.map((item) => `${item.rank}位 ${item.title}\n${item.url}`).join("\n\n");
  const description = [
    `${month}に多く見られた${CHANNEL_LABELS[manifest.channel]}コンテンツTOP3をご紹介します。`,
    `集計指標：${manifest.rankingLabel}`,
    rankingLines,
    "ごうホームクリニック\nhttps://gohome-clinic.com/",
    "※本動画はAIを活用して制作しています。掲載情報は公式情報をご確認ください。",
    `#ごうホームクリニック #訪問診療 #在宅医療 #人気コンテンツ ${CHANNEL_TAGS[manifest.channel]}`,
  ].join("\n\n");
  return {
    narration: lines.join("\n"),
    captions: lines.map((text, index) => ({ id: index + 1, rank: index >= 1 && index <= 3 ? ordered[index - 1].rank : null, text })),
    postTitle: title,
    postDescription: description,
    postCaption: `■タイトル\n${title}\n\n■説明文\n${description}\n`,
  };
}
