import assert from "node:assert/strict";
import test from "node:test";

import {
  PASSING_SCORE,
  QUIZ_BANK_SIZE_PER_MODULE,
  QUIZ_DISPLAY_COUNT,
  calculateQuizScore,
  calculateModuleQuizScore,
  isCertificateReady,
  isModuleCertificateReady,
  selectModuleQuizzes,
  requiredModuleIds,
  trainingModules,
} from "../src/data/houteiKenshu.mjs";

test("training modules include all videos and map harassment video to display number 02", () => {
  assert.equal(trainingModules.length, 13);
  assert.deepEqual(requiredModuleIds, trainingModules.map((module) => module.id));

  const harassment = trainingModules.find((module) => module.id === "harassment");
  assert.ok(harassment);
  assert.equal(harassment.displayNumber, "02");
  assert.equal(harassment.sourceFile, "10 ハラスメント対策（職場＋カスタマーハラスメント）.mp4");
  assert.equal(trainingModules[1].id, "harassment");

  assert.equal(trainingModules.some((module) => module.displayNumber === "10"), false);
});

test("each training module has ten quiz bank questions with three choices", () => {
  for (const module of trainingModules) {
    assert.equal(module.quizzes.length, QUIZ_BANK_SIZE_PER_MODULE, module.id);
    for (const quiz of module.quizzes) {
      assert.ok(quiz.id);
      assert.ok(quiz.question);
      assert.equal(quiz.options.length, 3);
      assert.ok(quiz.options.some((option) => option.id === quiz.answer));
    }
  }
});

test("selectModuleQuizzes returns five questions from the module bank and shuffles options", () => {
  const module = trainingModules[0];
  const selected = selectModuleQuizzes(module.id, () => 0);

  assert.equal(selected.length, QUIZ_DISPLAY_COUNT);
  assert.equal(new Set(selected.map((quiz) => quiz.id)).size, QUIZ_DISPLAY_COUNT);
  assert.ok(selected.every((quiz) => module.quizzes.some((bankQuiz) => bankQuiz.id === quiz.id)));

  const firstSelectedBankQuiz = module.quizzes.find((quiz) => quiz.id === selected[0].id);
  assert.notDeepEqual(
    selected[0].options.map((option) => option.id),
    firstSelectedBankQuiz.options.map((option) => option.id),
  );
  assert.deepEqual(
    [...selected[0].options.map((option) => option.id)].sort(),
    firstSelectedBankQuiz.options.map((option) => option.id).sort(),
  );
});

test("module quiz score requires exact answers for selected questions", () => {
  const module = trainingModules[0];
  const selectedQuizIds = module.quizzes.slice(0, QUIZ_DISPLAY_COUNT).map((quiz) => quiz.id);
  const correctAnswers = Object.fromEntries(module.quizzes.map((quiz) => [quiz.id, quiz.answer]));
  const score = calculateModuleQuizScore(module.id, correctAnswers, selectedQuizIds);
  assert.equal(score.correct, QUIZ_DISPLAY_COUNT);
  assert.equal(score.total, QUIZ_DISPLAY_COUNT);
  assert.equal(score.percentage, 100);
  assert.equal(score.completed, true);
  assert.equal(score.passed, true);

  const firstWrong = { ...correctAnswers, [module.quizzes[0].id]: "wrong-answer" };
  const failedScore = calculateModuleQuizScore(module.id, firstWrong, selectedQuizIds);
  assert.equal(failedScore.correct, QUIZ_DISPLAY_COUNT - 1);
  assert.equal(failedScore.completed, true);
  assert.equal(failedScore.passed, false);

  const incompleteScore = calculateModuleQuizScore(module.id, {}, selectedQuizIds);
  assert.equal(incompleteScore.completed, false);
  assert.equal(incompleteScore.passed, false);
});

test("overall quiz score still reflects all module question answers", () => {
  const correctAnswers = Object.fromEntries(
    trainingModules.flatMap((module) => (
      module.quizzes.map((quiz) => [`${module.id}:${quiz.id}`, quiz.answer])
    )),
  );
  const score = calculateQuizScore(correctAnswers);
  assert.equal(score.correct, trainingModules.length * QUIZ_BANK_SIZE_PER_MODULE);
  assert.equal(score.total, trainingModules.length * QUIZ_BANK_SIZE_PER_MODULE);
  assert.equal(score.percentage, 100);

  const firstWrong = { ...correctAnswers, [`${trainingModules[0].id}:${trainingModules[0].quizzes[0].id}`]: "wrong-answer" };
  const failedScore = calculateQuizScore(firstWrong);
  assert.equal(failedScore.correct, trainingModules.length * QUIZ_BANK_SIZE_PER_MODULE - 1);
  assert.ok(failedScore.percentage < PASSING_SCORE);
});

test("module certificate is ready after that module is complete and its quiz has passed", () => {
  const module = trainingModules[0];
  const selectedQuizIds = module.quizzes.slice(0, QUIZ_DISPLAY_COUNT).map((quiz) => quiz.id);
  const answers = Object.fromEntries(module.quizzes.map((quiz) => [quiz.id, quiz.answer]));

  assert.equal(isModuleCertificateReady(module.id, { watched: { [module.id]: true }, answers: { [module.id]: answers }, selectedQuizIds }), true);
  assert.equal(isModuleCertificateReady(module.id, { watched: { [module.id]: false }, answers: { [module.id]: answers }, selectedQuizIds }), false);
  assert.equal(isModuleCertificateReady(module.id, { watched: { [module.id]: true }, answers: { [module.id]: {} }, selectedQuizIds }), false);
});

test("legacy all-module certificate readiness still requires all modules", () => {
  const watched = Object.fromEntries(trainingModules.map((module) => [module.id, true]));
  const answers = Object.fromEntries(
    trainingModules.flatMap((module) => (
      module.quizzes.map((quiz) => [`${module.id}:${quiz.id}`, quiz.answer])
    )),
  );

  assert.equal(isCertificateReady({ watched, answers }), true);

  assert.equal(
    isCertificateReady({
      watched: { ...watched, [trainingModules[0].id]: false },
      answers,
    }),
    false,
  );

  assert.equal(
    isCertificateReady({
      watched,
      answers: { ...answers, [`${trainingModules[0].id}:${trainingModules[0].quizzes[0].id}`]: "wrong-answer" },
    }),
    false,
  );
});
