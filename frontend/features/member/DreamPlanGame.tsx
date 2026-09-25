"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatMiles } from "@/frontend/shared/lib/format";
import { advanceReadyProgram, answerReadyProgram, completeReadyProgram, restartReadyProgramQuiz, startReadyProgram } from "@/frontend/shared/api/ready-program-client";
import type { Submission } from "@/shared/domain/types";
import styles from "./DreamPlanGame.module.css";

const MAX_MONTHS = 12;
const months = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const expenses: Record<number, [string, number]> = {
  2: ["Новая куртка", 120], 3: ["Новый телефон", 250], 5: ["Подарок на день рождения", 150],
  7: ["Распродажа", 200], 8: ["Лечение зуба", 180], 9: ["Ремонт машины", 300], 11: ["Новый год", 150],
};

type AttemptStatus = "loading" | "active" | "completed" | "error";
type QuizQuestion = { eyebrow: string; title: string; description: string; metric?: string; options: readonly string[]; feedback: string };

const QUIZ_TOTAL = 5;
const questions: readonly QuizQuestion[] = [
  {
    eyebrow: "Блок 1 · Постоянство",
    title: "Что быстрее приведёт к круизу?",
    description: "Каждый месяц — это одно звено в цепочке к мечте.",
    options: ["Большой платёж, когда «появятся деньги»", "Регулярная проплата каждый месяц", "Подождать подходящего момента"],
    feedback: "Мечту строят не рывком, а регулярностью: каждая проплата — ещё одно звено к круизу.",
  },
  {
    eyebrow: "Блок 2 · Баллы удваиваются",
    title: "Ты внёс(ла) $100 в клуб. Сколько баллов получишь?",
    description: "В клубе накопления направлены на конкретную цель.",
    metric: "$100  →  ?",
    options: ["100 баллов", "150 баллов", "200 баллов"],
    feedback: "$100 превращаются в 200 баллов — клуб удваивает твои накопления.",
  },
  {
    eyebrow: "Блок 3 · Верность цели",
    title: "Месяц выдался трудным, и хочется всё бросить. Что приведёт к мечте?",
    description: "Трудные месяцы бывают у всех. Важно, что ты выбираешь в такой момент.",
    options: ["Отказаться от мечты — наверное, она не для меня", "Вспомнить, ради чего начал(а), и сохранить проплату", "Потратить отложенное на что-то срочное"],
    feedback: "Цель держит тебя, когда мотивации мало. Верность своей мечте и приводит на палубу.",
  },
  {
    eyebrow: "Блок 4 · Конкретная мечта",
    title: "Какая цель сбудется быстрее?",
    description: "У мечты с датой и маршрутом есть срок — и каждая проплата видна как шаг к ней.",
    options: ["«Когда-нибудь съезжу в круиз»", "«Отдохнуть получше в следующем году»", "«Круиз по Средиземному морю в июне следующего года»"],
    feedback: "У мечты с датой и маршрутом есть срок. «Когда-нибудь» обычно не наступает.",
  },
  {
    eyebrow: "Блок 5 · Не один(одна) на пути",
    title: "Что поможет не сойти с пути, когда мотивации мало?",
    description: "Поддержка превращает длинный маршрут в путь, который хочется пройти.",
    options: ["Справляться молча и никому не говорить о цели", "Ждать, когда вдохновение вернётся само", "Поделиться целью с близким человеком и идти к ней вместе"],
    feedback: "Когда о твоей мечте знает кто-то рядом, ты не один(одна). Вместе копить веселее — и путешествовать тоже.",
  },
];

function savingsAt(month: number) {
  let savings = 0;
  for (let index = 1; index <= month; index += 1) savings = Math.max(0, savings + 100 - (expenses[index]?.[1] || 0));
  return savings;
}

