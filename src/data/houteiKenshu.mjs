export const PASSING_SCORE = 100;
export const QUIZ_BANK_SIZE_PER_MODULE = 10;
export const QUIZ_DISPLAY_COUNT = 5;

const moduleDefinitions = [
  {
    id: "abuse-prevention",
    displayNumber: "01",
    title: "高齢者虐待防止",
    category: "法定研修",
    duration: "60分",
    slug: "01-abuse-prevention",
    sourceFile: "01 高齢者虐待防止（法定研修）.mp4",
    primary: {
      question: "高齢者虐待防止で最も重要な初動はどれですか。",
      correct: "気づいた違和感を記録し、組織内で速やかに共有する",
      wrong: ["家族関係の問題として、本人と家族だけで解決してもらう", "明確な証拠がそろうまで記録を控える"],
    },
    practice: "早期発見、相談、組織的な対応の流れを確認する",
    avoid: "本人や家族の言動を決めつけ、記録や共有をしない",
    record: "気づき、相談先、対応経過を事実ベースで残す",
    sustain: "虐待の兆候をチームで振り返り、対応手順を見直す",
  },
  {
    id: "harassment",
    displayNumber: "02",
    title: "ハラスメント対策（職場・カスタマーハラスメント）",
    category: "法定研修",
    duration: "60分",
    slug: "02-harassment",
    sourceFile: "10 ハラスメント対策（職場＋カスタマーハラスメント）.mp4",
    primary: {
      question: "ハラスメント対策として適切な対応はどれですか。",
      correct: "個人の我慢に任せず、相談経路と記録・共有の手順を明確にする",
      wrong: ["利用者や家族からの言動はすべて受け入れる", "職員間の問題は業務外のこととして扱う"],
    },
    practice: "相談しやすい体制と管理者への報告経路を確認する",
    avoid: "被害を受けた職員の我慢や個人対応だけに任せる",
    record: "発生日時、相手、言動、対応、相談先を整理して残す",
    sustain: "職場内と利用者対応の両方で予防策を継続的に見直す",
  },
  {
    id: "infection-control",
    displayNumber: "03",
    title: "感染症・食中毒の予防及びまん延防止",
    category: "法定研修",
    duration: "60分",
    slug: "03-infection-control",
    sourceFile: "03 感染症・食中毒の予防及びまん延防止.before-insertions.mp4",
    primary: {
      question: "感染症・食中毒のまん延防止で基本となる対応はどれですか。",
      correct: "標準予防策を徹底し、発生時は早期に情報共有する",
      wrong: ["症状が軽ければ報告を後回しにする", "感染対策は医療機関だけが担う"],
    },
    practice: "手指衛生、標準予防策、発生時連絡体制を確認する",
    avoid: "症状や発生状況を確認せず、通常対応を続ける",
    record: "症状、発生時刻、接触状況、連絡先、対応内容を残す",
    sustain: "感染発生時の動線と役割分担を定期的に見直す",
  },
  {
    id: "bcp",
    displayNumber: "04",
    title: "業務継続計画（BCP）",
    category: "法定研修",
    duration: "53分",
    slug: "04-bcp",
    sourceFile: "04 業務継続計画（BCP）.mp4",
    primary: {
      question: "BCPの目的として最も適切なものはどれですか。",
      correct: "災害や感染症発生時にも重要業務を継続・早期復旧する",
      wrong: ["平時の業務分担を固定して変更しない", "災害時の判断をすべて外部機関に任せる"],
    },
    practice: "優先業務、連絡網、代替手段を平時から確認する",
    avoid: "発災後に初めて役割分担や連絡手段を決める",
    record: "訓練結果、課題、改善点、更新日を残す",
    sustain: "訓練と振り返りを通じて計画を更新し続ける",
  },
  {
    id: "dementia-care",
    displayNumber: "05",
    title: "認知症及び認知症ケア・意思決定支援",
    category: "法定研修",
    duration: "55分",
    slug: "05-dementia-care",
    sourceFile: "05 認知症及び認知症ケア・意思決定支援.mp4",
    primary: {
      question: "意思決定支援で重視する姿勢はどれですか。",
      correct: "本人の価値観や希望を確認し、理解しやすい形で選択を支える",
      wrong: ["支援者が最も効率的な選択を一方的に決める", "認知症があれば本人確認を省略する"],
    },
    practice: "本人の理解力に合わせた説明と意思確認を行う",
    avoid: "本人の意思を確認せず、周囲の都合だけで決める",
    record: "本人の発言、表情、選択肢、支援者の説明を残す",
    sustain: "状態変化に応じて意思確認の方法をチームで見直す",
  },
  {
    id: "compliance",
    displayNumber: "06",
    title: "倫理・法令遵守・公正中立",
    category: "法定研修",
    duration: "57分",
    slug: "06-compliance",
    sourceFile: "06 倫理・法令遵守・公正中立.mp4",
    primary: {
      question: "公正中立なケアマネジメントとして適切なものはどれですか。",
      correct: "本人の意向と必要性に基づき、複数の選択肢を説明する",
      wrong: ["事業所都合を優先してサービスを選ぶ", "説明記録は省略して口頭対応だけにする"],
    },
    practice: "法令、倫理、説明責任を意識して支援方針を検討する",
    avoid: "特定事業所の都合や慣習を優先して選択肢を狭める",
    record: "説明内容、選択肢、本人・家族の意向を残す",
    sustain: "判断に迷う事例を共有し、公正中立性を点検する",
  },
  {
    id: "privacy",
    displayNumber: "07",
    title: "個人情報保護・プライバシー",
    category: "法定研修",
    duration: "58分",
    slug: "07-privacy",
    sourceFile: "07 個人情報保護・プライバシー.mp4",
    primary: {
      question: "個人情報の取り扱いとして適切なものはどれですか。",
      correct: "利用目的と共有範囲を意識し、必要最小限で取り扱う",
      wrong: ["支援関係者なら目的を問わず自由に共有できる", "メモであれば個人情報として扱わなくてよい"],
    },
    practice: "利用目的、同意、共有範囲、保管方法を確認する",
    avoid: "必要性や同意を確認せずに個人情報を共有する",
    record: "情報提供の目的、共有先、同意状況を残す",
    sustain: "書類、端末、会話の取り扱いを定期的に点検する",
  },
  {
    id: "restraint-optimization",
    displayNumber: "08",
    title: "身体的拘束等の適正化",
    category: "法定研修",
    duration: "57分",
    slug: "08-restraint-optimization",
    sourceFile: "08 身体的拘束等の適正化.mp4",
    primary: {
      question: "身体的拘束等の適正化で必要な視点はどれですか。",
      correct: "本人の尊厳を守り、代替策と組織的検討を行う",
      wrong: ["転倒リスクがあれば常に拘束を優先する", "家族が希望すれば検討記録は不要である"],
    },
    practice: "本人の尊厳、代替策、リスク評価を組織で検討する",
    avoid: "安全確保を理由に、検討や記録なしで拘束を前提にする",
    record: "必要性、代替策、本人・家族への説明、見直し結果を残す",
    sustain: "拘束に頼らない支援方法を継続的に検討する",
  },
  {
    id: "disaster-response",
    displayNumber: "09",
    title: "非常災害時の対応",
    category: "法定研修",
    duration: "54分",
    slug: "09-disaster-response",
    sourceFile: "09 非常災害時の対応.mp4",
    primary: {
      question: "非常災害時の対応として重要な準備はどれですか。",
      correct: "連絡体制、優先順位、代替手段を平時から確認する",
      wrong: ["災害発生後に初めて担当者を決める", "個別利用者のリスク情報は災害対応に含めない"],
    },
    practice: "利用者ごとのリスク、連絡手段、避難・支援体制を確認する",
    avoid: "災害時の判断を現場任せにして、優先順位を決めない",
    record: "訓練、連絡確認、個別リスク、改善点を残す",
    sustain: "地域資源や関係機関との連携を定期的に確認する",
  },
  {
    id: "young-carer",
    displayNumber: "他制度理解①",
    title: "ヤングケアラー",
    category: "特定事業所加算対応",
    duration: "54分",
    slug: "other-01-young-carer",
    sourceFile: "他制度理解①：ヤングケアラー.mp4",
    primary: {
      question: "ヤングケアラー支援で重要な視点はどれですか。",
      correct: "子どもの生活・学業・心身への影響に気づき、関係機関につなぐ",
      wrong: ["家族内の役割なので支援対象としない", "本人が話さなければ支援の必要性はない"],
    },
    practice: "子どもの負担や生活への影響に気づく視点を持つ",
    avoid: "家族内の問題として扱い、支援機関につながない",
    record: "気づいた状況、本人・家族の意向、相談先を残す",
    sustain: "教育、福祉、医療など関係機関との連携を確認する",
  },
  {
    id: "disability-welfare",
    displayNumber: "他制度理解②",
    title: "障害（児・者）福祉制度",
    category: "特定事業所加算対応",
    duration: "55分",
    slug: "other-02-disability-welfare",
    sourceFile: "他制度理解②：障害（児・者）福祉制度.mp4",
    primary: {
      question: "障害福祉制度との連携で適切な姿勢はどれですか。",
      correct: "介護保険だけでなく、障害福祉サービスとの役割分担を確認する",
      wrong: ["高齢者支援では障害福祉制度を確認しない", "制度が違うため相談支援専門員とは連携しない"],
    },
    practice: "障害福祉サービスや相談支援との役割分担を確認する",
    avoid: "介護保険だけで完結すると決めつけ、他制度を確認しない",
    record: "利用制度、相談先、役割分担、連携内容を残す",
    sustain: "制度変更や対象者の状態変化に応じて連携先を見直す",
  },
  {
    id: "poverty-support",
    displayNumber: "他制度理解③",
    title: "生活困窮者自立支援",
    category: "特定事業所加算対応",
    duration: "62分",
    slug: "other-03-poverty-support",
    sourceFile: "他制度理解③：生活困窮者自立支援.mp4",
    primary: {
      question: "生活困窮が疑われる場合の対応として適切なものはどれですか。",
      correct: "本人の同意と状況に応じて、自立相談支援機関などへつなぐ",
      wrong: ["金銭問題はケアマネジメントと無関係として扱う", "支払い遅延だけを注意して支援は終了する"],
    },
    practice: "生活状況、支払い困難、相談先を確認し必要な支援につなぐ",
    avoid: "金銭面の困りごとを支援対象外として見過ごす",
    record: "困窮の兆候、本人の同意、相談機関、対応経過を残す",
    sustain: "地域の相談窓口や支援制度を定期的に確認する",
  },
  {
    id: "rare-disease",
    displayNumber: "他制度理解④",
    title: "難病患者等",
    category: "特定事業所加算対応",
    duration: "58分",
    slug: "other-04-rare-disease",
    sourceFile: "他制度理解④：難病患者等.mp4",
    primary: {
      question: "難病患者等の支援で重要な連携先はどれですか。",
      correct: "医療機関、保健所、相談支援機関など必要な関係者",
      wrong: ["介護サービス事業所だけ", "本人の病名が分かれば連携は不要"],
    },
    practice: "疾患特性、医療連携、相談先、制度利用を確認する",
    avoid: "病名だけで支援内容を決め、本人の生活課題を確認しない",
    record: "医療情報、支援上の留意点、連携先、本人の希望を残す",
    sustain: "病状変化に応じて医療・福祉・保健の連携を見直す",
  },
];

