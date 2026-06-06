# ごうホームクリニック WEB勉強会アーカイブ

訪問診療を学ぶ医療職向けのWEB勉強会動画アーカイブサイト。
Astro + Tailwind CSS で構築、Cloudflare Pages でホスティング。

- 本番URL: https://study.gohome-clinic.com/
- 関連: 本院サイト https://gohome-clinic.com/

## 開発

```bash
npm install
npm run dev      # 開発サーバー
npm run build    # 本番ビルド (dist/)
npm run preview  # ビルド成果物を確認
```

## 動画の追加方法

`src/data/lectures.ts` の `LECTURES` 配列に1エントリ追加するだけ：

```ts
{
  slug: '2025-11-themename',
  date: '2025-11',
  title: 'WEB勉強会のテーマ',
  description: '内容の要約。',
  youtubeId: 'YouTubeのVideoID',
  themes: ['認知症', '看取り'],
  blogUrl: 'https://gohome-clinic.com/...', // 任意
}
```

push すると Cloudflare Pages が自動ビルド・デプロイします。

## アーキテクチャ

- **Astro 6** — 静的サイトジェネレーター（高速・SEO良好）
- **Tailwind CSS v4** — ユーティリティCSS
- **TypeScript** — 型安全
- **Cloudflare Pages** — ホスティング（無料・速い・GitHub連携自動デプロイ）

## ページ構成

- `/` — トップ（最新動画ヒーロー・テーマフィルタ・全動画グリッド・LINE CTA）
- `/lectures/[slug]/` — 個別動画ページ（埋込・関連ブログ・関連動画）
- `/line` — 公式LINE登録案内
