# Monthly ranking media masters

月次ランキングShortsで毎月再利用する固定素材です。BGMはすべて2026-07-19にfal Stable Audioで生成した42秒のインストゥルメンタルで、第三者の市販曲・ストック曲は含みません。公開時の利用条件は生成に使用したfal.ai契約とモデル条件を基準に管理します。

| 媒体 | ファイル | 音の役割 | fal request ID |
|---|---|---|---|
| YouTube | `bgm/youtube-stable-audio.m4a` | テンポのある現代的な電子音 | `019f7a35-b228-72e3-95fd-3832a94f7215` |
| Instagram | `bgm/instagram-stable-audio.m4a` | 温かく軽快な有機的グルーヴ | `019f7a35-b416-7031-8290-ea4473244e09` |
| Blog | `bgm/blog-stable-audio.m4a` | 落ち着いた編集・ニュース調 | `019f7a2a-fd1e-7561-9159-c2e22ca7cbe6` |
| Podcast | `bgm/podcast-stable-audio.m4a` | ピアノ中心の思索的な空気 | `019f7a35-b60a-7c82-93eb-70c3bafb7a44` |

4曲はAAC 160kbps、42秒で、概ね -16 LUFS / -1.5 dBTPを目安に正規化しています。レンダラーではナレーションと混ぜる前にBGMをさらに `volume=0.18` へ下げます。同じ媒体では毎月同じ曲を使い、曲の差し替えは意図的なブランド更新時だけ行います。

共通モーション `motion/ranking-seedance.mp4` はSeedance 2.0で生成した文字なしの9:16背景です（request `019f7a26-b4e4-79b2-aae9-c284c15b2a65`）。年月、TOP3、順位、日本語タイトルはすべてローカルレンダラーで正確に合成します。

SHA-256は実行時に再計算して `run-summary.json` へ記録されます。
