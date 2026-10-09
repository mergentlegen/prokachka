"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  COMPANY_ANSWER_OPTIONS, COMPANY_CARDS, COMPANY_PHRASE_BANK, COMPANY_QUESTIONS, COMPANY_STORY_PARTS, COMPANY_VOYAGE_REWARD, COMPANY_VOYAGE_TITLE,
  companyScoreMessage, type CompanyCard,
} from "@/shared/domain/company-voyage";
import { advanceReadyProgram, answerReadyProgram, completeReadyProgram, createCompanyVoiceLink, saveCompanyStory, startReadyProgram, type ReadyAttempt } from "@/frontend/shared/api/ready-program-client";
import { ApiError, createTelegramLink } from "@/frontend/shared/api/client";
import type { Submission } from "@/shared/domain/types";
import { formatMiles } from "@/frontend/shared/lib/format";
import { plural } from "@/frontend/shared/lib/plural";
import styles from "./CompanyVoyageGame.module.css";

type View = "intro" | "cards" | "quizIntro" | "quiz" | "result" | "story" | "waiting" | "done";
type Verdict = "right" | "wrong" | null;
const MILES = formatMiles(COMPANY_VOYAGE_REWARD);

/** Our own texts use only <b>…</b> and line breaks; they are shown as text, never as HTML. */
function Rich({ text }: { text: string }) {
  return <>{text.split("\n").map((line, row) => <Fragment key={row}>{row > 0 && <br />}
    {line.split(/(<b>.*?<\/b>)/g).filter(Boolean).map((part, index) => part.startsWith("<b>") ? <b key={index}>{part.slice(3, -4)}</b> : part)}
  </Fragment>)}</>;
}

function CardBody({ card, index }: { card: CompanyCard; index: number }) {
  return <>
    <div className={styles.emoji} aria-hidden="true">{card.icon}</div>
    <div className={styles.tag}>Карточка {index + 1} из {COMPANY_CARDS.length}</div>
    <div className={styles.ttl}>{card.title}</div>
    <h4>{card.heading}</h4>
    {card.blocks.map((block, blockIndex) => "p" in block
      ? <p key={blockIndex}><Rich text={block.p} /></p>
      : <ul key={blockIndex}>{block.list.map((item) => <li key={item}><Rich text={item} /></li>)}</ul>)}
    {card.takeaway && <div className={styles.main}><b>Главное:</b> {card.takeaway}</div>}
    <div className={styles.src}>{card.sources}</div>
  </>;
}

  // Where to open the game: the cards, the quiz, the result or the voice — from what the site has saved.
function placeFor(saved: ReadyAttempt): View {
  if (!saved.completed) return saved.step >= COMPANY_CARDS.length ? "quiz" : saved.step > 0 ? "cards" : "intro";
  if (saved.legacy) return "result";
  if (saved.voice?.status === "accepted") return "done";
  if (saved.voice?.status === "pending") return "waiting";
  return saved.voice?.status === "revision" ? "story" : "result";
}

