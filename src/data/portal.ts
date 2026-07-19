/**
 * 広報ポータル用データ取得モジュール
 * - Blog: WordPress REST API（build時）
 * - Instagram: GAS JSON API（build時、要：deployment public access）
 *
 * fetch失敗時は空配列を返す（ビルドは止めない）
 */

import { YOUTUBE_SHORTS, type YouTubeShort } from "./youtubeShorts";

export interface BlogPost {
  id: number | string;
  title: string;
  link: string;
  date: string;
  excerpt: string;
  thumbnail: string | null;
  categories: number[];
  tags: number[];
  pageViews?: number;
  totalUsers?: number;
}

export interface PodcastEpisode {
  id: string;
  title: string;
  date: string;
  url: string;
  youtubeId: string;
  genres: string[];
  number: number | null; // タイトル先頭の番号（例: "176水分制限..." → 176）
}

export interface InstagramPost {
  id: string;
  permalink: string;
  caption: string;
  media_type: string;
  media_url: string;
  thumbnail_url: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
  reach: number;
  total_interactions: number;
  saved: number;
  shares: number;
}

// blog 一覧は GAS Web App (?api=blog-ranking) 経由で GA4 から取得する
// （旧経路: XServer WAFがGitHub Actionsの米国IPを403で遮断するため、
//  日本国内NAS 共有スプレッドシート → GAS の構成だったが、現在は GA4 ベース）。
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbzSApigqDvEX1Kngc5sHEfm7WdXpJxu2vcHXx6ynGGJ2mgToc1Vh0K0D02gI51HrICR/exec";

const FETCH_OPTS: RequestInit = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://gohome-clinic.com/",
  },
};

/**
 * 最新blog n件を取得（含アイキャッチ画像）
 */
/**
 * GAS Web App から GA4 経由で blog 記事一覧を取得（PV/UU・公開日付き）
 * gohome-clinic.com の /YYYY/MM/DD/ パターンURLが対象
 */
let _blogCache: BlogPost[] | null = null;
let _blogCachePromise: Promise<BlogPost[]> | null = null;

export function rollingBlogDateRange(now = new Date()) {
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const endDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const start = new Date(0);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCFullYear(
    Number(dateParts.year),
    Number(dateParts.month) - 1,
    Number(dateParts.day),
  );
  start.setUTCDate(start.getUTCDate() - 179);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

async function fetchBlogFromGAS(): Promise<BlogPost[]> {
  if (_blogCache) return _blogCache;
  if (_blogCachePromise) return _blogCachePromise;
  _blogCachePromise = (async () => {
    try {
      const { startDate, endDate } = rollingBlogDateRange();
      const url = new URL(GAS_URL);
      url.search = new URLSearchParams({
        api: "blog-ranking",
        startDate,
        endDate,
        limit: "100",
      });
      let json: any = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await fetch(url, FETCH_OPTS);
        if (!res.ok) {
          console.warn(`[portal] blog GAS fetch failed: status=${res.status}`);
          return [];
        }
        const text = await res.text();
        if (text.startsWith("<!") || text.startsWith("<html")) {
          console.warn(
            "[portal] blog GAS returned HTML (deployment may require auth)",
          );
          return [];
        }
        json = JSON.parse(text);
        if (!json.error) break;
        const retryable = json.errorCode === "UPSTREAM_UNAVAILABLE";
        if (!retryable || attempt === 2) {
          console.warn("[portal] blog GAS error:", json.error);
          return [];
        }
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2_000));
      }
      const data = json.data ?? [];
      console.log(`[portal] blog from GAS OK: ${data.length} posts`);
      _blogCache = data.map((p: any) => ({
        id: p.url, // GA4ベースのため数値IDなし、URLをIDとして利用
        title: String(p.title ?? ""),
        link: String(p.url ?? ""),
        date: String(p.date ?? ""),
        excerpt: "",
        thumbnail: null,
        categories: [],
        tags: [],
        pageViews: Number(p.pageViews ?? 0),
        totalUsers: Number(p.totalUsers ?? 0),
      })) as BlogPost[];
      return _blogCache;
    } catch (err) {
      console.warn("[portal] blog GAS fetch failed:", err);
      return [];
    }
  })();
  try {
    return await _blogCachePromise;
  } finally {
    if (!_blogCache) _blogCachePromise = null;
  }
}

