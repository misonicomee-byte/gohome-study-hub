/**
 * WEB勉強会データ
 * 1動画 = 1エントリ
 * 新規追加時はこの配列に追記するだけ
 */

export interface Lecture {
  slug: string;
  date: string; // YYYY-MM
  title: string;
  description: string;
  youtubeId: string;
  themes: string[]; // タグ
  blogUrl?: string; // 関連ブログ記事URL
}

export const LECTURES: Lecture[] = [
  {
    slug: '2025-10-koreisha-fumin',
    date: '2025-10',
    title: '高齢者の不眠への対応',
    description:
      '不眠を訴える高齢者に対し、訪問診療医としてどう向き合うか。睡眠衛生指導から薬剤調整、家族支援まで実践的に解説。',
    youtubeId: '8rNHS6T0k7U',
    themes: ['高齢者', '不眠'],
    blogUrl:
      'https://gohome-clinic.com/2025/11/06/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b410%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
  {
    slug: '2025-09-shinkei-nanbyo',
    date: '2025-09',
    title: '神経難病と訪問診療 ― 家で生きる選択肢を支える',
    description:
      'パーキンソン病・ALS・筋ジストロフィーなど神経難病の在宅医療。「家で生きる」選択を、訪問診療がどう支えるか。',
    youtubeId: 'B1o1LBa19wU',
    themes: ['神経難病'],
    blogUrl:
      'https://gohome-clinic.com/2025/10/09/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b49%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
  {
    slug: '2025-08-seishin-shikkan',
    date: '2025-08',
    title: '精神疾患を紐解く ― 精神科訪問診療の実際',
    description:
      '統合失調症・うつ病・双極性障害など、精神疾患を抱える患者さんへの訪問診療。当院の精神科訪問の実例を公開。',
    youtubeId: 'QOFI5mHiJrs',
    themes: ['精神疾患'],
    blogUrl:
      'https://gohome-clinic.com/2025/09/06/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b48%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
  {
    slug: '2025-07-ninchisho',
    date: '2025-07',
    title: '認知症とともに生きる在宅医療',
    description:
      '"その人らしさ"を支える訪問診療のかたち。BPSD対応、家族の負担軽減、地域連携まで。',
    youtubeId: 'N7agyw8Udr0',
    themes: ['認知症'],
    blogUrl:
      'https://gohome-clinic.com/2025/08/15/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b46%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
  {
    slug: '2025-05-acp',
    date: '2025-05',
    title: 'ACP（人生会議）の学び直し',
    description:
      'Advance Care Planning ― 人生の最終段階を、本人・家族・医療者でどう話し合うか。基本に立ち返って学び直します。',
    youtubeId: '8XHMOhjCKmw',
    themes: ['ACP', '看取り'],
    blogUrl:
      'https://gohome-clinic.com/2025/06/16/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b45%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
  {
    slug: '2025-04-jokuso',
    date: '2025-04',
    title: '在宅褥瘡処置 ― 皮膚科医レクチャー編',
    description:
      '皮膚科専門医を招いた在宅褥瘡処置のレクチャー。創部評価から処置選択、ご家族指導まで。',
    youtubeId: 'mIzw8qm3KSU',
    themes: ['褥瘡', '皮膚科'],
    blogUrl:
      'https://gohome-clinic.com/2025/05/05/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b44%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
  {
    slug: '2025-03-donyu-jirei',
    date: '2025-03',
    title: '訪問診療導入前後の実践事例',
    description:
      '訪問診療をどのタイミングで、どう導入するか。実際の症例を通じて、連携先からの紹介・初回訪問・継続支援まで解説。',
    youtubeId: 'zlk5uaFvqps',
    themes: ['訪問診療導入', '実践事例'],
    blogUrl:
      'https://gohome-clinic.com/2025/03/27/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b43%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
  {
    slug: '2025-02-ryokin',
    date: '2025-02',
    title: '訪問診療の料金と説明方法',
    description:
      '訪問診療の費用構造と、患者さん・ご家族への説明のコツ。在医総管・施医総管・各種加算まで、わかりやすく整理。',
    youtubeId: 'm8rpoFN40IU',
    themes: ['料金', '制度'],
    blogUrl:
      'https://gohome-clinic.com/2025/03/11/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b42%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
  {
    slug: '2025-01-itsukara',
    date: '2025-01',
    title: 'いつから始める？訪問診療',
    description:
      '訪問診療をいつ始めるのが最適か。連携医療機関の視点から見た、紹介タイミングの考え方。',
    youtubeId: 'wTEm798KADE',
    themes: ['訪問診療導入', '連携'],
    blogUrl:
      'https://gohome-clinic.com/2025/02/10/%e8%a8%aa%e5%95%8f%e8%a8%ba%e7%99%82web%e5%8b%89%e5%bc%b7%e4%bc%9a%ef%bd%9c2025%e5%b9%b41%e6%9c%88%e3%81%aeyoutube%e6%8a%95%e7%a8%bf/',
  },
];

/**
 * 全テーマを抽出（出現頻度順）
 */
export function getAllThemes(): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const lecture of LECTURES) {
    for (const theme of lecture.themes) {
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * テーマでフィルタ
 */
export function getLecturesByTheme(theme: string): Lecture[] {
  return LECTURES.filter((l) => l.themes.includes(theme));
}

/**
 * 日付降順（最新が先）
 */
export function getLecturesSortedByDate(): Lecture[] {
  return [...LECTURES].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * 日付ラベル整形 "2025-10" → "2025年10月"
 */
export function formatDateLabel(date: string): string {
  const [y, m] = date.split('-');
  return `${y}年${parseInt(m, 10)}月`;
}
