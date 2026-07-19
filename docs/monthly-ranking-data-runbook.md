# 月次コンテンツランキング データ運用手順

この手順は、YouTube Shorts・ブログ・Instagramの前月TOP3 manifestを収集する運用者向けです。日時はすべて`Asia/Tokyo`で扱います。認証値、患者情報、私信はこの文書や成果物へ記録しません。

## 現在の本番状態と切り替え方

- GAS本番は現在version 63です。version 61で発見した既存ポータルの`days=180`互換問題は、`src/data/portal.ts`から明示的な`startDate`と`endDate`を送る修正で解消済みです。
- 次回は新しいdeploymentを作らず、既存のproduction deployment IDを更新します。これによりWeb App URLを変えません。
- `src/data/portal.ts`を含むサイト側互換修正と、同じdeployment IDを使ったGAS version 63への更新は完了しています。サイトを再ビルドした後もendpoint確認までを一続きの作業として扱います。
- `appsscript.json`の設定だけを根拠に公開済みと判断しません。version 63では未ログインの外部クライアントからブログ、Instagram投稿、Instagram月次rankingのJSON応答を確認済みです。再デプロイ時も、同じdeployment IDと匿名アクセスを実測してください。
- 問題があれば、同じdeployment IDとURLを保ったままversion 60へ戻します。

```bash
cd gas/content-analytics
clasp push
clasp version "monthly ranking exact ranges"
clasp deploy -i '<same-production-deployment-id>' -V '<reviewed-version>' -d 'monthly ranking exact ranges'

# 緊急ロールバック
clasp deploy -i '<same-production-deployment-id>' -V 60 -d 'rollback monthly ranking'
```

`clasp`の成功表示だけでは公開アクセスを証明できません。deployment ID、version、既存Web App URL、公開アクセスを運用者が画面で照合してください。

## 必要な設定名

Apps ScriptのScript Propertiesには値を書き込まず、次の名前が存在することだけをこの文書で管理します。

- `META_PAGE_ACCESS_TOKEN`
- `CONTENT_SNAPSHOT_SPREADSHEET_ID`

月次収集CLIで使う環境変数またはGitHub Secretsは次のとおりです。

- `CONTENT_ANALYTICS_GAS_URL`
- 一時アクセストークン方式: `YOUTUBE_ACCESS_TOKEN`
- refresh token方式: `YOUTUBE_REFRESH_TOKEN`、`YOUTUBE_CLIENT_ID`、`YOUTUBE_CLIENT_SECRET`
- 通常のポータルビルドでYouTube Data APIを使う場合: `YOUTUBE_API_KEY`

値は安全なsecret storeから実行時に注入し、shell履歴、issue、ログ、manifestへ残さないでください。月次CLIは`YOUTUBE_ACCESS_TOKEN`を優先し、未設定時のみrefresh token一式を使用します。

## Instagram snapshotの初期設定

1. Apps Scriptエディタで`setupInstagramSnapshotStore()`を1回手動実行します。
2. 初回はsnapshot用Spreadsheetと`instagram_daily`シートを作り、`CONTENT_SNAPSHOT_SPREADSHEET_ID`を設定します。既存IDがある場合は同じSpreadsheetを再利用します。
3. `instagram_daily`の先頭行が次の順序であることを確認します。

```text
snapshotDate, mediaId, timestamp, permalink, caption, mediaType, views, reach, totalInteractions, saved, shares
```

4. `runDailyInstagramSnapshot()`を手動実行し、当日のJST日付で行が追記されること、実行履歴にエラーがないことを確認します。
5. トリガー画面で`runDailyInstagramSnapshot`が1件だけ存在することを確認します。設定は日次・6時台です。Apps Scriptの時刻トリガーには実行幅があるため、厳密な06:00実行とは扱いません。

snapshotは追記専用です。同日再実行の行も残り、月次計算時はその日の最後のcaptureが使われます。シートの値やヘッダーを手で並べ替えたり、過去行を上書きしたりしないでください。

## 集計期間とfallback

### ポータルの通常表示

ポータルビルドのブログ取得は月次ランキングとは別です。ビルド当日のJST日付を`endDate`、そこから179日前を`startDate`として、両端を含む180 calendar daysをGASへ明示します。廃止済みの`days` parameterは送りません。

### 月次manifest

