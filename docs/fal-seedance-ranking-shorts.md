# Ranking Shorts renderer

月次ランキング manifest と順位別素材から、42 秒・縦型の候補 MP4 を再現可能に生成するための運用手順です。出力は QA を全件通過するまで `draft/` に留まり、合格後だけ `candidate/` に昇格します。

## 入力

- manifest: strict schema v1 の JSON（1〜3 位を各 1 件）
- assets: `rank-1.png` / `rank-2.jpg` / `rank-3.webp` のような静止画、または `rank-1.mp4` のような動画を順位ごとにちょうど 1 件
- BGM: WAV / MP3 / M4A / AAC を 1 件
- Seedance背景（任意）: 文字を含まない MP4 / MOV / WebM を `--seedance` で1件
- narration: 通常は `GEMINI_API_KEY` による生成。検証時は `--narration` で作成済み WAV を注入できる

```bash
python3 scripts/ranking-shorts-renderer/main.py \
  --manifest ranking.json \
  --assets assets \
  --placement chapter \
  --motion split-reveal \
  --resolution 1080x1920 \
  --bgm licensed-bgm.wav \
  --seedance ranking-motion.mp4 \
  --out candidate/ranking-short.mp4
```

`--placement` は `hook`、`chapter`、`none` のいずれかです。`hook` は冒頭、`chapter` は冒頭と各順位の開始、`none` は文字くり抜きなしです。Seedanceは既存の `fal-seedance` ワークフローで文字なしの共通背景を生成します。`chapter:cutout-zoom` では「2026年6月 TOP3」「第3位」「第2位」「第1位」の文字内に次の画像または動画を映し、文字外にSeedance背景を映してから拡大します。日本語、年月、順位、字幕は動画モデルに描かせず、rendererで正確に合成します。順位素材には `rank-1.mp4` も使用できます。

renderer 本体は、ランキング schema・テスト・月次処理と同じ変更履歴で再現性を保つため、versioned `gohome-study-hub` リポジトリに置きます。`fal-seedance` はモーション背景とfal Stable Audioの媒体別BGMマスター生成を担当し、完成素材だけをこの renderer の入力にする境界です。

Gemini TTS は短いナレーション行ごとに生成し、各行を42秒の固定タイムラインへ配置します。区間よりわずかに長い音声だけ安全範囲で速度調整し、短い音声は無音で埋めます。`--narration` は、あらかじめ42秒へ整えた完成音声トラックをそのまま使うための入力です。

## BGM の境界

BGM はYouTube、Instagram、ブログ、Podcastの4媒体にfal Stable Audioの固定マスターを1曲ずつ割り当て、同じ媒体では月が変わっても同じ曲を使います。利用元、生成日、ライセンス、商用・SNS利用条件とSHA-256を案件台帳に記録します。権利条件が確認できない外部音源は入力に使いません。procedural BGM generation is outside this workflow.

## QA と成果物

CLI は ffprobe で H.264/AAC、1 映像・1 音声、30fps、指定解像度、41.5〜42.5 秒を検査します。その後、エラー即時終了の全編 decode、blackdetect、2 秒間隔で期待21枚（許容0枚）の contact sheet、MP4 の SHA-256 を検証・記録します。いずれかが失敗した場合、候補 MP4 は作られず実行固有の `draft/` サブフォルダが調査用に残ります。

合格した媒体フォルダには MP4、QA JSON、contact sheet に加えて次を同梱します。

- `post_caption.txt`: `■タイトル`、タイトル、空行、`■説明文`、本文、クリニック名と `https://gohome-clinic.com/`、AI 制作注記、ハッシュタグの順で、そのまま一括コピーできる投稿案。医療効果を断定しない文面に限定する
- `captions.json`: 動画字幕の機械検証用タイムライン。投稿文とは別物

`post_caption.txt` は renderer が生成する安全な下書きです。媒体別の文字数、最新情報、表現、最終投稿文の責任は後続 orchestrator と人間の公開担当者が持ちます。
