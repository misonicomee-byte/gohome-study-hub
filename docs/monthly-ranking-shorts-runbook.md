# 月次ランキングShorts 下書き生成ランブック

この処理はYouTube、ブログ、Instagramの月次TOP3動画を、確認用の下書きとして生成します。アップロード、予約投稿、公開は一切行いません。公開判断と各媒体への投稿は、完成物を人が確認した後に別工程で行います。

## 事前準備

- Node.js、Python、ffmpeg、ffprobeとレンダラーのPython依存関係を用意する。
- ランキング収集に必要な環境変数を設定する。
  - `CONTENT_ANALYTICS_GAS_URL`
  - `YOUTUBE_CLIENT_ID`
  - `YOUTUBE_CLIENT_SECRET`
  - `YOUTUBE_REFRESH_TOKEN`
  - `GEMINI_API_KEY`（ナレーション生成に使用）
- `config/monthly-ranking-style-history.json` は `schemaVersion: 1` と `entries` 配列を持つこと。壊れた履歴は自動修復せず、実行前に停止する。

## 実行

```bash
npm run ranking:shorts -- --month 2026-06 --out output/monthly-ranking/2026-06
```

スタイルを人が指定する場合は、チャネルごとに `placement:motion` を渡します。

```bash
npm run ranking:shorts -- \
  --month 2026-06 \
  --out output/monthly-ranking/2026-06 \
  --youtube-style hook:cutout-zoom \
  --blog-style chapter:split-reveal \
  --instagram-style none:split-reveal
```

使用可能な組み合わせは `hook:cutout-zoom`、`chapter:split-reveal`、`hook:letter-scatter`、`chapter:cutout-zoom`、`none:split-reveal` です。同じチャネルで前月と同じ組み合わせにならないよう、未指定時は履歴から決定します。

## 画像とBGM

- YouTubeは動画IDから公式サムネイルを取得する。
- ブログは `gohome-clinic.com` の記事からOG画像を取得する。
- Instagramは `instagram-posts` APIの一覧から、ランキングの `contentId` と投稿IDが一致する画像だけを使用する。
- HTTPSの許可済みホスト、画像形式、容量を検証する。画像の取得・検証に失敗した順位は、文字を含まないブランド色PNGへ置き換える。画像失敗だけで他チャネルを停止しない。
- BGM未指定時は、権利元が不明な素材を使わず、コードで決定的に生成した54秒のWAVを使う。
- 手元のBGMを使う場合は、利用許諾を人が確認したファイルのみ指定する。

```bash
RANKING_SHORTS_BGM=/absolute/path/to/licensed-bgm.wav \
RANKING_SHORTS_BGM_LICENSE_CONFIRMED=true \
npm run ranking:shorts -- --month 2026-06 --out output/monthly-ranking/2026-06
```

シンボリックリンク、未対応形式、またはライセンス確認フラグのない明示BGMは拒否されます。

## 成果物と確認

各チャネルの主な成果物は次のとおりです。

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

1. `run-summary.json` で3チャネルそれぞれの成否を確認する。1チャネル失敗しても、成功チャネルの成果物は残る。
2. `ranking.json` と動画内の順位、タイトル、数値、字幕が一致することを確認する。
3. MP4を通しで視聴し、音声、発音、画面切れ、画像、トランジションを確認する。
4. QA JSON、QAシート、`post_caption.txt` のURL・集計条件・注記を確認する。
5. 代替のブランド色PNGがある場合、公開に適した画像へ人が差し替えるか判断する。

一部失敗時、CLIは全チャネルを試行して `run-summary.json` を保存した後に非ゼロ終了します。秘密情報を成果物へ書かないため、要約には詳細な例外文字列を保存しません。原因はローカルの実行ログと入力成果物から調査します。
