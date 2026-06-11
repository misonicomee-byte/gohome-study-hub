/**
 * 広報ポータル用データ取得モジュール
 * - Blog: WordPress REST API（build時）
 * - Instagram: GAS JSON API（build時、要：deployment public access）
 *
 * fetch失敗時は空配列を返す（ビルドは止めない）
 */

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

// XServer WAFがGitHub Actionsの米国IPから/wp-json/を403で遮断するため、
// 日本国内NAS（self-hosted runner）で日次同期されている共有スプレッドシート経由でblog一覧を取得する。
const SPREADSHEET_ID = "1mPg_kiLfHtGBwnvE9DERfdZB_4cRYRuIGcySoTQQuVY";
const BLOG_SHEET_NAME = "ブログ一覧";
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbzfTC0-0D9DB_odgG7OLkJ7cBI0vKaZdcaRAv3rx612t9pLSJR59gcsiUPCx7MSay-2/exec";

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
async function fetchBlogFromGAS(): Promise<BlogPost[]> {
  if (_blogCache) return _blogCache;
  try {
    const url = `${GAS_URL}?api=blog-ranking&days=180&limit=100`;
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) {
      console.warn(`[portal] blog GAS fetch failed: status=${res.status}`);
      return [];
    }
    const text = await res.text();
    if (text.startsWith("<!") || text.startsWith("<html")) {
      console.warn("[portal] blog GAS returned HTML (deployment may require auth)");
      return [];
    }
    const json = JSON.parse(text);
    if (json.error) {
      console.warn("[portal] blog GAS error:", json.error);
      return [];
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
export async function fetchInstagramPosts(limit = 30): Promise<InstagramPost[]> {
  try {
    const url = `${GAS_URL}?api=instagram-posts&limit=${limit}`;
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) return [];
    const text = await res.text();
    if (text.startsWith("<!") || text.startsWith("<html")) {
      console.warn(
        "[portal] Instagram API returned HTML (deployment may require auth — set webapp access to 'Anyone' in GAS UI)"
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
export function rankByLikes(posts: InstagramPost[], limit = 6): InstagramPost[] {
  return [...posts].sort((a, b) => b.like_count - a.like_count).slice(0, limit);
}

/**
 * 人気Instagram投稿 — エンゲージメント率（like+comment+saved）/ reach 降順
 */
export function rankByEngagementRate(posts: InstagramPost[], limit = 6): InstagramPost[] {
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
  { name: "嚥下・栄養", patterns: [/嚥下|食[べ事]|栄養|食欲|低栄養|フレイル|サルコペニア|管理栄養士|食形態/, /【嚥下/, /【栄養/] },
  { name: "感染症", patterns: [/感染|尿路|肺炎|発熱|抗菌薬|耐性菌|敗血症|消毒|清潔/] },
  { name: "皮膚・褥瘡", patterns: [/皮膚|褥瘡|スキン|湿疹|皮膚科|肌|傷|創/] },
  { name: "排泄ケア", patterns: [/排尿|排便|尿|便|失禁|オムツ|カテーテル|トイレ|膀胱|便秘|下痢/] },
  { name: "認知症", patterns: [/認知症|BPSD|物忘れ|徘徊|せん妄|MCI/] },
  { name: "メンタル", patterns: [/うつ|心の|精神|不安|気持ち|心理|孤独|ストレス|傾聴/] },
  { name: "看取り・ACP", patterns: [/看取り|終末|ACP|人生会議|延命|意思決定|尊厳|最期|臨終|死/] },
  { name: "糖尿病・生活習慣", patterns: [/糖尿|血糖|HbA1c|インスリン|高血圧|脂質|肥満|フット/] },
  { name: "心疾患・呼吸器", patterns: [/心不全|心疾患|不整脈|呼吸|COPD|喘息|肺|心臓/] },
  { name: "点滴・輸液", patterns: [/点滴|輸液|皮下|脱水|補液|【点滴/] },
  { name: "薬剤管理", patterns: [/服薬|薬剤|処方|薬|残薬|副作用|相互作用|薬剤師/] },
  { name: "多職種連携", patterns: [/連携|多職種|チーム|ケアマネ|訪問看護|薬剤師|理学療法|作業療法|歯科|地域包括/] },
  { name: "家族介護", patterns: [/家族|介護者|介護負担|レスパイト|介護家族|ヤングケアラー|遠距離介護|独居/] },
  { name: "制度・算定", patterns: [/算定|改定|加算|診療報酬|介護報酬|施設基準|【2026/] },
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
    console.log(`[portal] podcast from GAS OK: ${_podcastCache?.length} episodes`);
    return _podcastCache!;
  } catch (err) {
    console.warn("[portal] podcast fetch failed:", err);
    return [];
  }
}

export function getPodcastGenres(eps: PodcastEpisode[]): { name: string; count: number }[] {
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
