export interface YouTubeShort {
  youtubeId: string;
  title: string;
  publishedAt: string;
  duration: string;
  fallbackViews: number;
}

/**
 * YouTube Studioで公開状態を確認したShorts一覧。
 * YouTube Data APIを利用できない場合の表示フォールバックとして使う。
 */
export const YOUTUBE_SHORTS: YouTubeShort[] = [
  {
    youtubeId: "AsrxlHi2sys",
    title: "【仕事紹介60秒アニメ】看護師の「たすかった」をつくる仕事。｜訪問診療クリニックの看護事務",
    publishedAt: "2026-07-16",
    duration: "1:08",
    fallbackViews: 1580,
  },
  {
    youtubeId: "RfTB_2rn45w",
    title: "【採用60秒アニメ】レセプトの向こうに、暮らしがある。｜訪問診療クリニックの医療事務",
    publishedAt: "2026-07-16",
    duration: "1:08",
    fallbackViews: 1422,
  },
  {
    youtubeId: "VBr4V3OZD-A",
    title: "【介護される方へ】「ごめんね」を「ありがとう」に変える12のヒント",
    publishedAt: "2026-07-17",
    duration: "2:01",
    fallbackViews: 513,
  },
  {
    youtubeId: "p_KMZMO2OhY",
    title: "【仕事紹介60秒アニメ】管理栄養士は、スーパーにいた——在宅患者さんの食卓を支える訪問栄養指導",
    publishedAt: "2026-07-17",
    duration: "1:11",
    fallbackViews: 423,
  },
  {
    youtubeId: "OvzBbxUy9vY",
    title: "【採用60秒アニメ】「お家で過ごしたい」を、つなぐ仕事。｜訪問診療クリニックのソーシャルワーカー",
    publishedAt: "2026-07-16",
    duration: "1:07",
    fallbackViews: 411,
  },
  {
    youtubeId: "benpxxwVqYE",
    title: "【求人60秒アニメ】医師が、すぐそばにいる——やしお居宅介護支援事業所のケアマネージャー",
    publishedAt: "2026-07-18",
    duration: "1:15",
    fallbackViews: 339,
  },
  {
    youtubeId: "FwCfROjdMFU",
    title: "【認知症の家族介護】眠れない・イライラする前に｜介護疲れから家族を守る",
    publishedAt: "2026-07-17",
    duration: "2:00",
    fallbackViews: 285,
  },
  {
    youtubeId: "bfvgKXuBMoE",
    title: "【採用60秒アニメ】あなたの看護を、おうちへ。｜訪問診療の看護師 転職ストーリー",
    publishedAt: "2026-07-16",
    duration: "1:06",
    fallbackViews: 23,
  },
  {
    youtubeId: "vyqVhAhxycw",
    title: "【求人120秒アニメ】病院勤務医から在宅医へ、新しい働き方を選んだふたり",
    publishedAt: "2026-07-17",
    duration: "2:08",
    fallbackViews: 21,
  },
  {
    youtubeId: "HrSdjYlnZ5w",
    title: "【採用60秒アニメ】不安なご家族に、最初に会う仕事。｜訪問診療クリニックの総務",
    publishedAt: "2026-07-16",
    duration: "1:07",
    fallbackViews: 17,
  },
  {
    youtubeId: "wApsu6vxEFQ",
    title: "【仕事紹介アニメ】その運転が、医療を動かす。訪問診療クリニックのドライバーという仕事",
    publishedAt: "2026-07-18",
    duration: "1:27",
    fallbackViews: 4,
  },
  {
    youtubeId: "MvWScOW_wjE",
    title: "【在宅看取り・絵本】最期の時間に家族ができる6つのこと｜声・手・休息",
    publishedAt: "2026-07-17",
    duration: "2:01",
    fallbackViews: 4,
  },
  {
    youtubeId: "_VkfEJXDLy4",
    title: "【絵本90秒】ご自宅で受ける訪問栄養指導とは｜管理栄養士が食卓に伴走｜ごうホームクリニック",
    publishedAt: "2026-07-17",
    duration: "1:31",
    fallbackViews: 1,
  },
  {
    youtubeId: "VWUelYeG1mY",
    title: "【親の介護】完璧を目指さない、家族を守るための心構え",
    publishedAt: "2026-07-17",
    duration: "2:01",
    fallbackViews: 0,
  },
];