export function CompanyVoyageGame({ taskId }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [attempt, setAttempt] = useState<ReadyAttempt | null>(null);
  const [view, setView] = useState<View>("intro");
  const [cardIndex, setCardIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [peek, setPeek] = useState<number | null>(null);
  // Replaying after the game is finished: answers are checked here and nothing is sent.
  const [practice, setPractice] = useState<{ firstTry: number; mistakes: number; tried: boolean } | null>(null);
  const [choices, setChoices] = useState<(number | null)[]>([null, null, null]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkRequired, setLinkRequired] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const inFlight = useRef(false);
  const version = useRef(0);
  const top = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const peekBox = useRef<HTMLDivElement>(null);

  const question = COMPANY_QUESTIONS[questionIndex];
  const storyReady = choices.every((choice, index) => choice !== null && COMPANY_STORY_PARTS[index].options[choice] !== undefined);
  const firstTry = practice ? practice.firstTry : attempt?.firstTry ?? 0;
  const mistakes = practice ? practice.mistakes : attempt?.mistakes ?? 0;
  const voice = attempt?.voice ?? null;

  useEffect(() => {
    const current = ++version.current;
    void startReadyProgram(taskId).then((saved) => {
      if (current !== version.current) return;
      setAttempt(saved); setError("");
      setCardIndex(Math.min(COMPANY_CARDS.length - 1, saved.step));
      setQuestionIndex(Math.min(COMPANY_QUESTIONS.length - 1, saved.questionIndex));
      setPicked(saved.wrong ? saved.lastAnswer ?? null : null);
      setVerdict(saved.wrong ? "wrong" : null);
      setChoices(saved.storyChoices || [null, null, null]);
      setView(placeFor(saved));
    }).catch((cause) => { if (current === version.current) setError(cause instanceof Error ? cause.message : "Не удалось загрузить игру."); });
    return () => { version.current = current + 1; };
  }, [taskId, loadKey]);

  // The hint card opens from its beginning, with the focus inside it.
  useEffect(() => {
    const box = peekBox.current;
    if (peek === null || !box) return;
    box.scrollTop = 0;
    box.focus({ preventScroll: true });
  }, [peek]);

  // A new screen starts from its top; an answer never moves the page.
  useEffect(() => {
    const box = top.current;
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ behavior: "smooth", block: "start" });
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

  function goCard(index: number) {
    if (!attempt || busy) return;
    if (index >= COMPANY_CARDS.length) { setView(attempt.completed ? "result" : "quizIntro"); return; }
    if (attempt.completed || index <= attempt.step) { setCardIndex(index); return; }
    void run(() => advanceReadyProgram(taskId, index), () => setCardIndex(index));
  }
  function nextCard() {
    if (!attempt || busy) return;
    // The last card is also saved: the quiz opens only after all nine.
    if (cardIndex === COMPANY_CARDS.length - 1 && !attempt.completed && attempt.step < COMPANY_CARDS.length) {
      void run(() => advanceReadyProgram(taskId, COMPANY_CARDS.length), () => setView("quizIntro"));
      return;
    }
    goCard(cardIndex + 1);
  }

  function startQuiz() {
    setPicked(null); setVerdict(null); setError("");
    if (attempt?.completed) { setPractice({ firstTry: 0, mistakes: 0, tried: false }); setQuestionIndex(0); }
    else setQuestionIndex(Math.min(COMPANY_QUESTIONS.length - 1, attempt?.questionIndex ?? 0));
    setView("quiz");
  }
  function answer(option: number) {
    if (!attempt || verdict || busy) return;
    setPicked(option);
    if (practice) {
      const right = option === question.answer;
      setPractice({ firstTry: practice.firstTry + (right && !practice.tried ? 1 : 0), mistakes: practice.mistakes + (right ? 0 : 1), tried: !right });
      setVerdict(right ? "right" : "wrong");
      return;
    }
    void run(() => answerReadyProgram(taskId, option, questionIndex), (saved) => setVerdict(saved.wrong ? "wrong" : "right"));
  }
  function again() { setPicked(null); setVerdict(null); setError(""); }
  function nextQuestion() {
    if (questionIndex < COMPANY_QUESTIONS.length - 1) { setQuestionIndex(questionIndex + 1); setPicked(null); setVerdict(null); return; }
    if (practice || attempt?.completed) { setView("result"); return; }
    // All eighteen are right: the game is finished (the miles come with the mentor's review of the voice).
    void run(() => completeReadyProgram(taskId), () => setView("result"));
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
      setNotice("В Telegram нажми «Начать» / Start и запиши голосовое прямо в чате. Потом вернись сюда и нажми «Обновить статус».");
      window.location.assign(target.href);
    } catch (cause) {
      if (current !== version.current) return;
      if (cause instanceof ApiError && cause.status === 422) setLinkRequired(true);
      setError(cause instanceof Error ? cause.message : "Не удалось открыть Telegram. Попробуйте ещё раз.");
    } finally { inFlight.current = false; if (current === version.current) setBusy(false); }
  }

  const progress = view === "intro" ? 0 : view === "cards" ? Math.round((cardIndex + 1) / COMPANY_CARDS.length * 33)
    : view === "quizIntro" ? 33 : view === "quiz" ? 33 + Math.round(questionIndex / COMPANY_QUESTIONS.length * 33)
    : view === "result" || view === "story" ? 66 : 100;
  const stage = view === "cards" ? "Шаг 1 из 3 · Узнай компанию" : view === "quizIntro" || view === "quiz" ? "Шаг 2 из 3 · Правда или миф"
    : view === "result" ? "Шаг 2 из 3 · Результат" : view === "story" ? "Шаг 3 из 3 · Мой рассказ" : view === "waiting" ? "Блок «О компании» · ждём ответ" : "Блок «О компании»";
  const alert: ReactNode = error && <div className={styles.warn} role="alert"><p>{error}</p>{!attempt && <button type="button" className={`${styles.btn} ${styles.line}`} onClick={() => { setError(""); setLoadKey((key) => key + 1); }}>Повторить загрузку</button>}</div>;
  const bank = <div className={styles.bank}>{COMPANY_PHRASE_BANK.map((index) => <div className={styles.say} key={index}><small>{COMPANY_QUESTIONS[index].title}</small>{COMPANY_QUESTIONS[index].phrase}</div>)}</div>;

  return <section className={styles.game} ref={top} aria-label={`Игра ${COMPANY_VOYAGE_TITLE}`}>
    <div className={styles.top}><div className={styles.stage}>{stage}</div><div className={styles.miles}>✈️ {MILES}</div></div>
    <div className={styles.bar} role="progressbar" aria-label="Прогресс задания" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>

    {view === "intro" && <>
      <h3 className={styles.h1}>Корабль, на который ты поднялся ⚓</h3>
      <p className={styles.lead}>За 10–15 минут ты узнаешь, что это за компания, научишься спокойно отвечать на вопросы скептиков и расскажешь о ней своими словами.</p>
      <div className={styles.card}>
        <div className={styles.step}><div className={styles.n}>1</div><p>Узнай компанию<span>{COMPANY_CARDS.length} карточек с фактами</span></p></div>
        <div className={styles.step}><div className={styles.n}>2</div><p>Игра «Правда или миф»<span>{COMPANY_QUESTIONS.length} фраз, которые ты услышишь от знакомых</span></p></div>
        <div className={styles.step}><div className={styles.n}>3</div><p>Мой рассказ за 60 секунд<span>голосовое наставнику в Telegram</span></p></div>
        <div className={styles.warn}>✈️ {MILES} за весь интерактив начисляет наставник, когда получит твоё голосовое.</div>
      </div>
      {alert}
      <button type="button" className={`${styles.btn} ${styles.gold}`} disabled={!attempt || busy} onClick={() => { setCardIndex(0); setView("cards"); }}>
        {!attempt ? error ? "Игра пока недоступна" : "Загружаем прогресс…" : "Поднимаюсь на борт"}
      </button>
    </>}

    {view === "cards" && <>
      <div className={styles.card} onTouchStart={(event) => { if (event.touches.length === 1) touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: event.timeStamp }; }}
        onTouchEnd={(event) => {
          // Only a clear horizontal swipe turns the card, so scrolling the text never does.
          const start = touch.current; touch.current = null;
          if (!start || busy) return;
          const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 2.5 || event.timeStamp - start.at > 700 || window.getSelection?.()?.toString()) return;
          if (dx < 0) nextCard(); else if (cardIndex > 0) setCardIndex(cardIndex - 1);
        }}><CardBody card={COMPANY_CARDS[cardIndex]} index={cardIndex} /></div>
      <div className={styles.dots} aria-hidden="true">{COMPANY_CARDS.map((item, index) => <span key={item.title} className={index === cardIndex ? styles.on : ""} />)}</div>
      {alert}
      <button type="button" className={`${styles.btn} ${styles.gold}`} disabled={busy} onClick={nextCard}>{busy ? "Сохраняем…" : cardIndex === COMPANY_CARDS.length - 1 ? attempt?.completed ? "К результату" : "Я всё понял(а) — к игре" : "Дальше"}</button>
      {cardIndex > 0 && <button type="button" className={`${styles.btn} ${styles.ghost}`} disabled={busy} onClick={() => setCardIndex(cardIndex - 1)}>Назад</button>}
      <p className={styles.hint}>Можно листать быстрым свайпом влево-вправо</p>
    </>}

    {view === "quizIntro" && <>
      <h3 className={styles.h1}>Правда или миф? 🕵️</h3>
      <p className={styles.lead}>Эти фразы ты точно услышишь от знакомых. Реши, где правда, и собери готовые ответы в свою копилку.</p>
      <div className={styles.card}>
        <p>Три варианта ответа:</p>
        <ul><li><b>✅ Правда</b></li><li><b>❌ Миф</b></li><li><b>⚖️ Не совсем так</b> — когда в фразе есть доля правды</li></ul>
        <div className={styles.warn}>🪤 Среди вопросов есть 3 ловушки: фразы, которыми новички иногда подводят себя и свою команду. Запомни их — так говорить нельзя.</div>
        <div className={`${styles.warn} ${styles.info}`}>🔁 Ошибся — не страшно. Загляни в подсказку-карточку и ответь ещё раз. В конце ты увидишь, сколько раз ошибся за игру.</div>
        {practice === null && attempt?.completed && <div className={`${styles.warn} ${styles.info}`}>Это повторное прохождение для тренировки: результат игры уже сохранён.</div>}
      </div>
      <button type="button" className={`${styles.btn} ${styles.gold}`} onClick={startQuiz}>Начать игру</button>
    </>}

    {view === "quiz" && question && <>
      <div className={styles.card}>
        <div className={styles.tag}>Вопрос {questionIndex + 1} из {COMPANY_QUESTIONS.length} · карточка {question.card}{question.trap ? " · 🪤 ловушка" : ""}</div>
        <div className={styles.statement}>{question.title}</div>
        <div className={styles.answers}>{COMPANY_ANSWER_OPTIONS.map((option, index) => <button type="button" key={option}
          className={`${styles.ans} ${picked === index ? verdict === "wrong" ? styles.wrong : verdict === "right" ? styles.right : "" : ""}`}
          disabled={busy || verdict !== null} onClick={() => answer(index)}>{option}</button>)}</div>
        {busy && verdict === null && <p className={styles.checking} role="status">Проверяем ответ…</p>}
        {verdict === "wrong" && <div className={`${styles.verdict} ${styles.no}`} role="alert"><b>Не совсем так 🤔</b>
          <p>Подсказка — в карточке {question.card} «{COMPANY_CARDS[question.card - 1].title}». Загляни в неё и ответь ещё раз.</p></div>}
        {verdict === "right" && <div className={styles.verdict} role="status"><b>Верно! {COMPANY_ANSWER_OPTIONS[question.answer]}</b>
          {question.explanation.map((paragraph) => <p key={paragraph}><Rich text={paragraph} /></p>)}
          <div className={styles.say}><small>Как ответить другу</small>{question.phrase}</div></div>}
      </div>
      {alert}
      {verdict === "wrong" && <>
        <button type="button" className={`${styles.btn} ${styles.line}`} onClick={() => setPeek(question.card - 1)}>📖 Открыть карточку {question.card}</button>
        <button type="button" className={`${styles.btn} ${styles.gold}`} onClick={again}>Ответить ещё раз</button>
      </>}
      {verdict === "right" && <button type="button" className={`${styles.btn} ${styles.gold}`} disabled={busy} onClick={nextQuestion}>
        {busy ? "Сохраняем…" : questionIndex === COMPANY_QUESTIONS.length - 1 ? "Посмотреть результат" : "Следующий вопрос"}</button>}
    </>}

    {view === "result" && <>
      <h3 className={styles.h1}>Твой результат</h3>
      {attempt?.legacy && !practice
        ? <div className={styles.errs}>✅ Ты прошёл(ла) прошлую версию игры — мили уже начислены. Новые карточки и вопросы можно пройти для тренировки.</div>
        : <>
          <div className={styles.score}>{firstTry} / {COMPANY_QUESTIONS.length}</div>
          <p className={styles.lead}>правильных ответов с первой попытки. {companyScoreMessage(firstTry)}</p>
          <div className={styles.errs}>{mistakes === 0 ? "🏆 Ни одной ошибки за всю игру!" : `🔁 За игру ты ошибся(лась) ${mistakes} ${plural(mistakes, "раз", "раза", "раз")}. Каждая ошибка — это ответ, который ты теперь знаешь.`}</div>
        </>}
      <div className={styles.card}><h4>🧰 Твоя копилка ответов</h4><p>Сделай скриншот — эти фразы пригодятся, когда тебя спросят о компании.</p>{bank}</div>
      {voice?.status === "pending" ? <button type="button" className={`${styles.btn} ${styles.gold}`} onClick={() => setView("waiting")}>Моё голосовое у наставника</button>
        : voice?.status === "accepted" ? <button type="button" className={`${styles.btn} ${styles.gold}`} onClick={() => setView("done")}>К награде</button>
        : <button type="button" className={`${styles.btn} ${styles.gold}`} onClick={() => { setPractice(null); setView("story"); }}>Дальше: мой рассказ</button>}
      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => { setPractice(null); setView("quizIntro"); }}>Пройти игру ещё раз</button>
      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => { setPractice(null); setCardIndex(0); setView("cards"); }}>Перечитать карточки</button>
    </>}

    {view === "story" && <>
      <h3 className={styles.h1}>Мой рассказ за 60 секунд 🎙️</h3>
      {voice?.status === "revision" && <div className={styles.warn} role="status"><b>Наставник вернул голосовое.</b>{voice.comment && <> «{voice.comment}»</>} Запиши, пожалуйста, ещё раз.</div>}
      <p className={styles.lead}>Ты изучил(а) {COMPANY_CARDS.length} карточек о компании и разобрал(а) {COMPANY_QUESTIONS.length} фраз. Теперь расскажи о компании так, будто объясняешь другу за чашкой чая. Не заучивай — говори своими словами.</p>
      <div className={styles.card}>
        <h4>Шаг 1. Собери свой рассказ</h4>
        <p>В каждой части выбери одну фразу, которая откликается тебе больше всего.</p>
        {COMPANY_STORY_PARTS.map((part, partIndex) => <div className={styles.pick} key={part.title}>
          <h5>{["①", "②", "③"][partIndex]} {part.title}</h5>
          {part.options.map((option, index) => <button type="button" key={option} aria-pressed={choices[partIndex] === index}
            className={`${styles.opt} ${choices[partIndex] === index ? styles.optOn : ""}`}
            onClick={() => setChoices((current) => current.map((value, i) => i === partIndex ? index : value))}>{option}</button>)}
        </div>)}
      </div>
      {!storyReady ? <button type="button" className={`${styles.btn} ${styles.gold}`} disabled>Выбери по одной фразе в каждой части</button> : <>
        <div className={styles.card}><h4>📝 Твой план рассказа</h4>{COMPANY_STORY_PARTS.map((part, index) => <div className={styles.say} key={part.title}><small>{["①", "②", "③"][index]} {part.title}</small>{part.options[choices[index]!]}</div>)}</div>
        <div className={styles.card}><h4>Шаг 2. Запиши голосовое</h4><ul>
          <li>Длина — <b>30–60 секунд</b>.</li>
          <li>Начни словами: <b>«Я хочу рассказать тебе о компании, в которой я теперь…»</b></li>
          <li>Сбился(лась) — это нормально, говори дальше.</li>
          <li>Не перезаписывай: первая версия самая живая.</li>
        </ul><div className={styles.warn}>🪤 Не используй фразы-ловушки: «баллы можно обналичить», «деньги можно вернуть в любой момент», «все здесь много зарабатывают».</div></div>
        {alert}{notice && <div className={`${styles.warn} ${styles.info}`} role="status">{notice}</div>}
        <button type="button" className={`${styles.btn} ${styles.gold}`} disabled={busy || !attempt?.completed} onClick={() => void openVoice()}>
          {busy ? "Подготавливаем…" : linkRequired ? "Привязать Telegram" : "📨 Отправить голосовое наставнику"}</button>
        <p className={styles.hint}>{linkRequired ? "Сначала привяжи Telegram, потом вернись и нажми кнопку ещё раз." : "Откроется Telegram. Запиши голосовое прямо в чате."}</p>
        {notice && <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setLoadKey((key) => key + 1)}>Обновить статус</button>}
      </>}
      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setView("result")}>← К результату</button>
    </>}

    {view === "waiting" && <>
      <div className={styles.reward}><div className={styles.big}>⏳</div><h3 className={styles.h1}>Жду ответ</h3>
        <p className={styles.lead}>Твоё голосовое у наставника. Когда он его послушает, он ответит тебе и начислит <b>{MILES} ✈️</b>.</p></div>
      <div className={styles.card}><h4>Пока ждёшь</h4><p>Перечитай свою копилку ответов — завтра они могут пригодиться в разговоре с другом.</p></div>
      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setView("result")}>Открыть копилку ответов</button>
      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setLoadKey((key) => key + 1)}>Обновить статус</button>
    </>}

    {view === "done" && <>
      <div className={styles.reward}><div className={styles.big}>🏅</div><h3 className={styles.h1}>Наставник принял твой рассказ!</h3>
        <p className={styles.lead}><b>+{formatMiles(voice?.points || COMPANY_VOYAGE_REWARD)} ✈️</b> уже в твоём рейтинге.{voice?.comment && <> Наставник: «{voice.comment}»</>}</p></div>
      <div className={styles.card}><h4>🧰 Твоя копилка ответов</h4>{bank}</div>
      <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => { setPractice(null); setView("quizIntro"); }}>Пройти игру ещё раз</button>
    </>}

    {peek !== null && <div ref={peekBox} tabIndex={-1} className={styles.modal} role="dialog" aria-modal="true" aria-label={`Карточка ${peek + 1}`} onClick={(event) => { if (event.target === event.currentTarget) setPeek(null); }}>
      <div className={styles.box}><div className={styles.card}><CardBody card={COMPANY_CARDS[peek]} index={peek} /></div>
        <button type="button" className={`${styles.btn} ${styles.gold}`} onClick={() => setPeek(null)}>Вернуться к вопросу</button></div>
    </div>}
  </section>;
}