export const trainingModules = moduleDefinitions.map((module) => ({
  ...module,
  quizzes: buildQuizzes(module),
}));

export const requiredModuleIds = trainingModules.map((module) => module.id);

export function calculateModuleQuizScore(moduleId, moduleAnswers = {}, selectedQuizIds = null) {
  const module = trainingModules.find((item) => item.id === moduleId);
  if (!module) {
    return { correct: 0, total: 0, percentage: 0, completed: false, passed: false };
  }
  const quizzes = Array.isArray(selectedQuizIds) && selectedQuizIds.length > 0
    ? module.quizzes.filter((quiz) => selectedQuizIds.includes(quiz.id))
    : module.quizzes;

  const correct = quizzes.reduce((count, quiz) => (
    moduleAnswers[quiz.id] === quiz.answer ? count + 1 : count
  ), 0);
  const total = quizzes.length;
  const completed = quizzes.every((quiz) => Boolean(moduleAnswers[quiz.id]));
  const percentage = total === 0 ? 0 : Math.round((correct / total) * 100);
  return {
    correct,
    total,
    percentage,
    completed,
    passed: completed && percentage >= PASSING_SCORE,
  };
}

export function calculateQuizScore(answers = {}) {
  const correct = trainingModules.reduce((count, module) => (
    count + module.quizzes.reduce((moduleCount, quiz) => (
      getAnswer(answers, module.id, quiz.id) === quiz.answer ? moduleCount + 1 : moduleCount
    ), 0)
  ), 0);
  const total = trainingModules.length * QUIZ_BANK_SIZE_PER_MODULE;
  return {
    correct,
    total,
    percentage: total === 0 ? 0 : Math.round((correct / total) * 100),
  };
}

