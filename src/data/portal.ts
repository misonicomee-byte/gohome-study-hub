/**
 * 広報ポータル用データ取得モジュール
 * - Blog: WordPress REST API（build時）
 * - Instagram: GAS JSON API（build時、要：deployment public access）
 *
 * fetch失敗時は空配列を返す（ビルドは止めない）
 */

export interface BlogPost {
  id: number;
  title: string;
  link: string;
  date: string;
  excerpt: string;
  thumbnail: string | null;
  categories: number[];
  tags: number[];
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

const WP_BASE = "https://gohome-clinic.com/wp-json/wp/v2";
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbzfTC0-0D9DB_odgG7OLkJ7cBI0vKaZdcaRAv3rx612t9pLSJR59gcsiUPCx7MSay-2/exec";

const FETCH_OPTS: RequestInit = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json",
  },
};

/**
 * 最新blog n件を取得（含アイキャッチ画像）
 */
export async function fetchLatestBlogPosts(limit = 6): Promise<BlogPost[]> {
  try {
    const url = `${WP_BASE}/posts?per_page=${limit}&_embed=wp:featuredmedia&_fields=id,title,link,date,excerpt,categories,tags,_links,_embedded&status=publish`;
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) return [];
    const items: any[] = await res.json();
    return items.map((p) => ({
      id: p.id,
      title: cleanHtml(p.title?.rendered ?? ""),
      link: p.link,
      date: p.date,
      excerpt: cleanHtml(p.excerpt?.rendered ?? "").slice(0, 120),
      thumbnail:
        p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ??
        p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.medium?.source_url ??
        null,
      categories: p.categories ?? [],
      tags: p.tags ?? [],
    }));
  } catch (err) {
    console.warn("[portal] blog fetch failed:", err);
    return [];
  }
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
 * 人気blog（コメント数で代用 — 真の人気度はGA4等が必要）
 */
export async function fetchPopularBlogPosts(limit = 6): Promise<BlogPost[]> {
  // _fields に comment_count を含めて取得、降順ソート
  try {
    const url = `${WP_BASE}/posts?per_page=50&_embed=wp:featuredmedia&_fields=id,title,link,date,excerpt,categories,tags,comment_count,_links,_embedded&status=publish&orderby=comment_count&order=desc`;
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) return [];
    const items: any[] = await res.json();
    return items
      .filter((p) => (p.comment_count ?? 0) > 0)
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        title: cleanHtml(p.title?.rendered ?? ""),
        link: p.link,
        date: p.date,
        excerpt: cleanHtml(p.excerpt?.rendered ?? "").slice(0, 120),
        thumbnail:
          p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ??
          p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.medium?.source_url ??
          null,
        categories: p.categories ?? [],
        tags: p.tags ?? [],
      }));
  } catch (err) {
    console.warn("[portal] popular blog fetch failed:", err);
    return [];
  }
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

export function formatRelativeDate(iso: string): string {
  const now = new Date();
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  if (days < 30) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
  return `${Math.floor(days / 365)}年前`;
}
