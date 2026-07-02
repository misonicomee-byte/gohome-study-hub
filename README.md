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

## 法定研修ページのLINEログイン認証

`/houtei-kenshu/` は公開入口です。`/houtei-kenshu/*` の子ページは Cloudflare Pages Functions の middleware で保護し、LINEログイン後に公式LINEの友だち状態を確認できた場合だけ表示します。

Cloudflare Pages の Variables and Secrets に以下を設定してください。

```text
LINE_LOGIN_CHANNEL_ID=LINEログインチャネルID
LINE_LOGIN_CHANNEL_SECRET=LINEログインチャネルシークレット
LINE_SESSION_SECRET=32文字以上のランダム文字列
```

LINE Developers 側では、LINEログインチャネルに公式LINEアカウントをリンクし、コールバックURLに次を登録します。

```text
https://study.gohome-clinic.com/api/auth/line/callback
```

ローカルでFunctions込みの挙動を確認する場合は、同じ値を `.dev.vars` に入れて `npx wrangler pages dev dist` で確認します。

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
- `/houtei-kenshu/` — 法定研修の公開入口（LINEログイン導線）
- `/houtei-kenshu/portal/` — LINE認証後の法定研修ポータル