export async function fetchLatestBlogPosts(limit = 6): Promise<BlogPost[]> {
  const all = await fetchBlogFromGAS();
  return [...all]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, limit);
}

/**
 * 直近のInstagram投稿 n件をinsights付きで取得
 * GAS deployment が public access になっていない場合はHTMLが返るので空配列を返す
 */
export async function fetchInstagramPosts(
  limit = 30,
): Promise<InstagramPost[]> {
  try {
    const url = `${GAS_URL}?api=instagram-posts&limit=${limit}`;
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) return [];
    const text = await res.text();
    if (text.startsWith("<!") || text.startsWith("<html")) {
      console.warn(
        "[portal] Instagram API returned HTML (deployment may require auth — set webapp access to 'Anyone' in GAS UI)",
      );
      return [];
    }
    const json = JSON.parse(text);
    if (json.error) {
      console.warn("[portal] Instagram API error:", json.error);
      return [];
    }
    return json.data ?? [];
  } catch (err) {
    console.warn("[portal] Instagram fetch failed:", err);
    return [];
  }
}

/**
 * 人気blog — GA4 page views 降順
 */
export async function fetchPopularBlogPosts(limit = 6): Promise<BlogPost[]> {
  const all = await fetchBlogFromGAS();
  return [...all]
    .sort((a: any, b: any) => (b.pageViews ?? 0) - (a.pageViews ?? 0))
    .slice(0, limit);
}

/**
 * 人気Instagram投稿 — like_count降順
 */
export function rankByLikes(
  posts: InstagramPost[],
  limit = 6,
): InstagramPost[] {
  return [...posts].sort((a, b) => b.like_count - a.like_count).slice(0, limit);
}

/**
 * 人気Instagram投稿 — エンゲージメント率（like+comment+saved）/ reach 降順
 */