- 共通: 指定月の1日から末日までを`Asia/Tokyo`の完全なcalendar monthとして扱います。CLIで月を省略するとJSTの前月です。
- YouTube: YouTube Analyticsの同一期間におけるShortsの`views`を主指標、`engagedViews`を副指標にします。
- Blog: GASへ同一の`startDate`と`endDate`を送り、GA4の`screenPageViews`を主指標、`totalUsers`を副指標にします。レスポンス期間が要求期間と完全一致しなければ失敗します。
- Instagram exact: 月初snapshotと翌月1日のboundary snapshotの差分から`viewsDelta`と`totalInteractionsDelta`を計算します。両日で存在するmediaだけが対象です。
- Instagram fallback: snapshot store未設定、または完全なboundary snapshot不足という既知の理由に限り、要求月に公開された投稿を現在の`views`で並べる初回用fallbackを使います。これは月内増加数ではなく、manifestの`rankingMode`は`initialPublishedMonthCurrentViews`です。
- 不明なAPIエラー、理由のないpartial response、期間不一致をfallbackで隠しません。収集全体を失敗させて調査します。

## CLI実行

前月を自動選択する場合:

```bash
CONTENT_ANALYTICS_GAS_URL='<existing-web-app-url-from-secret-store>' \
YOUTUBE_ACCESS_TOKEN='<temporary-token-from-secret-store>' \
npm run ranking:collect
```

月と出力を明示する場合:

```bash
CONTENT_ANALYTICS_GAS_URL='<existing-web-app-url-from-secret-store>' \
YOUTUBE_ACCESS_TOKEN='<temporary-token-from-secret-store>' \
npm run ranking:collect -- --month 2026-06 --out output/monthly-ranking/2026-06
```

refresh token方式では`YOUTUBE_ACCESS_TOKEN`を設定せず、`YOUTUBE_REFRESH_TOKEN`、`YOUTUBE_CLIENT_ID`、`YOUTUBE_CLIENT_SECRET`を安全な環境から注入します。

収集は3channelすべてのschema検証に成功するまで公開されません。一時directoryへ書き、完成directoryへrenameした後、指定した`--out`を完成directoryへの相対symlinkとして一度だけ作成します。既存のファイル、directory、symlinkは上書きしません。そのため、読者から見える出力は「存在しない」か「3channelすべて完成済み」のどちらかです。

## 失敗時のretry

1. エラー文からYouTube OAuth、GAS status、Instagram boundary、出力先競合のどれかを切り分けます。secret値をログへ貼らないでください。
2. transientなnetwork/OAuth失敗はcredential状態を安全な場所で確認し、同じcommandを再実行します。失敗runは最終symlinkを作りません。
3. `--out`が既に存在する場合は上書きせず、別の未使用出力名で再収集します。旧出力を削除・差し替える前に新出力を検証してください。
4. Instagram exactでboundary不足なら、fallback manifestのlabelと`rankingMode`を確認します。既知理由以外のpartial/errorはretryでごまかさず、GAS実行履歴とsnapshot sheetを調べます。
5. GAS切り替え後にポータルのブログが空、HTML、または期間不整合になった場合は同じdeployment IDをversion 60へ戻し、原因を直してから再試行します。

## 本番cross-check

収集後、各`ranking.json`の期間・channel・TOP3を次の実画面と比較します。

- YouTube: YouTube Studioの詳細Analyticsを同じJST日付範囲・Shortsに絞り、TOP3のviewsとengaged viewsを照合します。
- Blog: GA4探索で同じ日付範囲、page path、screen page views、total usersを照合します。クエリ付きURLがcanonical pathへ集約される点も確認します。
- Instagram exact: `instagram_daily`の月初と翌月1日の最新行を比較し、Instagram Insightsの公開投稿指標と大きな乖離がないか確認します。
- Instagram fallback: 対象月公開の投稿だけであること、値が現在viewsであり月内deltaではないことを確認します。

記録してよいのは公開コンテンツのID、タイトル、URL、期間、集計指標だけです。患者情報、DM、コメント本文、アクセストークン、Spreadsheet ID、deployment IDを検証メモや成果物へ残しません。

## リリース前チェック

```bash
npm test
npm run build
node --check scripts/monthly-ranking-data/collect.mjs
git diff --check
gitleaks git --redact --no-banner
```

最後に、productionが意図したversion、同じWeb App URL、公開アクセス、ブログの明示期間、Instagramの`views`、月次endpointのexact/fallback表示を運用者が確認してから完了とします。
