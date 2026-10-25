import { addProgramGame, createAdminProgram, reorderProgramSteps, updateAdminTask } from "@/frontend/shared/api/admin-client";
import { uploadTaskAttachment } from "@/frontend/shared/api/client";
import { uploadTaskVideo } from "@/frontend/shared/api/task-video-client";
import { saveTaskQuiz } from "@/frontend/shared/api/task-quiz-client";
import { validateQuiz, type QuizQuestion } from "@/shared/domain/task-quiz";
import type { ProgramGameKey, Task, TaskProgram } from "@/shared/domain/types";

/** A step as the builder hands it over: a normal task, or a ready game. */
export type PublishStep = {
  game?: ProgramGameKey; title: string; description: string; resourceUrl: string; maxPoints: number; voiceAnswer: boolean;
  files: File[]; video: File | null; questions: QuizQuestion[];
};
const defaultApi = { createAdminProgram, uploadTaskAttachment, updateAdminTask, saveTaskQuiz, uploadTaskVideo, addProgramGame, reorderProgramSteps };
export type PublishApi = typeof defaultApi;

/**
 * Publishes a new program in the order of the builder's list. The program is created with its normal steps; their
 * files, questions, voice answer and video follow; games are added after them; then the steps are put in order.
 * A failed extra (a file, a video) is reported in `failed` — the program itself stays published.
 */
export async function publishProgram(input: { title: string; deadlineHours: number; level: number; steps: PublishStep[] }, onProgress: (text: string) => void = () => undefined, api: PublishApi = defaultApi): Promise<{ program: TaskProgram; tasks: Task[]; failed: string[] }> {
  const normal = input.steps.filter((step) => !step.game);
  const created = await api.createAdminProgram({
    title: input.title, deadlineHours: input.deadlineHours, level: input.level,
    tasks: normal.map((step) => ({ title: step.title, description: step.description, resourceUrl: step.resourceUrl || null, maxPoints: step.maxPoints })),
  });
  const byPosition = [...created.tasks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const taskOf = new Map<PublishStep, Task>();
  normal.forEach((step, index) => { if (byPosition[index]) taskOf.set(step, byPosition[index]); });
  const failed: string[] = [];

  for (const [index, step] of input.steps.entries()) {
    let task = taskOf.get(step);
    if (!task) continue;
    const number = index + 1;
    for (const file of step.files) {
      try { onProgress(`Шаг ${number}: загружаем PDF…`); const attachment = await api.uploadTaskAttachment(task.id, file); task = { ...task, attachments: [...(task.attachments || []), attachment] }; }
      catch { failed.push(`PDF «${file.name}» (шаг ${number})`); }
    }
    if (step.voiceAnswer) {
      try { task = { ...task, ...await api.updateAdminTask(task.id, { voiceAnswer: true }), attachments: task.attachments }; }
      catch { failed.push(`голосовой ответ шага ${number}`); }
    }
    if (step.questions.length) {
      try {
        const checked = validateQuiz(step.questions);
        if ("error" in checked) throw new Error(checked.error);
        const stored = await api.saveTaskQuiz(task.id, checked.questions);
        task = { ...task, quiz: { questions: stored.length } };
      } catch { failed.push(`вопросы шага ${number}`); }
    }
    if (step.video) {
      try {
        onProgress(`Шаг ${number}: загружаем видео… 0%`);
        await api.uploadTaskVideo(task.id, step.video, (percentage) => onProgress(`Шаг ${number}: загружаем видео… ${percentage}%`));
        task = { ...task, video: { status: "processing", playable: false } };
      } catch { failed.push(`видео шага ${number}`); }
    }
    taskOf.set(step, task);
  }

  const added: string[] = [];
  for (const [index, step] of input.steps.entries()) {
    if (!step.game) continue;
    try { onProgress(`Шаг ${index + 1}: добавляем игру…`); const { task } = await api.addProgramGame(created.program.id, step.game); taskOf.set(step, task); added.push(task.id); }
    catch { failed.push(`игра «${step.title}»`); }
  }
  const order = input.steps.map((step) => taskOf.get(step)?.id).filter((id): id is string => Boolean(id));
  const saved = [...byPosition.map((task) => task.id), ...added];
  if (order.join() !== saved.join()) {
    try { onProgress("Сохраняем порядок шагов…"); await api.reorderProgramSteps(created.program.id, order); }
    catch { failed.push("порядок шагов"); }
  }
  const tasks = input.steps.map((step) => taskOf.get(step)).filter((task): task is Task => Boolean(task)).map((task, index) => ({ ...task, position: index + 1 }));
  return { program: created.program, tasks, failed };
}
