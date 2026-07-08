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

## studyサイト行動分析

Cloudflare D1 `gohome-study-analytics` に、サイト内クリックと法定研修動画の再生イベントを匿名で保存します。

保存する主なイベント:

- `content_click` — 講義、レジュメ、本院ブログ、Instagram、Podcast、LINE、法定研修入口などのクリック
- `video_play` / `video_progress` / `video_pause` / `video_complete` — 法定研修動画の再生、25/50/75/95%到達、停止、完了
- `quiz_grade` / `module_complete` / `certificate_create` — 小テスト採点、受講完了、修了書作成

個人情報保護のため、LINEプロフィール、受講者名、所属、IPアドレス、User-Agentは保存しません。保存する識別子はブラウザ内で生成する匿名の visitor/session ID のみです。

初回またはスキーマ更新時はD1 migrationを適用します。

```bash
npx wrangler d1 migrations apply gohome-study-analytics --remote
```

月次レポートは `.github/workflows/study_analytics_report.yml` が毎月2日 07:10 JST に実行し、GitHub Actions の Job Summary に出力します。Chatwork通知も行う場合は、GitHub Secrets に次を追加してください。

```text
CHATWORK_API_TOKEN=通知に使うChatwork API Token
CHATWORK_NOTIFY_ROOM_ID=通知先ルームID
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
- `/houtei-kenshu/` — 法定研修の公開入口（LINEログイン導線）
- `/houtei-kenshu/portal/` — LINE認証後の法定研修ポータル
