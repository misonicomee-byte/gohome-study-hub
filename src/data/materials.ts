/**
 * 配布資料（PDF）一覧
 * - 印刷物・FAX送付・対外配布用のPDFをカテゴリ別に整理
 * - PDFは public/materials/ に配置
 */

export interface Material {
  slug: string;
  title: string;
  description: string;
  filename: string; // public/materials/ 配下のファイル名
  category: string;
  audience: "clinic" | "patient" | "partner" | "all";
}

export const MATERIALS: Material[] = [
  // ===== クリニック紹介 =====
  {
    slug: "strengths",
    title: "ごうホームクリニックの強み",
    description: "訪問診療の実績、診療体制、当院ならではの強みをまとめたパンフレット。",
    filename: "02-strengths.pdf",
    category: "クリニック紹介",
    audience: "all",
  },
  {
    slug: "doctors",
    title: "医師紹介",
    description: "院長・常勤医・非常勤医の経歴と専門分野をご紹介。",
    filename: "03-doctors.pdf",
    category: "クリニック紹介",
    audience: "all",
  },
  {
    slug: "visit-tour",
    title: "訪問診療見学会のご案内",
    description: "医療職向けの訪問診療見学会のご案内。同行可能日程など。",
    filename: "10-visit-tour.pdf",
    category: "クリニック紹介",
    audience: "partner",
  },
  {
    slug: "content-archive",
    title: "WEB勉強会・Podcastまとめ",
    description: "毎月のWEB勉強会と日々のPodcast配信の集約案内。",
    filename: "04-content-archive.pdf",
    category: "クリニック紹介",
    audience: "partner",
  },

  // ===== サービス案内 =====
  {
    slug: "chemotherapy",
    title: "在宅化学療法",
    description: "ご自宅で受けられる化学療法の対応範囲・体制について。",
    filename: "05-chemotherapy.pdf",
    category: "サービス案内",
    audience: "all",
  },
  {
    slug: "transfusion",
    title: "在宅輸血",
    description: "ご自宅で行う輸血の流れ・適応・安全管理について。",
    filename: "06-transfusion.pdf",
    category: "サービス案内",
    audience: "all",
  },
  {
    slug: "nutrition",
    title: "栄養指導",
    description: "管理栄養士による訪問栄養指導のご案内。認定栄養ケア・ステーション。",
    filename: "07-nutrition.pdf",
    category: "サービス案内",
    audience: "all",
  },

  // ===== ご家族向け =====
  {
    slug: "family-guide",
    title: "ご家族向け説明資料",
    description: "ご家族に訪問診療をご理解いただくための説明資料。",
    filename: "family-guide.pdf",
    category: "ご家族向け",
    audience: "patient",
  },
  {
    slug: "msw",
    title: "ソーシャルワーカー（相談室）",
    description: "医療ソーシャルワーカーによる生活支援・福祉サービス相談のご案内。",
    filename: "09-msw.pdf",
    category: "ご家族向け",
    audience: "patient",
  },
  {
    slug: "living-alone",
    title: "おひとり暮らしの方へ",
    description: "独居の方が安心して在宅医療を受けるためのサポート体制。",
    filename: "11-living-alone.pdf",
    category: "ご家族向け",
    audience: "patient",
  },

  // ===== 連携医療機関向け =====
  {
    slug: "yashio",
    title: "やしお居宅介護支援事業所",
    description: "併設のやしお居宅介護支援事業所（ケアマネジャー）のご案内。",
    filename: "08-yashio.pdf",
    category: "連携先・連携方法",
    audience: "partner",
  },
  {
    slug: "visiting-nurse-cooperation",
    title: "訪問看護ステーションとの連携",
    description: "訪問看護ステーションとの連携方法・指示書発行などの実務案内。",
    filename: "visiting-nurse-cooperation.pdf",
    category: "連携先・連携方法",
    audience: "partner",
  },
  {
    slug: "contact-info",
    title: "連絡方法",
    description: "電話・FAX・LINE・メールなど、当院との連絡方法一覧。",
    filename: "contact-info.pdf",
    category: "連携先・連携方法",
    audience: "all",
  },
];

export function getMaterialCategories(): string[] {
  const set = new Set<string>();
  for (const m of MATERIALS) set.add(m.category);
  return Array.from(set);
}

export function getMaterialsByCategory(): Map<string, Material[]> {
  const map = new Map<string, Material[]>();
  for (const m of MATERIALS) {
    if (!map.has(m.category)) map.set(m.category, []);
    map.get(m.category)!.push(m);
  }
  return map;
}
