# 月次ランキングShorts 下書き生成ランブック

この処理はYouTube、ブログ、Instagram、Podcastの月次TOP3動画を、確認用の下書きとして媒体ごとに生成します。アップロード、予約投稿、公開は一切行いません。公開判断と各媒体への投稿は、完成物を人が確認した後の別工程です。

Podcastは既存の全Podcastエピソードに対応するYouTube動画を対象に、対象月中に増えたYouTube再生回数でTOP3を決めます。RSSは正規タイトル、Spotify URL、アートワークの照合にだけ使います。

## 事前準備

- Node.js、Python、ffmpeg、ffprobeとレンダラーのPython依存関係を用意する。
- ランキング収集に必要な環境変数を設定する。
  - `CONTENT_ANALYTICS_GAS_URL`
  - `YOUTUBE_CLIENT_ID`
  - `YOUTUBE_CLIENT_SECRET`
  - `YOUTUBE_REFRESH_TOKEN`
  - `GEMINI_API_KEY`（ナレーション生成に使用）
- `config/monthly-ranking-style-history.json` は `schemaVersion: 1` と `entries` 配列を持つこと。壊れた履歴は自動修復せず、実行前に停止する。

## 個別実行

媒体を1つ指定し、媒体ごとに別の出力先へ生成します。

```bash
npm run ranking:shorts -- \
  --month 2026-06 \
  --channel podcast \
  --out output/monthly-ranking/2026-06-podcast
```

`--channel` は `youtube`、`blog`、`instagram`、`podcast` のいずれかです。省略時は4媒体を試行しますが、定期運用と失敗時の再実行では個別指定を使います。出力先が既に存在する場合は上書きせず、収集前に停止します。再実行には新しい未使用の出力先を指定してください。

スタイルを人が指定する場合は、チャネルごとに `placement:motion` を渡します。

```bash
npm run ranking:shorts -- \
  --month 2026-06 \
  --channel youtube \
  --out output/monthly-ranking/2026-06-youtube \
  --youtube-style hook:cutout-zoom
```

使用可能な組み合わせは `hook:cutout-zoom`、`chapter:split-reveal`、`hook:letter-scatter`、`chapter:cutout-zoom`、`none:split-reveal` です。同じチャネルで前月と同じ組み合わせにならないよう、未指定時は履歴から決定します。履歴のread-modify-writeは排他ロックされ、異常終了後に残った古いロックは期限を確認して安全に回収します。

## 画像とBGM

- YouTubeは動画IDから公式サムネイルを取得する。
- ブログは `gohome-clinic.com` の記事からOG画像を取得する。
- Instagramは `instagram-posts` APIの一覧から、ランキングの `contentId` と投稿IDが一致する画像だけを使用する。
- PodcastはRSSで照合した `d3t3ozftmdmh3i.cloudfront.net` のアートワークだけを取得する。
- 外部取得はHTTPS、許可済みホスト、公開IPへのDNS解決、リダイレクト各hop、Content-Type、Content-Length、実受信バイト数を検証する。画像の上限は12MB、ブログ・Instagram APIレスポンスの上限は2MBで、上限超過時はストリームを中止する。
- 画像の取得・検証に失敗した順位は、文字を含まないブランド色PNGへ置き換える。画像失敗だけで他チャネルを停止しない。
- BGM未指定時は、権利元が不明な素材を使わず、コードで決定的に生成した54秒のWAVを使う。
- 手元のBGMを使う場合は、利用許諾を人が確認したファイルのみ指定する。

```bash
RANKING_SHORTS_BGM=/absolute/path/to/licensed-bgm.wav \
RANKING_SHORTS_BGM_LICENSE_CONFIRMED=true \
npm run ranking:shorts -- \
  --month 2026-06 \
  --channel youtube \
  --out output/monthly-ranking/2026-06-youtube
```

シンボリックリンク、未対応形式、またはライセンス確認フラグのない明示BGMは拒否されます。`run-summary.json` にはBGMのsource、SHA-256、ライセンス確認状態が記録されます。

## 原子的な成果物と確認

収集、画像準備、レンダリングはチャネルごとに独立した一時領域で行われます。成功したチャネルだけが最終成果物へ原子的に昇格し、失敗チャネルの部分ファイルと一時ファイルは削除されます。

```text
<out>/<channel>/ranking.json
<out>/<channel>/narration.txt
<out>/<channel>/captions.json
<out>/<channel>/assets/rank-1.*
<out>/<channel>/candidate/ranking-short.mp4
<out>/<channel>/candidate/ranking-short.qa.json
<out>/<channel>/candidate/ranking-short-qa-sheet.jpg
<out>/<channel>/candidate/captions.json
<out>/<channel>/candidate/post_caption.txt
<out>/run-summary.json
```

`candidate/post_caption.txt` は `buildCopy().postCaption` からレンダリング成功後に上書きされる、唯一の投稿コピーです。レンダラー側の生成内容や分割されたタイトル・説明ファイルは投稿元として扱いません。

公開前に、少なくとも以下を人が確認します。

1. `run-summary.json` で対象チャネルの成否、サニタイズ済み失敗カテゴリ、BGM source・hash・licenseを確認する。
2. `ranking.json` と動画内の順位、タイトル、数値、字幕が一致することを確認する。
3. Podcastは「前月中に増えたYouTube再生回数」のTOP3であり、正規タイトル、Spotify URL、RSSアートワークが対応していることを確認する。
4. MP4を通しで視聴し、音声、発音、画面切れ、画像、トランジションを確認する。
5. QA JSON、QAシート、`post_caption.txt` のURL・集計条件・注記を確認する。
6. 代替のブランド色PNGがある場合、公開に適した画像へ人が差し替えるか判断する。

一部失敗時、CLIは指定対象を試行して `run-summary.json` を保存した後に非ゼロ終了します。秘密情報を成果物へ書かないため、要約には詳細な例外文字列を保存せず、固定文言と失敗カテゴリだけを記録します。原因はローカルの実行ログと入力成果物から調査します。

## GitHub Actionsのpilot運用

`workflow_dispatch` ではmonthとchannelを指定して、1媒体だけを生成します。成果物はartifactへ保存され、公開処理はありません。

週次scheduleは毎週日曜09:00 JSTに定義されていますが、pilot承認前は無効です。最終承認後にだけRepository variable `ENABLE_MONTHLY_RANKING_SCHEDULE=true` を設定して有効化します。

YouTube Analyticsの月次値は対象月末後3完了日を待ち、`endDate + 4日 00:00 PT` から利用します。そのため、その月の第1日曜の日付に応じて順番を切り替えます。どちらも第1〜第4日曜に月4本を生成し、翌月曜日の手動アップロード方針は変わりません。

第1日曜がJSTの1〜4日の場合:

- 第1日曜: Instagram
- 第2日曜: blog
- 第3日曜: YouTube
- 第4日曜: podcast
- 第5日曜: 予備週としてskip

第1日曜がJSTの5〜7日の場合:

- 第1日曜: YouTube
- 第2日曜: blog
- 第3日曜: Instagram
- 第4日曜: podcast
- 第5日曜: 予備週としてskip

月曜日に担当者がartifactを取得して上記の確認を完了し、その後に各媒体へ手動アップロードします。workflowは月曜の自動公開・自動アップロードを行いません。