export function isModuleCertificateReady(moduleId, { watched = {}, answers = {}, selectedQuizIds = null } = {}) {
  const moduleAnswers = answers[moduleId] && typeof answers[moduleId] === "object"
    ? answers[moduleId]
    : Object.fromEntries(
      Object.entries(answers)
        .filter(([key]) => key.startsWith(`${moduleId}:`))
        .map(([key, value]) => [key.split(":")[1], value]),
    );
  return watched[moduleId] === true && calculateModuleQuizScore(moduleId, moduleAnswers, selectedQuizIds).passed;
}

export function isCertificateReady({ watched = {}, answers = {} } = {}) {
  const allWatched = requiredModuleIds.every((id) => watched[id] === true);
  const score = calculateQuizScore(answers);
  return allWatched && score.percentage >= PASSING_SCORE;
}

export function getModuleBySlug(slug) {
  return trainingModules.find((module) => module.slug === slug) || null;
}

export function selectModuleQuizzes(moduleId, random = Math.random) {
  const module = trainingModules.find((item) => item.id === moduleId);
  if (!module) return [];
  return shuffle(module.quizzes, random)
    .slice(0, QUIZ_DISPLAY_COUNT)
    .map((quiz) => ({
      ...quiz,
      options: shuffle(quiz.options, random),
    }));
}

