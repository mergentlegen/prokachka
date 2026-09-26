"use client";

import { useEffect, useRef, useState } from "react";
import { advanceReadyProgram, startReadyProgram, type ReadyAttempt } from "@/frontend/shared/api/ready-program-client";
import type { Submission } from "@/shared/domain/types";
import { ReadyProgramQuiz, type ReadyQuizQuestion } from "./ReadyProgramQuiz";
import quizStyles from "./DreamPlanGame.module.css";
import styles from "./StarterRulesGame.module.css";

export const STARTER_RULES_QUESTIONS: readonly ReadyQuizQuestion[] = [
  { title: "За что ты получаешь мили?", options: ["За каждого нового игрока в команде", "За знания и действия: уроки, квизы, задания", "За время, проведённое на сайте"], feedback: "Мили — за знания и действия. За новых игроков ты получаешь звёзды." },
  { title: "Сколько звёзд может принести один новый игрок в команде?", options: ["Всегда 1 звезду", "От 1 до 5 звёзд", "10 звёзд"], feedback: "Каждый новый игрок приносит от 1 до 5 звёзд: Starter — 1, Classic — 2, Premium — 5. Цель — 10 звёзд." },
  { title: "Чем «Задания» отличаются от «Программ»?", options: ["В готовых заданиях нет срока, а в программах есть дедлайн", "В готовых заданиях есть дедлайн, а в программах нет", "Ничем, это одно и то же"], feedback: "Готовые задания проходишь в своём темпе, а шаги программы — с персональными дедлайнами." },
  { title: "Зачем в игре дедлайн?", options: ["Чтобы наказать за опоздание", "Чтобы задать темп и за 14 дней выйти на первый результат", "Чтобы было сложнее"], feedback: "Дедлайн — не наказание, а темп. Он не даёт отложить «на потом»." },
  { title: "Тебе что-то непонятно в игре. Что делаешь?", options: ["Бросаю, раз не понимаю", "Жду, пока само прояснится", "Пишу наставнику — задавать вопросы тоже часть игры"], feedback: "Рядом твой наставник — человек, который пригласил тебя в игру. Обращаться за поддержкой — нормально." },
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

  return <section ref={section} className={`${quizStyles.game} ${styles.game}`} aria-label="Игра Правила игры">
    {quizOpen && attempt ? <ReadyProgramQuiz taskId={taskId} initialAttempt={attempt} questions={STARTER_RULES_QUESTIONS} onBack={() => setQuizOpen(false)} onCompleted={onCompleted} /> : <div className={styles.intro}>
      <header className={styles.hero}>
        <div className={styles.heroTop}><span>Старт новичка · 14 дней</span><span>Награда +5 миль</span></div>
        <svg className={styles.ship} viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M8 38h48l-9 14H17L8 38Z" fill="currentColor"/><path d="M20 38V25h24v13M29 25V14h6v11" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/><path d="M8 57q6-5 12 0t12 0t12 0t12 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
        <h4>Твой старт начинается здесь</h4><p>За 14 дней ты познакомишься с клубом и узнаешь, как в нём зарабатывают. Через игру, знания и свои первые шаги.</p>
      </header>
      <div className={styles.rewards}>
        <article className={`${styles.card} ${styles.miles}`}><span className={styles.icon} aria-hidden="true">↗</span><h5>Мили</h5><p>За знания и действия: уроки, квизы и задания.</p><strong>Цель — 100 миль</strong></article>
        <article className={`${styles.card} ${styles.stars}`}><span className={styles.icon} aria-hidden="true">★</span><h5>Звёзды</h5><p>За нового игрока в команде — от 1 до 5 звёзд.</p><strong>Цель — 10 звёзд</strong></article>
      </div>
      <article className={styles.card}><p className={styles.kicker}>Как устроено обучение</p><h5>Два пути — один результат</h5><div className={styles.tabs}>
        <div><span>Задания</span><p>Готовые игры — без срока выполнения. Узнай, что такое клуб и что он даёт тебе. Проходи в своём темпе.</p></div>
        <div><span>Программы</span><p>Шаги с дедлайнами. Первая неделя — про твою выгоду в клубе, вторая — про то, как в клубе зарабатывают.</p></div>
      </div></article>
      <article className={styles.card}><p className={styles.kicker}>Двигайся в своём ритме</p><h5>Дедлайн помогает держать темп</h5><p>Это не наказание: срок помогает не откладывать на потом и за 14 дней выйти на первый результат.</p></article>
      <article className={styles.card}><p className={styles.kicker}>Поддержка рядом</p><h5>Ты не один</h5><p>Твой наставник — человек, который пригласил тебя в игру. Если что-то непонятно, пиши ему. Задавать вопросы — тоже часть игры.</p></article>
      <article className={`${styles.card} ${styles.prize}`}><span className={styles.prizeIcon} aria-hidden="true">✦</span><p className={styles.kicker}>Главный приз</p><h5>100 миль + 10 звёзд</h5><p>Собери их за 14 дней, и твои звёзды превратятся в настоящий результат за чашкой кофе с личным наставником в красивом месте.</p><p className={styles.note}>Звёзды показывают, как работает вознаграждение в inCruises. Условия начисления бонусов ты разберёшь в «Программах».</p></article>
      <footer className={styles.start}><div><p className={styles.kicker}>Проверь себя</p><h5>5 вопросов — 5 миль</h5><p>Ответь на все вопросы верно и нажми «Завершить». Если ошибёшься, сможешь пройти тест заново.</p></div>
        {error && <div className={quizStyles.quizFailure} role="alert"><p>{error}</p>{!attempt && <button type="button" className={quizStyles.retry} onClick={() => void load()}>Повторить загрузку</button>}</div>}
        <button type="button" className={quizStyles.primary} disabled={!attempt || busy} onClick={() => void beginQuiz()}>{busy ? "Открываем тест…" : !attempt ? error ? "Игра пока недоступна" : "Загружаем прогресс…" : attempt.completed ? "Посмотреть результат" : attempt.step === 1 ? "Продолжить тест →" : "Перейти к тесту →"}</button>
        <span className={styles.noDeadline}>Эта игра без дедлайна. Прогресс сохраняется автоматически.</span>
      </footer>
    </div>}
  </section>;
}
