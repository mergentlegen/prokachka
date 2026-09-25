"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMiles } from "@/frontend/shared/lib/format";
import styles from "./DreamPlanGame.module.css";

const months = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const expenses: Record<number, [string, number]> = {
  2: ["Новая куртка", 120], 3: ["Новый телефон", 250], 5: ["Подарок на день рождения", 150],
  7: ["Распродажа", 200], 8: ["Лечение зуба", 180], 9: ["Ремонт машины", 300], 11: ["Новый год", 150],
};

export function DreamPlanGame({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) {
  const [month, setMonth] = useState(0);
  const [selfSavings, setSelfSavings] = useState(0);
  const [clubMiles, setClubMiles] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [lastExpense, setLastExpense] = useState<[string, number] | null>(null);

  const calendar = useMemo(() => months.map((name, index) => ({ name, state: index === month - 1 ? "current" : index < month ? expenses[index + 1] ? "expense" : "complete" : "" })), [month]);
  const finished = month === months.length;
  const shipPosition = Math.min(78, 4 + Math.round((clubMiles / 1200) * 74));

  useEffect(() => {
    onReadyChange?.(finished && quizAnswer === 1);
  }, [finished, onReadyChange, quizAnswer]);

  function nextMonth() {
    if (month >= months.length) return;
    const nextMonthNumber = month + 1;
    const expense = expenses[nextMonthNumber] || null;
    setMonth(nextMonthNumber);
    setSelfSavings((current) => Math.max(0, current + 100 - (expense?.[1] || 0)));
    setClubMiles((current) => current + 200);
    setLastExpense(expense);
    if (nextMonthNumber < months.length) setQuizAnswer(null);
  }

  function reset() {
    setMonth(0); setSelfSavings(0); setClubMiles(0); setQuizAnswer(null); setLastExpense(null);
  }

  return <section className={styles.game} aria-label="Интерактивная игра Мечта с планом">
    <div className={styles.gameHeader}>
      <div><p className={styles.kicker}>Интерактивный шаг</p><h4>Круиз: сама или через клуб?</h4><p>Два пути к одной мечте. Листай месяцы и смотри, какой путь доведёт до палубы.</p></div>
      <span className={styles.goal}>Цель<br /><b>$1200</b></span>
    </div>
    <div className={styles.sea} aria-hidden="true"><span>Круиз</span><svg className={styles.ship} style={{ left: `${shipPosition}%` }} viewBox="0 0 46 40"><path d="M6 26h34l-5 9H11z" fill="currentColor" /><rect x="14" y="16" width="18" height="10" rx="2" fill="var(--blue)" /><rect x="20" y="8" width="5" height="8" fill="var(--gold)" /></svg><svg className={styles.wave} viewBox="0 0 400 30" preserveAspectRatio="none"><path d="M0 14 Q25 4 50 14 T100 14 T150 14 T200 14 T250 14 T300 14 T350 14 T400 14 V30 H0z" fill="currentColor" opacity=".3" /></svg></div>
    <div className={styles.progressHead}><span>Путь к мечте</span><b>Месяц {month} из 12</b></div>
    <div className={styles.calendar} aria-label="Прогресс по месяцам">{calendar.map((item) => <span className={`${styles.month} ${item.state ? styles[item.state] : ""}`} key={item.name}>{item.name}</span>)}</div>
    <div className={styles.compare}>
      <article className={`${styles.path} ${styles.self}`}><h5>Путь «Сама»</h5><span>«Куплю через год-два»</span><strong>${selfSavings}</strong><small>+$100 в месяц</small><i><em style={{ width: `${Math.max(0, Math.min(100, Math.round(selfSavings / 12)))}%` }} /></i><p>{lastExpense ? `${lastExpense[0]}: −$${lastExpense[1]}` : "Непредвиденные траты уводят цель дальше."}</p></article>
      <article className={`${styles.path} ${styles.club}`}><h5>Путь «Клуб»</h5><span>«Коплю в клубе»</span><strong>{formatMiles(clubMiles)}</strong><small>$100 → 200 миль</small><i><em style={{ width: `${Math.min(100, Math.round(clubMiles / 12))}%` }} /></i><p>{clubMiles >= 2400 ? "Хватает на круиз вдвоём" : clubMiles >= 1200 ? "Уже хватает на круиз!" : "+200 миль за каждый месяц"}</p></article>
    </div>
    <p className={styles.same}>На обоих путях откладывают по $100 в месяц. В клубе деньги направлены на мечту.</p>
    <div className={styles.controls}><button type="button" className={styles.next} onClick={nextMonth} disabled={finished}>{finished ? "Год пройден" : "Следующий месяц"}</button><button type="button" className={styles.reset} onClick={reset} aria-label="Начать игру заново">↺</button></div>
    {finished && <div className={styles.finish} aria-live="polite"><p><b>Итог года</b></p><p>Путь «Сама»: отложено $1200, но после непредвиденных трат осталось ${selfSavings}. Круиз снова может отложиться.</p><p>Путь «Клуб»: те же $1200 превратились в {formatMiles(clubMiles)}. Круиз был доступен уже в июне, а к декабрю хватает на двоих.</p></div>}
    {finished && <div className={styles.quiz}><h5>Вопрос на 5 миль</h5><p>Почему путь «Клуб» привёл к круизу, а путь «Сама» - нет?</p>{["Там больше зарабатывают", "Деньги отложены на мечту, и клуб удваивает их милями", "Просто повезло"].map((answer, index) => <button type="button" className={`${styles.option} ${quizAnswer === index ? index === 1 ? styles.correct : styles.incorrect : ""}`} onClick={() => setQuizAnswer(index)} key={answer}>{answer}</button>)}{quizAnswer !== null && <p className={`${styles.result} ${quizAnswer === 1 ? styles.correctText : styles.incorrectText}`}>{quizAnswer === 1 ? "Верно, +5 миль. Доход одинаковый - но в клубе деньги защищены от трат и направлены к мечте." : "Не совсем. Подсказка: доход на обоих путях одинаковый. Попробуй ещё раз."}</p>}</div>}
  </section>;
}