function buildQuizzes(module) {
  return [
    makeQuestion("q1", module.primary.question, module.primary.correct, module.primary.wrong, "a"),
    makeQuestion(
      "q2",
      `${module.title}の研修後、日々の支援に取り入れるべきことはどれですか。`,
      module.practice,
      ["動画を見たら個別ケースでは確認しない", "担当者の経験だけで判断し、組織内では共有しない"],
      "b",
    ),
    makeQuestion(
      "q3",
      `${module.title}で避けるべき対応はどれですか。`,
      module.avoid,
      ["本人の状況を確認し、必要に応じて関係者と共有する", "支援方針を記録し、必要時に見直す"],
      "c",
    ),
    makeQuestion(
      "q4",
      `${module.title}の研修内容を実務に残す記録として適切なものはどれですか。`,
      module.record,
      ["受講した事実だけを残し、実務上の対応は記録しない", "気になった点は口頭だけで済ませ、記録は省略する"],
      "a",
    ),
    makeQuestion(
      "q5",
      `${module.title}を組織で継続するために必要なことはどれですか。`,
      module.sustain,
      ["一度研修を受けたら、その後の見直しは不要である", "担当者個人だけで判断し、チーム共有は行わない"],
      "b",
    ),
    makeQuestion(
      "q6",
      `${module.title}の研修内容を受講後にまず確認することはどれですか。`,
      "自事業所の手順や担当者と照らし合わせ、不足している点を確認する",
      ["研修動画を見た時点で実務への反映は完了とする", "制度名だけ覚えれば個別支援には反映しなくてよい"],
      "c",
    ),
    makeQuestion(
      "q7",
      `${module.title}について管理者やチームに共有すべき内容はどれですか。`,
      "実務で迷いやすい場面、対応手順、相談先",
      ["個人の感想だけで、対応手順には触れない", "共有すると負担が増えるため、担当者だけが把握する"],
      "a",
    ),
    makeQuestion(
      "q8",
      `${module.title}を利用者・家族対応に生かす際に大切な姿勢はどれですか。`,
      "本人の意向、生活状況、安全性を確認しながら選択肢を検討する",
      ["支援者の都合を優先し、説明は最小限にする", "一度決めた対応は状況が変わっても見直さない"],
      "b",
    ),
    makeQuestion(
      "q9",
      `${module.title}の理解を定着させる行動として適切なものはどれですか。`,
      "ケース会議や振り返りで、学んだ内容を実例に照らして確認する",
      ["研修資料を保管すれば、職員間での確認は不要である", "自分の担当外の事例は関係ないものとして扱う"],
      "c",
    ),
    makeQuestion(
      "q10",
      `${module.title}の小テストで間違いがあった場合の対応として適切なものはどれですか。`,
      "講義の該当箇所を見直し、必要に応じて管理者やチームに確認する",
      ["点数だけ確認し、講義の見直しは行わない", "正解を暗記して、実務との関係は考えない"],
      "a",
    ),
  ];
}

function makeQuestion(id, question, correct, wrong, answer) {
  const optionById = {
    a: answer === "a" ? correct : wrong[0],
    b: answer === "b" ? correct : answer === "a" ? wrong[0] : wrong[1],
    c: answer === "c" ? correct : wrong[1],
  };
  return {
    id,
    question,
    options: ["a", "b", "c"].map((optionId) => ({ id: optionId, label: optionById[optionId] })),
    answer,
  };
}

function getAnswer(answers, moduleId, quizId) {
  if (answers[moduleId] && typeof answers[moduleId] === "object") return answers[moduleId][quizId];
  return answers[`${moduleId}:${quizId}`];
}

function shuffle(items, random) {
  const copy = items.map((item) => ({ ...item }));
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
