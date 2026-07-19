# Ranking Shorts renderer

月次ランキング manifest と順位別素材から、54 秒・縦型の候補 MP4 を再現可能に生成するための運用手順です。出力は QA を全件通過するまで `draft/` に留まり、合格後だけ `candidate/` に昇格します。

## 入力

- manifest: strict schema v1 の JSON（1〜3 位を各 1 件）
- assets: `rank-1.png` / `rank-2.jpg` / `rank-3.webp` のような静止画、または `rank-1.mp4` のような動画を順位ごとにちょうど 1 件
- BGM: WAV / MP3 / M4A / AAC を 1 件
- narration: 通常は `GEMINI_API_KEY` による生成。検証時は `--narration` で作成済み WAV を注入できる

```bash
python3 scripts/ranking-shorts-renderer/main.py \
  --manifest ranking.json \
  --assets assets \
  --placement chapter \
  --motion split-reveal \
  --resolution 1080x1920 \
  --bgm licensed-bgm.wav \
  --out candidate/ranking-short.mp4
```

`--placement` は `hook`、`chapter`、`none` のいずれかです。Seedance の演出素材を作る場合も、既存の `fal-seedance` ワークフローで生成し、この renderer には順位別の完成素材だけを渡します。生成映像の中に AI で日本語文字を描かせず、日本語字幕は renderer の編集可能なテキストから重ねます。

## BGM の境界

BGM は利用元、曲名、作者、取得日、ライセンス、商用・SNS 利用条件を案件台帳に記録し、証跡を保管してください。権利条件が確認できない音源は入力に使いません。procedural BGM generation is outside this workflow.

## QA と成果物

CLI は ffprobe で H.264/AAC、1 映像・1 音声、30fps、指定解像度、53.5〜54.5 秒を検査します。その後、全編 decode、blackdetect、2 秒間隔 contact sheet、MP4 の SHA-256 を検証・記録します。いずれかが失敗した場合、候補 MP4 は作られず draft が調査用に残ります。

合格した媒体フォルダには MP4、QA JSON、contact sheet に加えて次を同梱します。

- `post_caption.txt`: `■タイトル`、タイトル、空行、`■説明文`、本文、クリニック名と `https://gohome-clinic.com/`、AI 制作注記、ハッシュタグの順で、そのまま一括コピーできる投稿案。医療効果を断定しない文面に限定する
- `captions.json`: 動画字幕の機械検証用タイムライン。投稿文とは別物

`post_caption.txt` は renderer が生成する安全な下書きです。媒体別の文字数、最新情報、表現、最終投稿文の責任は後続 orchestrator と人間の公開担当者が持ちます。
