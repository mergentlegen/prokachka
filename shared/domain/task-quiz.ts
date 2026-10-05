// Questions a mentor attaches to a task. The same rules check the editor in the browser and the server.
export type QuizKind = "single" | "multiple" | "text";
export type QuizQuestion = { id: string; kind: QuizKind; prompt: string; options?: string[]; correct?: number[] };
/** What a participant receives: never the correct choices. */
export type PublicQuizQuestion = Omit<QuizQuestion, "correct">;
export type QuizAnswer = { choice?: number[]; text?: string };
export type QuizAnswers = Record<string, QuizAnswer>;

export const QUIZ_LIMITS = { questions: 30, prompt: 500, options: 8, option: 200, text: 3000 } as const;
export const QUIZ_KIND_LABELS: Record<QuizKind, string> = { single: "Один верный ответ", multiple: "Несколько верных", text: "Открытый вопрос" };

const isChoice = (kind: QuizKind) => kind === "single" || kind === "multiple";

/** Checks and cleans a mentor's list. Returns the questions or the first problem in plain words. */
export function validateQuiz(input: unknown): { questions: QuizQuestion[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "Некорректный список вопросов." };
  if (input.length > QUIZ_LIMITS.questions) return { error: `Можно добавить не больше ${QUIZ_LIMITS.questions} вопросов.` };
  const seen = new Set<string>();
  const questions: QuizQuestion[] = [];
  for (const [index, raw] of input.entries()) {
    const number = index + 1;
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    if (!/^[a-z0-9-]{1,40}$/.test(id) || seen.has(id)) return { error: `Вопрос ${number}: внутренняя ошибка, удалите и добавьте его заново.` };
    seen.add(id);
    const kind = item.kind;
    if (kind !== "single" && kind !== "multiple" && kind !== "text") return { error: `Вопрос ${number}: выберите тип.` };
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (prompt.length < 2) return { error: `Вопрос ${number}: напишите текст вопроса.` };
    if (prompt.length > QUIZ_LIMITS.prompt) return { error: `Вопрос ${number}: текст длиннее ${QUIZ_LIMITS.prompt} символов.` };
    if (!isChoice(kind)) { questions.push({ id, kind, prompt }); continue; }
    const options = Array.isArray(item.options) ? item.options.map((option) => typeof option === "string" ? option.trim() : "") : [];
    if (options.length < 2) return { error: `Вопрос ${number}: добавьте хотя бы два варианта ответа.` };
    if (options.length > QUIZ_LIMITS.options) return { error: `Вопрос ${number}: не больше ${QUIZ_LIMITS.options} вариантов.` };
    if (options.some((option) => !option)) return { error: `Вопрос ${number}: заполните все варианты или удалите пустые.` };
    if (options.some((option) => option.length > QUIZ_LIMITS.option)) return { error: `Вопрос ${number}: вариант длиннее ${QUIZ_LIMITS.option} символов.` };
    if (new Set(options.map((option) => option.toLocaleLowerCase("ru"))).size !== options.length) return { error: `Вопрос ${number}: варианты повторяются.` };
    const correct = Array.isArray(item.correct) ? [...new Set(item.correct.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < options.length))].sort((a, b) => a - b) : [];
    if (!correct.length) return { error: `Вопрос ${number}: отметьте верный ответ.` };
    if (kind === "single" && correct.length !== 1) return { error: `Вопрос ${number}: в тесте с одним ответом верный вариант должен быть один.` };
    questions.push({ id, kind, prompt, options, correct });
  }
  return { questions };
}

export function publicQuiz(questions: QuizQuestion[]): PublicQuizQuestion[] {
  return questions.map(({ correct: _correct, ...question }) => question);
}

/** Keeps only answers that fit the questions; used for drafts, where blanks are allowed. */
export function cleanAnswers(questions: PublicQuizQuestion[], input: unknown): QuizAnswers {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const answers: QuizAnswers = {};
  for (const question of questions) {
    const raw = (source[question.id] && typeof source[question.id] === "object" ? source[question.id] : {}) as Record<string, unknown>;
    if (question.kind === "text") {
      if (typeof raw.text === "string" && raw.text.trim()) answers[question.id] = { text: raw.text.slice(0, QUIZ_LIMITS.text) };
      continue;
    }
    const count = question.options?.length || 0;
    const choice = Array.isArray(raw.choice) ? [...new Set(raw.choice.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < count))].sort((a, b) => a - b) : [];
    if (choice.length) answers[question.id] = { choice: question.kind === "single" ? choice.slice(0, 1) : choice };
  }
  return answers;
}

/** The first unanswered question, counted from 1, or 0 when everything is filled in. */
export function firstUnanswered(questions: PublicQuizQuestion[], answers: QuizAnswers) {
  const index = questions.findIndex((question) => question.kind === "text" ? !answers[question.id]?.text?.trim() : !answers[question.id]?.choice?.length);
  return index + 1;
}

/**
 * Scores the test part and writes the text the mentor reviews (also shown in the feedback thread).
 * It marks each chosen option right or wrong but never spells out the correct one, so it cannot be passed around.
 */
export function gradeQuiz(questions: QuizQuestion[], answers: QuizAnswers) {
  let score = 0, total = 0;
  const blocks: string[] = [];
  questions.forEach((question, index) => {
    const answer = answers[question.id] || {};
    const header = `${index + 1}. ${question.prompt}`;
    if (question.kind === "text") { blocks.push(`${header}\nОтвет: ${(answer.text || "").trim()}`); return; }
    total += 1;
    const chosen = answer.choice || [];
    const correct = question.correct || [];
    const right = chosen.length === correct.length && chosen.every((value, position) => value === correct[position]);
    if (right) score += 1;
    const lines = chosen.map((value) => `${correct.includes(value) ? "✓" : "✗"} ${question.options?.[value] ?? ""}`);
    blocks.push(`${header}\n${lines.join("\n")}${!right && question.kind === "multiple" && chosen.every((value) => correct.includes(value)) ? "\n(выбраны не все верные варианты)" : ""}`);
  });
  const summary = total ? `Тест: ${score} из ${total} верно` : "Ответы на вопросы";
  return { score, total, text: [summary, ...blocks].join("\n\n") };
}