export function rankByEngagementRate(
  posts: InstagramPost[],
  limit = 6,
): InstagramPost[] {
  return [...posts]
    .map((p) => ({
      ...p,
      _er:
        p.reach > 0
          ? (p.like_count + p.comments_count + p.saved + p.shares) / p.reach
          : 0,
    }))
    .sort((a: any, b: any) => b._er - a._er)
    .slice(0, limit);
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8230;/g, "…")
    .replace(/&#8217;/g, "’")
    .replace(/&#8211;/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Podcast一覧をGAS経由で取得し、タイトルからジャンルを自動分類
 */
const GENRE_KEYWORDS: Array<{ name: string; patterns: RegExp[] }> = [
  {
    name: "嚥下・栄養",
    patterns: [
      /嚥下|食[べ事]|栄養|食欲|低栄養|フレイル|サルコペニア|管理栄養士|食形態/,
      /【嚥下/,
      /【栄養/,
    ],
  },
  {
    name: "感染症",
    patterns: [/感染|尿路|肺炎|発熱|抗菌薬|耐性菌|敗血症|消毒|清潔/],
  },
  { name: "皮膚・褥瘡", patterns: [/皮膚|褥瘡|スキン|湿疹|皮膚科|肌|傷|創/] },
  {
    name: "排泄ケア",
    patterns: [/排尿|排便|尿|便|失禁|オムツ|カテーテル|トイレ|膀胱|便秘|下痢/],
  },
  { name: "認知症", patterns: [/認知症|BPSD|物忘れ|徘徊|せん妄|MCI/] },
  {
    name: "メンタル",
    patterns: [/うつ|心の|精神|不安|気持ち|心理|孤独|ストレス|傾聴/],
  },
  {
    name: "看取り・ACP",
    patterns: [/看取り|終末|ACP|人生会議|延命|意思決定|尊厳|最期|臨終|死/],
  },
  {
    name: "糖尿病・生活習慣",
    patterns: [/糖尿|血糖|HbA1c|インスリン|高血圧|脂質|肥満|フット/],
  },
  {
    name: "心疾患・呼吸器",
    patterns: [/心不全|心疾患|不整脈|呼吸|COPD|喘息|肺|心臓/],
  },
  { name: "点滴・輸液", patterns: [/点滴|輸液|皮下|脱水|補液|【点滴/] },
  {
    name: "薬剤管理",
    patterns: [/服薬|薬剤|処方|薬|残薬|副作用|相互作用|薬剤師/],
  },
  {
    name: "多職種連携",
    patterns: [
      /連携|多職種|チーム|ケアマネ|訪問看護|薬剤師|理学療法|作業療法|歯科|地域包括/,
    ],
  },
  {
    name: "家族介護",
    patterns: [
      /家族|介護者|介護負担|レスパイト|介護家族|ヤングケアラー|遠距離介護|独居/,
    ],
  },
  {
    name: "制度・算定",
    patterns: [/算定|改定|加算|診療報酬|介護報酬|施設基準|【2026/],
  },
  { name: "特集", patterns: [/^【.+特集】/] },
];

function detectGenres(title: string): string[] {
  const matched: string[] = [];
  for (const g of GENRE_KEYWORDS) {
    if (g.patterns.some((p) => p.test(title))) matched.push(g.name);
  }
  return matched.length > 0 ? matched : ["その他"];
}

function extractNumber(title: string): number | null {
  const m = title.match(/^(\d{1,4})/);
  return m ? parseInt(m[1], 10) : null;
}

let _podcastCache: PodcastEpisode[] | null = null;
export async function fetchPodcastList(): Promise<PodcastEpisode[]> {
  if (_podcastCache) return _podcastCache;
  try {
    const url = `${GAS_URL}?api=podcast-list`;
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) return [];
    const text = await res.text();
    if (text.startsWith("<!") || text.startsWith("<html")) {
      console.warn("[portal] podcast GAS returned HTML — auth needed");
      return [];
    }
    const json = JSON.parse(text);
    if (json.error) {
      console.warn("[portal] podcast GAS error:", json.error);
      return [];
    }
    const arr = json.data ?? [];
    _podcastCache = arr.map((p: any) => ({
      id: String(p.id || p.youtubeId || ""),
      title: String(p.title || ""),
      date: String(p.date || ""),
      url: String(p.url || ""),
      youtubeId: String(p.youtubeId || p.id || ""),
      genres: detectGenres(String(p.title || "")),
      number: extractNumber(String(p.title || "")),
    })) as PodcastEpisode[];
    console.log(
      `[portal] podcast from GAS OK: ${_podcastCache?.length} episodes`,
    );
    return _podcastCache!;
  } catch (err) {
    console.warn("[portal] podcast fetch failed:", err);
    return [];
  }
}

export function getPodcastGenres(
  eps: PodcastEpisode[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const ep of eps) {
    for (const g of ep.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * WEB勉強会動画の視聴回数を YouTube Data API v3 から取得（build時）
 * APIキーは env: YOUTUBE_API_KEY。未設定・失敗時は空Mapを返す（ビルドは止めない）。
 * 返り値: youtubeId -> viewCount のMap
 */
export async function fetchLectureViewCounts(
  youtubeIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const apiKey =
    import.meta.env.YOUTUBE_API_KEY ?? process.env.YOUTUBE_API_KEY ?? "";
  if (!apiKey) {
    console.warn(
      "[portal] YOUTUBE_API_KEY 未設定 — WEB勉強会ランキングをスキップ",
    );
    return result;
  }
  const ids = youtubeIds.filter(Boolean);
  if (ids.length === 0) return result;
  try {
    // YouTube Data API は1リクエスト最大50件。現状は十分に収まる。
    const url =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=statistics&id=${ids.join(",")}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[portal] YouTube API fetch failed: status=${res.status}`);
      return result;
    }
    const json = await res.json();
    if (json.error) {
      console.warn(
        "[portal] YouTube API error:",
        json.error?.message ?? json.error,
      );
      return result;
    }
    for (const item of json.items ?? []) {
      const id = String(item.id ?? "");
      const views = Number(item.statistics?.viewCount ?? 0);
      if (id) result.set(id, views);
    }
    console.log(`[portal] YouTube views OK: ${result.size} videos`);
    return result;
  } catch (err) {
    console.warn("[portal] YouTube API fetch failed:", err);
    return result;
  }
}

const YOUTUBE_CHANNEL_ID = "UCJ2B_z_pz0R_yTZkRbSl4Lg";
const YOUTUBE_UPLOADS_PLAYLIST_ID = `UU${YOUTUBE_CHANNEL_ID.slice(2)}`;

function parseIsoDurationSeconds(value: string): number {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return Number.POSITIVE_INFINITY;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * チャンネルの最新アップロードから公開Shortsを抽出し、総再生回数順で返す。
 * YouTube Data APIにはShorts専用フラグがないため、現在のShorts上限に合わせて
 * 3分以内の公開動画を対象とする。毎朝のGitHub Actionsビルドで再取得される。
 */
export async function fetchPopularYouTubeShorts(
  limit = 5,
): Promise<YouTubeShort[]> {
  const apiKey =
    import.meta.env.YOUTUBE_API_KEY ?? process.env.YOUTUBE_API_KEY ?? "";
  const fallback = () =>
    [...YOUTUBE_SHORTS]
      .sort((a, b) => b.fallbackViews - a.fallbackViews)
      .slice(0, limit);

  if (!apiKey) {
    console.warn(
      "[portal] YOUTUBE_API_KEY 未設定 — Shortsランキングは確認済みデータを使用",
    );
    return fallback();
  }

  try {
    const ids: string[] = [];
    let pageToken = "";
    do {
      const playlistUrl =
        `https://www.googleapis.com/youtube/v3/playlistItems` +
        `?part=contentDetails&playlistId=${YOUTUBE_UPLOADS_PLAYLIST_ID}` +
        `&maxResults=50&key=${apiKey}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const playlistRes = await fetch(playlistUrl);
      if (!playlistRes.ok) {
        console.warn(
          `[portal] YouTube uploads fetch failed: status=${playlistRes.status}`,
        );
        return fallback();
      }
      const playlistJson = await playlistRes.json();
      ids.push(
        ...(playlistJson.items ?? [])
          .map((item: any) => String(item.contentDetails?.videoId ?? ""))
          .filter(Boolean),
      );
      pageToken = String(playlistJson.nextPageToken ?? "");
    } while (pageToken && ids.length < 500);

    if (ids.length === 0) return fallback();

    const idBatches = Array.from(
      { length: Math.ceil(ids.length / 50) },
      (_, index) => ids.slice(index * 50, index * 50 + 50),
    );
    const videoResponses = await Promise.all(
      idBatches.map(async (batch) => {
        const videosUrl =
          `https://www.googleapis.com/youtube/v3/videos` +
          `?part=snippet,contentDetails,statistics,status&id=${batch.join(",")}` +
          `&key=${apiKey}`;
        const response = await fetch(videosUrl);
        if (!response.ok) {
          throw new Error(`YouTube Shorts details status=${response.status}`);
        }
        return response.json();
      }),
    );
    const shorts = videoResponses
      .flatMap((json: any) => json.items ?? [])
      .map((item: any) => {
        const seconds = parseIsoDurationSeconds(
          String(item.contentDetails?.duration ?? ""),
        );
        return {
          youtubeId: String(item.id ?? ""),
          title: String(item.snippet?.title ?? ""),
          publishedAt: String(item.snippet?.publishedAt ?? "").slice(0, 10),
          duration: formatDuration(seconds),
          fallbackViews: Number(item.statistics?.viewCount ?? 0),
          seconds,
          privacyStatus: String(item.status?.privacyStatus ?? ""),
          liveBroadcastContent: String(
            item.snippet?.liveBroadcastContent ?? "none",
          ),
        };
      })
      .filter(
        (item: any) =>
          item.youtubeId &&
          item.title &&
          item.privacyStatus === "public" &&
          item.liveBroadcastContent === "none" &&
          item.seconds > 0 &&
          item.seconds <= 180,
      )
      .sort((a: any, b: any) => b.fallbackViews - a.fallbackViews)
      .slice(0, limit)
      .map(
        ({
          seconds: _seconds,
          privacyStatus: _privacy,
          liveBroadcastContent: _live,
          ...item
        }: any) => item as YouTubeShort,
      );

    console.log(
      `[portal] YouTube Shorts ranking OK: ${shorts.length} videos from ${ids.length} uploads`,
    );
    return shorts.length > 0 ? shorts : fallback();
  } catch (err) {
    console.warn("[portal] YouTube Shorts fetch failed:", err);
    return fallback();
  }
}

export function formatRelativeDate(iso: string): string {
  // Defensive: 不正な timestamp (Instagram APIの欠落値、yyyymmdd直書きの誤入力等) で
  // ビルド全体がクラッシュしないように、まず Date が valid か検証する。
  if (!iso || typeof iso !== "string") {
    return "—";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  const TZ = "Asia/Tokyo";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayJst = new Date(`${fmt.format(new Date())}T00:00:00Z`);
  const thenJst = new Date(`${fmt.format(parsed)}T00:00:00Z`);
  const days = Math.floor(
    (todayJst.getTime() - thenJst.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  if (days < 30) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
  return `${Math.floor(days / 365)}年前`;
}
