import { validMiles } from "@/shared/domain/miles";
import { validateQuiz, type QuizQuestion } from "@/shared/domain/task-quiz";

// One set of rules for every task form: a separate task, a step of a running program, a step of a new program.

/** What the mentor types in the task editor. Level and deadline belong only to a separate task. */
export type EditorValue = {
  title: string; description: string; resourceUrl: string; maxPoints: string; voiceAnswer: boolean;
  level: number; hasDeadline: boolean; deadline: string;
};

export const MILES_PRESETS = [2, 5, 10, 20] as const;
/** Time for each program step, in hours, as ready-made choices. */
export const STEP_DEADLINE_PRESETS: ReadonlyArray<readonly [number, string]> = [[24, "1 день"], [48, "2 дня"], [72, "3 дня"], [168, "Неделя"]];

export function validLink(value: string) {
  if (!value.trim()) return true;
  try { return value.trim().length <= 2000 && ["http:", "https:"].includes(new URL(value.trim()).protocol); }
  catch { return false; }
}

export type EditorField = "title" | "description" | "miles" | "link" | "quiz";
export type EditorProblem = { field: EditorField; message: string };

/** Everything that stops a task from being saved, in the order of the form. */
export function editorProblems(value: Pick<EditorValue, "title" | "description" | "maxPoints" | "resourceUrl">, questions: QuizQuestion[]): EditorProblem[] {
  const problems: EditorProblem[] = [];
  const title = value.title.trim(), description = value.description.trim();
  if (title.length < 2) problems.push({ field: "title", message: "нет названия" });
  else if (title.length > 160) problems.push({ field: "title", message: "название длиннее 160 знаков" });
  if (description.length < 2) problems.push({ field: "description", message: "нет описания" });
  else if (description.length > 5000) problems.push({ field: "description", message: "описание длиннее 5000 знаков" });
  if (!validLink(value.resourceUrl)) problems.push({ field: "link", message: "ссылка должна начинаться с http:// или https://" });
  if (!value.maxPoints.trim() || !validMiles(Number(value.maxPoints))) problems.push({ field: "miles", message: "укажите мили целым числом" });
  if (questions.length) {
    const checked = validateQuiz(questions);
    if ("error" in checked) problems.push({ field: "quiz", message: checked.error });
  }
  return problems;
}

/** «1 день», «3 дня», «Неделя», «36 часов». */
export function deadlineLabel(hours: number) {
  const preset = STEP_DEADLINE_PRESETS.find(([value]) => value === hours);
  if (preset) return preset[1];
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days % 10 === 1 && days % 100 !== 11 ? "день" : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20) ? "дня" : "дней"}`;
  }
  return `${hours} ${hours % 10 === 1 && hours % 100 !== 11 ? "час" : hours % 10 >= 2 && hours % 10 <= 4 && (hours % 100 < 10 || hours % 100 >= 20) ? "часа" : "часов"}`;
}

/** Questions copied from another task get new ids, so the two tasks never share one. */
export function freshQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  return questions.map((question) => ({ ...question, id: crypto.randomUUID(), options: question.options ? [...question.options] : undefined, correct: question.correct ? [...question.correct] : undefined }));
}