export function DreamPlanGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const gameSection = useRef<HTMLElement>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const feedbackId = useId();
  const [stage, setStage] = useState<"route" | "quiz">("route");
  const [attemptStatus, setAttemptStatus] = useState<AttemptStatus>("loading");
  const [month, setMonth] = useState(0);
  const [selfSavings, setSelfSavings] = useState(0);
  const [clubBonusPoints, setClubBonusPoints] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answeredCorrectly, setAnsweredCorrectly] = useState(false);
  const [answeredIncorrectly, setAnsweredIncorrectly] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [nextQuestionIndex, setNextQuestionIndex] = useState<number | null>(null);
  const [readyForCompletion, setReadyForCompletion] = useState(false);
  const [lastExpense, setLastExpense] = useState<[string, number] | null>(null);
  const [earnedPoints, setEarnedPoints] = useState(0);
  const [maxPoints, setMaxPoints] = useState(5);
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void startReadyProgram(taskId).then((attempt) => {
      if (cancelled) return;
      const restoredMonth = Math.min(MAX_MONTHS, attempt.step);
      const restoredQuestion = Math.min(QUIZ_TOTAL - 1, attempt.questionIndex);
      const completed = attempt.status === "completed";
      const failed = Boolean(attempt.failed);
      setMonth(restoredMonth); setSelfSavings(savingsAt(restoredMonth)); setClubBonusPoints(restoredMonth * 200); setLastExpense(expenses[restoredMonth] || null);
      setQuestionIndex(restoredQuestion); setSelectedAnswer(failed ? attempt.lastAnswer ?? null : completed || Boolean(attempt.ready) ? 2 : null); setAnsweredCorrectly(completed || Boolean(attempt.ready)); setAnsweredIncorrectly(failed); setQuizError(failed ? "Этот вариант неверный. Пройди тест заново, чтобы набрать все 5 миль." : ""); setNextQuestionIndex(null);
      setReadyForCompletion(completed || Boolean(attempt.ready)); setEarnedPoints(attempt.earnedPoints); setMaxPoints(attempt.maxPoints || QUIZ_TOTAL); setAttemptStatus(attempt.status);
      setStage(restoredMonth === MAX_MONTHS ? "quiz" : "route");
    }).catch((error) => {
      if (cancelled) return;
      setAttemptStatus("error"); setSyncError(error instanceof Error ? error.message : "Не удалось загрузить прогресс программы.");
    });
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => {
    gameSection.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
    if (stage === "quiz") questionHeading.current?.focus({ preventScroll: true });
  }, [stage, questionIndex, attemptStatus]);

  const calendar = useMemo(() => months.map((name, index) => ({ name, state: index === month - 1 ? "monthCurrent" : index < month ? "monthDone" : "" })), [month]);
  const finished = month === MAX_MONTHS;
  const shipPosition = Math.min(93, 7 + Math.round((clubBonusPoints / 2400) * 86));
  const question = questions[questionIndex] || questions[0];

  function resetLocal(nextStatus: AttemptStatus = "active") {
    setAttemptStatus(nextStatus); setStage("route"); setMonth(0); setSelfSavings(0); setClubBonusPoints(0); setQuestionIndex(0); setSelectedAnswer(null); setAnsweredCorrectly(false); setAnsweredIncorrectly(false); setQuizError(""); setNextQuestionIndex(null); setReadyForCompletion(false); setLastExpense(null); setEarnedPoints(0);
  }

  function resetQuizLocal() {
    setAttemptStatus("active"); setQuestionIndex(0); setSelectedAnswer(null); setAnsweredCorrectly(false); setAnsweredIncorrectly(false); setQuizError(""); setNextQuestionIndex(null); setReadyForCompletion(false); setEarnedPoints(0);
    requestAnimationFrame(() => {
      gameSection.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
      questionHeading.current?.focus({ preventScroll: true });
    });
  }

  async function nextMonth() {
    if (busy || attemptStatus !== "active" || month >= MAX_MONTHS) return;
    const nextMonthNumber = month + 1;
    setBusy(true); setSyncError("");
    try {
      await advanceReadyProgram(taskId, nextMonthNumber);
      setMonth(nextMonthNumber); setSelfSavings(savingsAt(nextMonthNumber)); setClubBonusPoints(nextMonthNumber * 200); setLastExpense(expenses[nextMonthNumber] || null);
    } catch (error) { setSyncError(error instanceof Error ? error.message : "Не удалось сохранить шаг."); }
    finally { setBusy(false); }
  }

  async function selectAnswer(index: number) {
    if (busy || attemptStatus !== "active" || !finished || answeredCorrectly || answeredIncorrectly) return;
    setBusy(true); setSyncError(""); setQuizError(""); setSelectedAnswer(index);
    try {
      const result = await answerReadyProgram(taskId, index);
      setMaxPoints(result.maxPoints || maxPoints); setEarnedPoints(result.earnedPoints);
      setSelectedAnswer(index);
      if (result.failed) { setAnsweredIncorrectly(true); setReadyForCompletion(false); setNextQuestionIndex(null); setQuizError(result.message || "Этот вариант неверный. Пройди тест заново, чтобы набрать все 5 миль."); }
      else { setAnsweredCorrectly(true); setReadyForCompletion(Boolean(result.ready)); setNextQuestionIndex(result.ready ? null : result.questionIndex); }
    } catch (error) { setSelectedAnswer(null); setQuizError(error instanceof Error ? error.message : "Не удалось проверить ответ."); }
    finally { setBusy(false); }
  }

  async function retryQuiz() {
    if (busy || !answeredIncorrectly || attemptStatus !== "active") return;
    setBusy(true); setQuizError("");
    try { await restartReadyProgramQuiz(taskId); resetQuizLocal(); }
    catch (error) { setQuizError(error instanceof Error ? error.message : "Не удалось начать тест заново."); }
    finally { setBusy(false); }
  }

  function goToNextQuestion() {
    if (nextQuestionIndex === null || busy) return;
    setQuestionIndex(Math.min(QUIZ_TOTAL - 1, nextQuestionIndex)); setSelectedAnswer(null); setAnsweredCorrectly(false); setAnsweredIncorrectly(false); setQuizError(""); setNextQuestionIndex(null);
  }

  async function finish() {
    if (busy || attemptStatus !== "active" || !readyForCompletion) return;
    setBusy(true); setQuizError("");
    try {
      const result = await completeReadyProgram(taskId);
      setAttemptStatus("completed"); setEarnedPoints(result.earnedPoints); setMaxPoints(result.maxPoints || maxPoints);
      if (result.submission) onCompleted?.(result.submission);
    } catch (error) { setQuizError(error instanceof Error ? error.message : "Не удалось завершить программу."); }
    finally { setBusy(false); }
  }

  async function restart() {
    if (busy || attemptStatus === "completed") return;
    setBusy(true); setSyncError("");
    try { await startReadyProgram(taskId, true); resetLocal(); }
    catch (error) { setSyncError(error instanceof Error ? error.message : "Не удалось начать новую попытку."); }
    finally { setBusy(false); }
  }

  return <section ref={gameSection} className={styles.game} aria-label="Интерактивная игра Мечта с планом">
    {stage === "route" ? <div className={styles.route}>
      <header className={styles.gameHeader}>
        <div className={styles.stageLine}><span className={styles.kicker}>01 / Путь к мечте</span><span className={styles.reward}>Игра + тест · {formatMiles(maxPoints)}</span></div>
        <h4>Круиз: сама или через клуб?</h4>
        <p>Два пути к одной мечте. Листай месяцы и смотри, какой путь доведёт до палубы.</p>
      </header>
      <div className={styles.sea} aria-hidden="true">
        <span>Круиз</span>
        <svg className={styles.ship} style={{ left: `${shipPosition}%` }} viewBox="0 0 46 40"><path d="M6 26h34l-5 9H11z" fill="currentColor" /><rect x="14" y="16" width="18" height="10" rx="2" fill="var(--blue)" /><rect x="20" y="8" width="5" height="8" fill="var(--gold)" /></svg>
        <svg className={styles.wave} viewBox="0 0 400 30" preserveAspectRatio="none"><path d="M0 14 Q25 4 50 14 T100 14 T150 14 T200 14 T250 14 T300 14 T350 14 T400 14 V30 H0z" fill="currentColor" /></svg>
      </div>
      <div className={styles.timeline}>
        <div className={styles.progressHead}><span>Цель — круиз за $1200</span><b aria-live="polite">Месяц {month} из {MAX_MONTHS}</b></div>
        <div className={styles.calendar} aria-label="Прогресс по месяцам">{calendar.map((item) => <span className={`${styles.month} ${item.state ? styles[item.state] : ""}`} aria-current={item.state === "monthCurrent" ? "step" : undefined} key={item.name}>{item.name}</span>)}</div>
      </div>
      <div className={styles.compare}>
        <article className={`${styles.path} ${styles.self}`}>
          <header><h5>Путь «Сама»</h5><p>«Куплю через год-два»</p></header>
          <div className={styles.balance}><strong>${selfSavings}</strong><span>накоплено</span></div>
          <p className={styles.deposit}>+$100 в месяц</p>
          <div className={styles.savingsTrack} role="progressbar" aria-label="Накопления самостоятельно" aria-valuemin={0} aria-valuemax={1200} aria-valuenow={Math.min(1200, selfSavings)}><span style={{ width: `${Math.min(100, selfSavings / 12)}%` }} /></div>
          <p className={`${styles.pathNote} ${lastExpense ? styles.expenseNote : ""}`}>{lastExpense ? `${lastExpense[0]}: −$${lastExpense[1]}` : month ? "В этом месяце без непредвиденных трат" : "Жизненные траты могут отдалить цель"}</p>
        </article>
        <article className={`${styles.path} ${styles.club}`}>
          <header><h5>Путь «Клуб»</h5><p>«Коплю в клубе»</p></header>
          <div className={styles.balance}><strong>{clubBonusPoints}</strong><span>бонусных баллов</span></div>
          <p className={styles.deposit}>$100 → 200 баллов</p>
          <div className={styles.savingsTrack} role="progressbar" aria-label="Накопления в клубе" aria-valuemin={0} aria-valuemax={1200} aria-valuenow={Math.min(1200, clubBonusPoints)}><span style={{ width: `${Math.min(100, clubBonusPoints / 12)}%` }} /></div>
          <p className={styles.pathNote}>{clubBonusPoints >= 2400 ? "Хватает на круиз вдвоём" : clubBonusPoints >= 1200 ? "Уже хватает на круиз!" : "+200 баллов каждый месяц"}</p>
        </article>
      </div>
      <p className={styles.same}>На обоих путях откладывают по $100 в месяц. В клубе деньги направлены на мечту.</p>
      {finished && <div className={styles.yearResult} role="status"><strong>12 месяцев — два разных результата</strong><p>Самостоятельно осталось ${selfSavings}. В клубе накоплено {clubBonusPoints} бонусных баллов. Теперь пройди 5 вопросов и получи мили за программу.</p></div>}
      {syncError && <div className={styles.error} role="alert">{syncError}</div>}
      <div className={styles.controls}>
        <button type="button" className={styles.primary} onClick={() => finished ? setStage("quiz") : void nextMonth()} disabled={busy || attemptStatus === "loading" || attemptStatus === "error"}>{attemptStatus === "loading" ? "Загружаем прогресс…" : busy ? "Сохраняем…" : finished ? attemptStatus === "completed" ? "Посмотреть результат" : "Перейти к тесту →" : "Следующий месяц"}</button>
        <button type="button" className={styles.reset} onClick={() => void restart()} disabled={busy || attemptStatus === "loading" || attemptStatus === "completed"} aria-label="Начать игру заново" title="Начать игру заново"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></svg></button>
      </div>
    </div> : <div className={styles.quiz}>
      <div className={styles.stageLine}><button type="button" className={styles.back} onClick={() => setStage("route")} disabled={busy}>← К маршруту</button><span className={styles.reward}>Награда · {formatMiles(maxPoints)}</span></div>
      {attemptStatus === "completed" ? <div className={styles.completed} role="status">
        <span className={styles.resultIcon} aria-hidden="true">✓</span>
        <p className={styles.kicker}>Мечта стала ближе</p>
        <h4 ref={questionHeading} tabIndex={-1}>Программа пройдена!</h4>
        <strong className={styles.resultMiles}>+{formatMiles(earnedPoints)}</strong>
        <p>Все ответы верные. Мили начислены и добавлены в твой общий рейтинг.</p>
        <span className={styles.resultHint}>Можно закрыть окно и продолжить обучение.</span>
      </div> : <>
        <div className={styles.quizProgress}>
          <div className={styles.progressHead}><b>Вопрос {questionIndex + 1} из {QUIZ_TOTAL}</b><span>{earnedPoints} / {formatMiles(maxPoints)}</span></div>
          <div className={styles.quizSteps} aria-label={`Отвечено ${earnedPoints} из ${QUIZ_TOTAL} вопросов`}>{questions.map((item, index) => <span className={index < earnedPoints ? styles.stepDone : index === questionIndex ? answeredIncorrectly ? styles.stepFailed : styles.stepCurrent : ""} key={item.eyebrow} />)}</div>
        </div>
        <div className={styles.question}>
          <p className={styles.kicker}>{question.eyebrow}</p>
          <h4 ref={questionHeading} id={`${feedbackId}-question`} tabIndex={-1}>{question.title}</h4>
          <p className={styles.questionDescription}>{question.description}</p>
          {question.metric && <div className={styles.metric}>{question.metric}</div>}
          <div className={styles.options} role="group" aria-labelledby={`${feedbackId}-question`}>{question.options.map((answer, index) => {
            const selected = selectedAnswer === index;
            const resultClass = selected ? answeredIncorrectly ? styles.incorrect : answeredCorrectly ? styles.correct : styles.checking : "";
            return <button type="button" className={`${styles.option} ${resultClass}`} onClick={() => void selectAnswer(index)} disabled={busy || attemptStatus !== "active" || answeredCorrectly || answeredIncorrectly} aria-pressed={selected} aria-describedby={selected && (answeredCorrectly || answeredIncorrectly) ? feedbackId : undefined} key={answer}>
              <span className={styles.optionLetter} aria-hidden="true">{["А", "Б", "В"][index]}</span><span>{answer}</span><span className={styles.optionMark} aria-hidden="true">{selected && answeredIncorrectly ? "×" : selected && answeredCorrectly ? "✓" : ""}</span>
            </button>;
          })}</div>
          {busy && !answeredCorrectly && !answeredIncorrectly && <p className={styles.checkingText} role="status">Проверяем ответ…</p>}
          {answeredCorrectly && <div id={feedbackId} className={styles.quizSuccess} role="status"><strong>Верно! +1 миля</strong><p>{question.feedback}</p></div>}
          {(answeredIncorrectly || quizError) && <div id={answeredIncorrectly ? feedbackId : undefined} className={styles.quizFailure} role="alert"><strong>{answeredIncorrectly ? "Пока не верно. Попробуем ещё раз?" : "Не удалось сохранить результат"}</strong><p>{quizError}</p>{answeredIncorrectly && <button type="button" className={styles.retry} onClick={() => void retryQuiz()} disabled={busy}>{busy ? "Подготавливаем тест…" : "Пройти заново"}</button>}</div>}
          {nextQuestionIndex !== null && <button type="button" className={styles.primary} onClick={goToNextQuestion}>Следующий вопрос →</button>}
          {readyForCompletion && <div className={styles.finishAction}><p>Все 5 ответов верные. Осталось забрать награду.</p><button type="button" className={styles.primary} onClick={() => void finish()} disabled={busy}>{busy ? "Начисляем мили…" : `Завершить и получить ${formatMiles(maxPoints)}`}</button></div>}
          {!answeredCorrectly && !answeredIncorrectly && <p className={styles.quizHint}>Выбери один ответ. Для награды нужны все 5 верных ответов.</p>}
        </div>
      </>}
    </div>}
  </section>;
}
