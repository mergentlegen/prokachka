"use client";

import { useEffect, useId, useRef, useState } from "react";
import { COMPANY_ANSWER_OPTIONS, COMPANY_CARDS, COMPANY_PHRASE_BANK, COMPANY_QUESTIONS, COMPANY_STORY_PARTS, COMPANY_VOYAGE_REWARD, COMPANY_VOYAGE_TITLE } from "@/shared/domain/company-voyage";
import { advanceReadyProgram, answerReadyProgram, completeReadyProgram, createCompanyVoiceLink, restartReadyProgramQuiz, saveCompanyStory, startReadyProgram, type ReadyAttempt } from "@/frontend/shared/api/ready-program-client";
import { ApiError, createTelegramLink } from "@/frontend/shared/api/client";
import type { Submission } from "@/shared/domain/types";
import styles from "./CompanyVoyageGame.module.css";

type View = "intro" | "cards" | "quiz" | "bank" | "story";

export function CompanyVoyageGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [attempt, setAttempt] = useState<ReadyAttempt | null>(null);
  const [view, setView] = useState<View>("intro");
  const [cardIndex, setCardIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [choices, setChoices] = useState<(number | null)[]>([null, null, null]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkRequired, setLinkRequired] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const inFlight = useRef(false);
  const version = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const feedbackId = useId();
  const card = COMPANY_CARDS[cardIndex];
  const question = COMPANY_QUESTIONS[questionIndex];
  const storyReady = choices.every((choice, index) => choice !== null && COMPANY_STORY_PARTS[index].options[choice] !== undefined);
  const storyText = "Я хочу рассказать тебе о компании, в которой я теперь…\n\n" + COMPANY_STORY_PARTS.map((part, index) => choices[index] !== null ? part.options[choices[index]!] : "").join("\n\n");
  const progress = view === "intro" ? 0 : view === "cards" ? (cardIndex + 1) / COMPANY_CARDS.length * 35 : view === "quiz" ? 35 + (attempt?.answeredQuestions ?? 0) / COMPANY_QUESTIONS.length * 55 : 100;

  useEffect(() => {
    const current = ++version.current;
    void startReadyProgram(taskId).then((saved) => {
      if (current !== version.current) return;
      setAttempt(saved); setError("");
      setCardIndex(Math.min(COMPANY_CARDS.length - 1, saved.step));
      setQuestionIndex(Math.min(COMPANY_QUESTIONS.length - 1, saved.questionIndex));
      setSelected(saved.failed || saved.ready ? saved.lastAnswer ?? null : null);
      setFeedback(saved.failed ? "incorrect" : saved.ready ? "correct" : "");
      setChoices(saved.storyChoices || [null, null, null]);
      setView(saved.completed ? "bank" : saved.step === COMPANY_CARDS.length ? "quiz" : saved.step > 0 ? "cards" : "intro");
    }).catch((cause) => { if (current === version.current) setError(cause instanceof Error ? cause.message : "Не удалось загрузить игру."); });
    return () => { version.current = current + 1; };
  }, [taskId, loadKey]);

  useEffect(() => {
    heading.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, [view, cardIndex, questionIndex]);

  async function run(action: () => Promise<ReadyAttempt>, success?: (saved: ReadyAttempt) => void) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    const current = version.current;
    try {
      const saved = await action();
      if (current !== version.current) return;
      setAttempt(saved); success?.(saved);
    } catch (cause) {
      if (current === version.current) setError(cause instanceof Error ? cause.message : "Не удалось сохранить прогресс. Повтори попытку.");
    } finally { inFlight.current = false; if (current === version.current) setBusy(false); }
  }

  function openQuiz() {
    if (!attempt) return;
    setQuestionIndex(Math.min(COMPANY_QUESTIONS.length - 1, attempt.questionIndex));
    setSelected(attempt.failed || attempt.ready ? attempt.lastAnswer ?? null : null);
    setFeedback(attempt.failed ? "incorrect" : attempt.ready ? "correct" : "");
    setView(attempt.completed ? "bank" : "quiz"); setError("");
  }

  function nextCard() {
    if (!attempt || busy) return;
    const next = () => cardIndex === COMPANY_CARDS.length - 1 ? openQuiz() : setCardIndex(cardIndex + 1);
    if (cardIndex < attempt.step) { next(); return; }
    void run(() => advanceReadyProgram(taskId, cardIndex + 1), (saved) => {
      if (saved.step === COMPANY_CARDS.length) { setView("quiz"); setQuestionIndex(saved.questionIndex); setFeedback(""); setSelected(null); }
      else setCardIndex(cardIndex + 1);
    });
  }

  function answer(index: number) {
    if (!attempt || inFlight.current || feedback || attempt.completed) return;
    setSelected(index);
    void run(() => answerReadyProgram(taskId, index, questionIndex), (saved) => setFeedback(saved.failed ? "incorrect" : "correct"));
  }

  function retry() {
    if (!attempt?.failed) return;
    void run(() => restartReadyProgramQuiz(taskId), () => { setQuestionIndex(0); setSelected(null); setFeedback(""); });
  }

  function finish() {
    if (!attempt?.ready || attempt.completed) return;
    void run(async () => {
      const saved = await completeReadyProgram(taskId);
      if (!saved.completed || !saved.submission) throw new Error("Не удалось подтвердить начисление миль. Повтори попытку.");
      return saved;
    }, (saved) => { setView("bank"); onCompleted?.(saved.submission!); });
  }

  async function share(copy = false) {
    if (!storyReady || inFlight.current) return;
    setError(""); setNotice("");
    try {
      if (!copy && navigator.share) await navigator.share({ title: "Мой рассказ о компании", text: storyText });
      else { await navigator.clipboard.writeText(storyText); setNotice("Рассказ скопирован. Отправь его наставнику или используй как план голосового."); }
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) setError("Не удалось поделиться рассказом. Можно выделить и скопировать текст плана ниже.");
    }
  }

  async function openVoice() {
    if (!attempt?.completed || !storyReady || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    const current = version.current;
    try {
      if (linkRequired) {
        const linked = await createTelegramLink();
        if (current !== version.current) return;
        if (linked.url) { window.location.assign(linked.url); return; }
        if (!linked.linked) throw new Error("Не удалось подготовить привязку Telegram.");
        setLinkRequired(false);
      }
      const saved = await saveCompanyStory(taskId, choices as number[]);
      if (current !== version.current) return;
      setAttempt(saved);
      const { url } = await createCompanyVoiceLink(taskId);
      if (current !== version.current) return;
      // Only a safe Telegram link may leave the site; never trust arbitrary URLs.
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "t.me") throw new Error("Некорректная ссылка Telegram. Попробуйте ещё раз.");
      setNotice("В Telegram нажми «Начать» / Start, затем запиши голосовое прямо в чате бота.");
      window.location.assign(target.href);
    } catch (cause) {
      if (current !== version.current) return;
      if (cause instanceof ApiError && cause.status === 422) setLinkRequired(true);
      setError(cause instanceof Error ? cause.message : "Не удалось открыть Telegram. Попробуйте ещё раз.");
    } finally { inFlight.current = false; if (current === version.current) setBusy(false); }
  }

  const alert = error && <div className={styles.failure} role="alert"><p>{error}</p>{!attempt && <button type="button" className={styles.secondary} onClick={() => { setError(""); setLoadKey((key) => key + 1); }}>Повторить загрузку</button>}</div>;

  return <section className={styles.game} aria-label={`Игра ${COMPANY_VOYAGE_TITLE}`}>
    <header className={styles.top}><span>О компании · {view === "intro" ? "Твой маршрут" : view === "cards" ? "Узнай компанию" : view === "quiz" ? "Правда или миф" : view === "bank" ? "Твой результат" : "Мой рассказ"}</span><span className={styles.reward}>{attempt?.completed ? "+" : "Награда · "}{COMPANY_VOYAGE_REWARD} миль</span></header>
    <div className={styles.progress} role="progressbar" aria-label="Прогресс задания" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress || 0)}><i style={{ width: `${progress || 0}%` }} /></div>

    {view === "intro" && <>
      <div className={styles.hero}><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M7 39h50L47 53H17L7 39Z" fill="currentColor"/><path d="M19 39V25h26v14M30 25V12h5v13" fill="none" stroke="currentColor" strokeWidth="4"/><path d="M7 59q6-5 12 0t12 0t12 0t12 0" fill="none" stroke="currentColor" strokeWidth="3"/></svg><p className={styles.kicker}>Поднимаемся на борт</p><h4 ref={heading} tabIndex={-1}>{COMPANY_VOYAGE_TITLE}</h4><p>Узнай, что это за компания, собери ответы на вопросы друзей и расскажи о ней своими словами.</p></div>
      <ol className={styles.route}><li><span>01</span><div><strong>Узнай компанию</strong><p>Восемь карточек с фактами и источниками.</p></div></li><li><span>02</span><div><strong>Правда или миф</strong><p>17 вопросов, включая три фразы-ловушки.</p></div></li><li><span>03</span><div><strong>Мой рассказ за 60 секунд</strong><p>Собери план и поделись им с наставником.</p></div></li></ol>
      <p className={styles.note}>Пройди тест без ошибок и нажми «Завершить» — получишь 10 миль. Если ошибёшься, сможешь пройти тест заново.</p>
      {alert}<button type="button" className={styles.primary} disabled={!attempt || busy} onClick={() => { setView("cards"); setCardIndex(0); }}>{!attempt ? error ? "Игра пока недоступна" : "Загружаем прогресс…" : "Поднимаюсь на борт →"}</button><p className={styles.hint}>10–15 минут · без дедлайна · прогресс сохраняется</p>
    </>}

    {view === "cards" && <>
      <div className={styles.stage}><span>Карточка {cardIndex + 1} из {COMPANY_CARDS.length}</span><span aria-hidden="true">{card.icon}</span></div>
      <article className={styles.card} onTouchStart={(event) => { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }} onTouchEnd={(event) => {
        const start = touch.current; touch.current = null;
        if (!start || busy) return;
        const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (dx < 0) nextCard(); else if (cardIndex > 0) setCardIndex(cardIndex - 1);
      }}><p className={styles.kicker}>{card.title}</p><h4 ref={heading} tabIndex={-1}>{card.heading}</h4><ul className={styles.facts}>{card.paragraphs.map((paragraph) => <li key={paragraph}>{paragraph}</li>)}</ul>{card.takeaway && <p className={styles.takeaway}>{card.takeaway}</p>}<details className={styles.sources}><summary>Источники материала</summary><p>{card.sources}</p>{card.sourceUrl && <a href={card.sourceUrl} target="_blank" rel="noopener noreferrer">Открыть реестр КГД ↗</a>}</details></article>
      <div className={styles.dots} aria-label={`Карточка ${cardIndex + 1} из ${COMPANY_CARDS.length}`}>{COMPANY_CARDS.map((item, index) => <span key={item.title} className={index <= cardIndex ? styles.dotDone : ""} />)}</div>
      {alert}<div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => cardIndex > 0 ? setCardIndex(cardIndex - 1) : setView("intro")}>← Назад</button><button type="button" className={styles.primary} disabled={busy} onClick={nextCard}>{busy ? "Сохраняем…" : cardIndex === COMPANY_CARDS.length - 1 ? attempt?.completed ? "К результату →" : "Начать тест →" : "Следующая карточка →"}</button></div><p className={styles.hint}>Карточки можно листать свайпом. Вертикальная прокрутка работает как обычно.</p>
    </>}

    {view === "quiz" && attempt && <>
      <div className={styles.stage}><button type="button" className={styles.back} disabled={busy} onClick={() => { setCardIndex(question.card - 1); setView("cards"); setError(""); }}>← К материалам</button><span>Вопрос {questionIndex + 1} / {COMPANY_QUESTIONS.length}</span></div>
      <article className={styles.card}><p className={styles.kicker}>{question.trap ? "Фраза-ловушка" : "Проверь себя"} · карточка {question.card}</p><h4 ref={heading} id={`${feedbackId}-question`} tabIndex={-1}>{question.title}</h4><div className={styles.options} role="group" aria-labelledby={`${feedbackId}-question`}>
        {COMPANY_ANSWER_OPTIONS.map((option, index) => <button type="button" key={option} className={`${styles.option} ${selected === index ? feedback === "incorrect" ? styles.incorrect : feedback === "correct" ? styles.correct : busy ? styles.checking : "" : ""}`} disabled={busy || Boolean(feedback)} onClick={() => answer(index)} aria-pressed={selected === index} aria-describedby={selected === index && feedback ? feedbackId : undefined}><span aria-hidden="true">{["✓", "×", "≈"][index]}</span><strong>{option}</strong><span aria-hidden="true">{selected === index && feedback === "incorrect" ? "×" : selected === index && feedback === "correct" ? "✓" : ""}</span></button>)}
      </div>
        {busy && !feedback && <p className={styles.hint} role="status">Проверяем ответ…</p>}
        {feedback && <div id={feedbackId} className={feedback === "incorrect" ? styles.failure : styles.success} role={feedback === "incorrect" ? "alert" : "status"}><strong>{feedback === "incorrect" ? "Этот ответ неверный" : "Верно!"}</strong><p>{question.explanation}</p><div className={styles.phrase}><small>Как ответить другу</small><p>{question.phrase}</p></div>{feedback === "incorrect" && <><p>Нажми «Пройти заново», чтобы повторить тест. Изученные карточки сохранятся.</p><button type="button" className={styles.retry} disabled={busy} onClick={retry}>Пройти заново</button></>}</div>}
        {alert}
        {feedback === "correct" && !attempt.ready && <button type="button" className={styles.primary} onClick={() => { setQuestionIndex(attempt.questionIndex); setSelected(null); setFeedback(""); setError(""); }}>Следующий вопрос →</button>}
        {attempt.ready && <div className={styles.finish}><p>Все 17 ответов верные. Подтверди завершение, чтобы получить награду.</p><button type="button" className={styles.primary} disabled={busy} onClick={finish}>{busy ? "Начисляем мили…" : "Завершить и получить 10 миль"}</button></div>}
        {!feedback && <p className={styles.hint}>Выбери один вариант. 10 миль начисляются после завершения всего теста.</p>}
      </article>
    </>}

    {view === "bank" && attempt?.completed && <>
      <div className={styles.result} role="status"><span aria-hidden="true">✓</span><p className={styles.kicker}>Ты на борту</p><h4 ref={heading} tabIndex={-1}>Теперь у тебя есть ответы</h4><strong>+{attempt.earnedPoints} миль</strong><p>Все {COMPANY_QUESTIONS.length} ответов верные. Мили уже добавлены в твой рейтинг.</p></div>
      <article className={styles.card}><p className={styles.kicker}>Пригодится в разговоре</p><h5>Твоя копилка ответов</h5><p>Сохрани скриншот или вернись сюда, когда захочешь освежить эти фразы.</p><div className={styles.bank}>{COMPANY_PHRASE_BANK.map((index) => <div className={styles.phrase} key={index}><small>{COMPANY_QUESTIONS[index].title}</small><p>{COMPANY_QUESTIONS[index].phrase}</p></div>)}</div></article>
      <button type="button" className={styles.primary} onClick={() => { setView("story"); setError(""); }}>Собрать мой рассказ →</button><button type="button" className={styles.secondary} onClick={() => { setCardIndex(0); setView("cards"); }}>Перечитать материалы</button>
    </>}

    {view === "story" && attempt?.completed && <>
      <button type="button" className={styles.back} onClick={() => { setView("bank"); setError(""); }}>← К результату</button><div className={styles.storyHeading}><p className={styles.kicker}>Своими словами</p><h4 ref={heading} tabIndex={-1}>Мой рассказ за 60 секунд</h4><p>В каждой части выбери одну близкую тебе фразу. Это план, а не текст для заучивания.</p></div>
      {COMPANY_STORY_PARTS.map((part, partIndex) => <fieldset key={part.title} className={styles.storyPart}><legend>{partIndex + 1}. {part.title}</legend>{part.options.map((option, index) => <label className={`${styles.storyOption} ${choices[partIndex] === index ? styles.chosen : ""}`} key={option}><input type="radio" name={`${feedbackId}-part-${partIndex}`} checked={choices[partIndex] === index} disabled={busy} onChange={() => { setChoices((current) => current.map((choice, i) => i === partIndex ? index : choice)); setNotice(""); }} /><span>{option}</span></label>)}</fieldset>)}
      {storyReady && <article className={styles.card}><h5>Твой план рассказа</h5><p className={styles.storyText}>{storyText}</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => void share(true)}>Скопировать</button><button type="button" className={styles.secondary} onClick={() => void share()}>Поделиться</button></div></article>}
      <article className={styles.card}><h5>Запиши голосовое наставнику</h5><ul className={styles.facts}><li>Длина — 30–60 секунд. Начни: «Я хочу рассказать тебе о компании, в которой я теперь…»</li><li>Говори своими словами. Сбился — продолжай: живая речь лучше заученного текста.</li><li>Не обещай обналичивание баллов, возврат денег в любой момент или высокие доходы для всех.</li></ul><p className={styles.note}>Этот шаг — для практики. Твои 10 миль уже начислены за тест.</p></article>
      {alert}{notice && <p className={styles.success} role="status">{notice}</p>}<button type="button" className={styles.primary} disabled={!storyReady || busy} onClick={() => void openVoice()}>{busy ? "Подготавливаем…" : linkRequired ? "Привязать Telegram" : "Отправить голосовое наставнику"}</button><p className={styles.hint}>{linkRequired ? "После привязки вернись сюда и нажми кнопку ещё раз." : "Откроется Telegram. Нажми «Начать» / Start и запиши голосовое в чате. План рассказа сохранится автоматически."}</p><button type="button" className={styles.secondary} disabled={!storyReady || busy} onClick={() => void run(() => saveCompanyStory(taskId, choices as number[]), () => setNotice("План рассказа сохранён. Ты сможешь вернуться к нему позже."))}>Сохранить план рассказа</button>
    </>}
  </section>;
}
