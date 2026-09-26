"use client";

import { useEffect, useId, useRef, useState } from "react";
import { heartSurveyRequest, type HeartSurveyState } from "@/frontend/shared/api/heart-survey-client";
import { formatMiles } from "@/frontend/shared/lib/format";
import base from "./DreamPlanGame.module.css";
import styles from "./HeartSurvey.module.css";

export function HeartSurvey({ taskId, onProgress }: { taskId: string; onProgress?: () => void }) {
  const [survey, setSurvey] = useState<HeartSurveyState | null>(null);
  const [started, setStarted] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reward, setReward] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  const id = useId();

  useEffect(() => {
    const version = ++loadVersion.current;
    void heartSurveyRequest(taskId).then((saved) => {
      if (version !== loadVersion.current) return;
      setSurvey(saved); setStarted(saved.questionIndex > 0 || saved.completed); setError("");
    }).catch((cause) => { if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : "Не удалось открыть опросник."); });
    return () => { loadVersion.current += 1; };
  }, [taskId]);

  useEffect(() => {
    heading.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
    if (started) heading.current?.focus({ preventScroll: true });
  }, [started, survey?.questionIndex]);

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { const saved = await heartSurveyRequest(taskId); setSurvey(saved); setStarted(saved.questionIndex > 0 || saved.completed); setSelected(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обновить прогресс."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function next() {
    if (!survey || selected === null || inFlight.current || survey.completed) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const saved = await heartSurveyRequest(taskId, selected, survey.questionIndex);
      const added = saved.earnedPoints - survey.earnedPoints;
      setSurvey(saved); setSelected(null);
      setReward(added > 0 ? "Ответ сохранён · +1 миля в твой рейтинг" : "Прогресс восстановлен");
      if (added > 0) onProgress?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить ответ. Попробуй ещё раз."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const question = survey?.definition.questions[survey.questionIndex];
  const result = survey?.completed ? survey.definition.finals[survey.answers[4]] : undefined;
  const delivery = survey?.delivery;
  const deliveryText = !delivery?.total ? "Ответы сохранены. Они доступны в истории задания; в твоей цепочке пока нет наставников с правом проверки." : delivery.sent === delivery.total ? "Ответы доставлены всем наставникам твоей ветки в Telegram." : delivery.waiting === delivery.total ? "Ответы сохранены и ждут привязки Telegram наставниками твоей ветки." : delivery.sent ? `Доставлено ${delivery.sent} из ${delivery.total} наставникам. Остальные сообщения ожидают отправки.` : "Ответы сохранены и поставлены в очередь отправки наставникам твоей ветки.";

  return <section className={`${base.game} ${styles.game}`} aria-label="Опросник Куда зовёт твоё сердце">
    <div className={styles.content}>
      <div className={base.stageLine}><p className={base.kicker}>Старт новичка</p><span className={`${base.reward} ${styles.counter}`}>✈ {formatMiles(survey?.earnedPoints ?? 0)}</span></div>
      {!started && !survey?.completed ? <div className={styles.intro}>
        <span className={styles.sunrise} aria-hidden="true">🌅</span>
        <h4 ref={heading}>Куда зовёт твоё сердце?</h4>
        <p>5 честных вопросов о путешествиях, которых ты хочешь, но пока откладываешь.</p>
        <div className={styles.rules}><strong>Здесь нет неправильных ответов</strong><span>За каждый сохранённый ответ — +1 миля сразу в рейтинг.</span></div>
        <button type="button" className={base.primary} disabled={!survey || busy} onClick={() => setStarted(true)}>{survey ? "Начать путешествие →" : error ? "Опросник пока недоступен" : "Загружаем опросник…"}</button>
        <small>Ответы увидят наставники выше тебя по ветке с правом проверки работ.</small>
      </div> : survey?.completed && result ? <div className={styles.result}>
        <div className={base.completed}><span className={base.resultIcon} aria-hidden="true">✓</span><h4 ref={heading} tabIndex={-1}>Твоя мечта стала ближе</h4><strong className={base.resultMiles}>+{formatMiles(survey.earnedPoints)}</strong><p>Все 5 миль уже в твоём рейтинге.</p></div>
        <div className={styles.reason}><span>Твоя настоящая причина · {result.title}</span><p>«{result.text}»</p></div>
        <p className={styles.reflect}>Если ничего не менять — когда случится твоё путешествие мечты?</p>
        <p className={styles.hint}>Запомни свою причину — она будет вести тебя дальше. Следующий шаг: узнай, как клуб помогает путешествовать чаще и за меньшие деньги.</p>
        <div className={styles.delivery} role="status"><strong>Ответы для наставников</strong><p>{deliveryText}</p>{delivery && delivery.sent < delivery.total && <button type="button" className={base.back} disabled={busy} onClick={() => void reload()}>{busy ? "Проверяем…" : "Проверить доставку"}</button>}</div>
        <details className={styles.answers}><summary>Мои ответы</summary><ol>{survey.definition.questions.map((item, index) => <li key={item.title}><strong>{item.title}</strong><span>{item.options[survey.answers[index]].emoji} {item.options[survey.answers[index]].text}</span></li>)}</ol></details>
        <p className={styles.hint}>Результат сохранён. Повторное открытие не начисляет мили заново.</p>
      </div> : question && survey ? <div className={base.quiz}>
        <div className={base.quizProgress}><div className={base.progressHead}><b>Вопрос {survey.questionIndex + 1} из 5</b><span>{survey.earnedPoints} / 5 миль</span></div><div className={base.quizSteps} aria-label={`Сохранено ответов: ${survey.questionIndex} из 5`}>{survey.definition.questions.map((item, index) => <span key={item.title} className={index < survey.questionIndex ? base.stepDone : index === survey.questionIndex ? base.stepCurrent : ""} />)}</div></div>
        {reward && <p className={styles.saved} role="status">{reward}</p>}
        <div className={base.question}><h4 ref={heading} id={`${id}-question`} tabIndex={-1}>{question.title}</h4><div className={base.options} role="group" aria-labelledby={`${id}-question`}>{question.options.map((option, index) => <button type="button" key={option.text} className={`${base.option} ${styles.option} ${selected === index ? styles.picked : ""}`} disabled={busy} aria-pressed={selected === index} onClick={() => setSelected(index)}><span className={styles.emoji} aria-hidden="true">{option.emoji}</span><span>{option.text}</span><span className={base.optionMark} aria-hidden="true">{selected === index ? "✓" : ""}</span></button>)}</div>
          <p className={base.quizHint}>{selected === null ? "Выбери вариант, который ближе тебе" : "Можно поменять ответ до нажатия кнопки ниже"}</p>
          <button type="button" className={base.primary} disabled={selected === null || busy} onClick={() => void next()}>{busy ? "Сохраняем ответ…" : survey.questionIndex === 4 ? "Узнать результат →" : "Далее →"}</button>
        </div>
      </div> : null}
      {error && <div className={base.quizFailure} role="alert"><strong>Не удалось сохранить прогресс</strong><p>{error}</p><button type="button" className={base.retry} disabled={busy} onClick={() => void reload()}>Обновить прогресс</button></div>}
    </div>
  </section>;
}
