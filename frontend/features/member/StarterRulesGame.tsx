"use client";

import { useEffect, useRef, useState } from "react";
import { advanceReadyProgram, startReadyProgram, type ReadyAttempt } from "@/frontend/shared/api/ready-program-client";
import type { Submission } from "@/shared/domain/types";
import { MaterialBar } from "./GameMaterial";
import { ReadyProgramQuiz, type ReadyQuizQuestion } from "./ReadyProgramQuiz";
import quizStyles from "./DreamPlanGame.module.css";
import styles from "./StarterRulesGame.module.css";

// The answer key lives on the server (app_ready_program_spec, migration 20261110): the right option of each
// question by its index in `options` — [0, 1, 0, 0, 0]. The quiz shows options in a random order.
export const STARTER_RULES_QUESTIONS: readonly ReadyQuizQuestion[] = [
  { title: "За что ты получаешь мили?", options: ["За обучение и задания", "За результат: новых игроков в команде", "За время, проведённое на сайте"], feedback: "Мили — за обучение. В заданиях можно собрать 100 миль." },
  { title: "За что ты получаешь звёзды?", options: ["За прохождение уроков", "За реальный результат", "За вход на платформу каждый день"], feedback: "Звёзды — за результат. Максимум 10 звёзд." },
  { title: "Что показывает XP?", options: ["Твой настоящий прогресс", "Только сколько уроков ты прошёл", "Сколько времени ты провёл на сайте"], feedback: "XP — твой настоящий прогресс: учёба и результат вместе." },
  { title: "Какая у тебя цель в игре?", options: ["Набрать 300 XP", "Просто пройти один урок", "Дождаться, пока наставник сделает всё за меня"], feedback: "Цель — набрать 300 XP." },
  { title: "Что нужно, чтобы Асель лично вела твой путь и давала консультации?", options: ["Постоянно быть активным на платформе и учиться", "Один раз зайти и больше не появляться", "Ничего не делать, всё произойдёт само"], feedback: "Асель ведёт твой результат, если ты постоянно проявляешь активность и учишься." },
];

export function StarterRulesGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [attempt, setAttempt] = useState<ReadyAttempt | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const section = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    try {
      const saved = await startReadyProgram(taskId);
      if (version !== loadVersion.current) return;
      setError(""); setAttempt(saved); setQuizOpen(saved.step === 1 || saved.completed);
    } catch (cause) { if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : "Не удалось загрузить игру."); }
  }

  useEffect(() => {
    const version = ++loadVersion.current;
    void startReadyProgram(taskId).then((saved) => {
      if (version !== loadVersion.current) return;
      setError(""); setAttempt(saved); setQuizOpen(saved.step === 1 || saved.completed);
    }).catch((cause) => {
      if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : "Не удалось загрузить игру.");
    });
    return () => { loadVersion.current += 1; };
  }, [taskId]);

  useEffect(() => { section.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" }); }, [quizOpen]);

  async function beginQuiz() {
    if (!attempt || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const saved = attempt.step === 1 || attempt.completed ? await startReadyProgram(taskId) : await advanceReadyProgram(taskId, 1);
      setAttempt(saved); setQuizOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось начать тест."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const reviewing = Boolean(attempt?.completed);
  return <section ref={section} className={`${quizStyles.game} ${styles.game}`} aria-label="Игра Правила игры">
    {quizOpen && attempt ? <ReadyProgramQuiz taskId={taskId} initialAttempt={attempt} questions={STARTER_RULES_QUESTIONS} onBack={() => setQuizOpen(false)} onMaterial={() => setQuizOpen(false)} onCompleted={onCompleted} /> : <div className={styles.intro}>
      {reviewing && <MaterialBar onBack={() => setQuizOpen(true)} />}
      <header className={styles.hero}>
        <div className={styles.heroTop}><span>🚢 Старт новичка</span><span>Награда +5 миль</span></div>
        <h4>Правила игры «Старт новичка»</h4><p>Учись, действуй, набирай XP.</p>
      </header>
      <div className={styles.rewards}>
        <article className={`${styles.card} ${styles.miles}`}><span className={styles.icon} aria-hidden="true">✈️</span><h5>Мили — за обучение</h5><p>В заданиях можно собрать 100 миль.</p></article>
        <article className={`${styles.card} ${styles.stars}`}><span className={styles.icon} aria-hidden="true">⭐</span><h5>Звёзды — за результат</h5><p>Максимум 10 звёзд.</p></article>
      </div>
      <article className={`${styles.card} ${styles.xp}`}><span className={styles.icon} aria-hidden="true">⚡️</span><h5>XP — твой настоящий прогресс</h5></article>
      <article className={`${styles.card} ${styles.goal}`}><h5>🎯 Цель — набрать 300 XP</h5></article>
      <article className={`${styles.card} ${styles.welcome}`}>
        <h5>Радуйся: ты счастливчик! 🎉</h5>
        <p>Ты в команде, у которой есть своя платформа. Её лично разработала твой исполнительный директор Асель Баялинова, чтобы учить и растить именно твою команду.</p>
        <p>Асель лично ведёт твой путь и твой результат и даёт тебе консультации. Условие одно: ты постоянно проявляешь активность на платформе и учишься.</p>
        <p className={styles.motto}>Учись, действуй, набирай XP. Будь крут и будь счастлив. Ты в нужном месте. 🚀</p>
      </article>
      <footer className={styles.start}><div><p className={styles.kicker}>Проверь себя</p><h5>5 вопросов — 5 миль</h5><p>За каждый верный ответ — 1 миля. Ответь на все вопросы верно и нажми «Завершить». Если ошибёшься, сможешь пройти тест заново.</p></div>
        {error && <div className={quizStyles.quizFailure} role="alert"><p>{error}</p>{!attempt && <button type="button" className={quizStyles.retry} onClick={() => void load()}>Повторить загрузку</button>}</div>}
        <button type="button" className={quizStyles.primary} disabled={!attempt || busy} onClick={() => void beginQuiz()}>{busy ? "Открываем тест…" : !attempt ? error ? "Игра пока недоступна" : "Загружаем прогресс…" : attempt.completed ? "К результату →" : attempt.step === 1 ? "Продолжить тест →" : "Перейти к тесту →"}</button>
        <span className={styles.noDeadline}>Эта игра без дедлайна. Прогресс сохраняется автоматически.</span>
      </footer>
    </div>}
  </section>;
}
