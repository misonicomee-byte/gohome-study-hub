import { validateManifest } from "../monthly-ranking-data/schema.mjs";

const CHANNEL_LABELS = Object.freeze({
  youtube: "YouTube Shorts",
  blog: "ブログ",
  instagram: "Instagram",
  podcast: "ポッドキャスト",
});

const CHANNEL_TAGS = Object.freeze({
  youtube: "#YouTubeShorts",
  blog: "#クリニックブログ",
  instagram: "#Instagram",
  podcast: "#ポッドキャスト",
});

function japaneseMonth(month) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || match[1] === "0000") throw new Error("invalid manifest month");
  return `${Number(match[1])}年${Number(match[2])}月`;
}

const CONTROL = /[\u0000-\u001f\u007f]/u;
const MEDICAL_CLAIM = /治る|治ります|完治|絶対|最高の医療|治療効果|(?:改善|予防)(?:する|します|できる|できます)|効果(?:が)?(?:ある|あります)/u;

function safeText(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || CONTROL.test(value)) {
    throw new Error(`${name} contains unsafe text`);
  }
  if (MEDICAL_CLAIM.test(value)) throw new Error(`${name} contains an unsupported claim`);
  return value;
}

function safeHttpsUrl(value, name) {
  safeText(value, name);
  const parsed = new URL(value);
  if (/\s/u.test(value) || parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error(`${name} must be a public HTTPS URL`);
  }
  return value;
}

function validateFallbackMetadata(manifest) {
  const usesFallbackMode = manifest.rankingMode === "initialPublishedMonthCurrentViews";
  const usesFallbackMetric = manifest.rankingMetric === "currentViewsOfPostsPublishedInMonth";
  if (usesFallbackMode !== usesFallbackMetric || (usesFallbackMode && manifest.channel !== "instagram")) {
    throw new Error("invalid Instagram fallback metadata");
  }
}

function localizedRankingLabel(manifest, month) {
  if (manifest.rankingMode === "initialPublishedMonthCurrentViews") {
    return `${month}公開投稿の現在の閲覧数（初回限定・月内の増加数ではありません）`;
  }
  const label = safeText(manifest.rankingLabel, "rankingLabel");
  return label.replaceAll(manifest.period.month, month);
}

function descriptionLead(manifest, month, channelLabel) {
  if (manifest.rankingMode === "initialPublishedMonthCurrentViews") {
    return `${month}に公開された${channelLabel}投稿を、現在の閲覧数で集計したTOP3です。初回限定の集計で、${month}中の増加数ではありません。`;
  }
  return `${month}に多く見られた${channelLabel}コンテンツTOP3をご紹介します。`;
}

function narrationTitle(value, maxLength = 24) {
  const withoutEpisodeNumber = value.replace(/^\s*\d{1,4}\s*/u, "").trim();
  const firstClause = withoutEpisodeNumber.split(/[:：?？|｜]/u)[0].trim();
  const candidate = firstClause.length >= 6 ? firstClause : withoutEpisodeNumber;
  if (candidate.length <= maxLength) return candidate;
  return `${candidate.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildCopy(manifest) {
  validateManifest(manifest);
  if (!Object.hasOwn(CHANNEL_LABELS, manifest.channel)) throw new Error("invalid manifest copy input");
  validateFallbackMetadata(manifest);
  const month = japaneseMonth(manifest.period?.month);
  const items = manifest.items;
  const rankingLabel = localizedRankingLabel(manifest, month);
  for (const item of items) {
    safeText(item.title, `rank ${item.rank} title`);
    safeHttpsUrl(item.url, `rank ${item.rank} URL`);
    if (item.metricValue < 0) throw new Error(`rank ${item.rank} metric must be non-negative`);
  }
  const ordered = [...items].sort((a, b) => b.rank - a.rank);
  const isPodcast = manifest.channel === "podcast";
  const lines = [isPodcast
    ? `${month}のポッドキャスト、前月増加再生数トップ3。集計はYouTube Analytics・太平洋時間です。`
    : `${month}の${CHANNEL_LABELS[manifest.channel]}人気コンテンツ、トップ3をご紹介します。`];
  for (const item of ordered) {
    lines.push(isPodcast
      ? `第${item.rank}位、${narrationTitle(item.title)}。前月は${item.metricValue.toLocaleString("ja-JP")}回再生されました。`
      : `第${item.rank}位、${item.title}。${rankingLabel}は${item.metricValue.toLocaleString("ja-JP")}でした。`);
  }
  lines.push("気になる内容は、ごうホームクリニック公式チャンネルとサイトからご覧ください。");
  const title = isPodcast
    ? `【${month}】Podcast 前月増加再生数TOP3`
    : `【${month}】${CHANNEL_LABELS[manifest.channel]} 人気コンテンツTOP3`;
  const rankingLines = items.map((item) => `${item.rank}位 ${item.title}\n${item.url}`).join("\n\n");
  const description = [
    isPodcast
      ? `${month}のポッドキャスト前月増加再生数TOP3をご紹介します。集計はYouTube Analytics・太平洋時間です。`
      : descriptionLead(manifest, month, CHANNEL_LABELS[manifest.channel]),
    `集計指標：${rankingLabel}`,
    rankingLines,
    "ごうホームクリニック\nhttps://gohome-clinic.com/",
    "※本動画はAIを活用して制作しています。掲載情報は公式情報をご確認ください。",
    isPodcast
      ? `#ごうホームクリニック #訪問診療 #在宅医療 #前月増加再生数 ${CHANNEL_TAGS[manifest.channel]}`
      : `#ごうホームクリニック #訪問診療 #在宅医療 #人気コンテンツ ${CHANNEL_TAGS[manifest.channel]}`,
  ].join("\n\n");
  return {
    narration: lines.join("\n"),
    captions: lines.map((text, index) => ({ id: index + 1, rank: index >= 1 && index <= 3 ? ordered[index - 1].rank : null, text })),
    postTitle: title,
    postDescription: description,
    postCaption: `■タイトル\n${title}\n\n■説明文\n${description}\n`,
  };
}
