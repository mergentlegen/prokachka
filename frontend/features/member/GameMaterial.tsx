"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CAPTAIN_STAGES, CRUISE_CABINS, CRUISE_CARD_ROWS, CRUISE_LINES, CRUISE_PORTS } from "@/shared/domain/captain-cruise";
import { FIRST_YEAR_MONTHS } from "@/shared/domain/first-year";
import { SAFETY_WATCH_DECKS, SAFETY_WATCH_SOURCES, SAFETY_WATCH_SUMMARY } from "@/shared/domain/safety-watch";
import styles from "./GameMaterial.module.css";

// After a ready game is passed, its material stays open for reading: every game's result screen carries the same
// large «Посмотреть материал игры» button. Games that can be leafed through again open their own screens in a
// read-only mode; simulator games (every action checked by the server) open a reading page built from their data.

/** The large, easy-to-see button on a result screen that opens the game's material again. */
export function MaterialButton({ onClick, label = "Посмотреть материал игры" }: { onClick: () => void; label?: string }) {
  return <button type="button" className={styles.open} onClick={onClick}>
    <span className={styles.openIcon} aria-hidden="true">📖</span>
    <span className={styles.openText}><b>{label}</b><small>Награда уже получена — можно перечитать в любое время</small></span>
    <span className={styles.openArrow} aria-hidden="true">→</span>
  </button>;
}

/** The strip above material opened after the game: says it is a reading mode and leads back to the result. */
export function MaterialBar({ onBack, backLabel = "К результату" }: { onBack: () => void; backLabel?: string }) {
  return <div className={styles.bar} role="note">
    <span><b>📖 Материал игры</b><small>Игра пройдена, мили уже начислены. Ответы здесь не сохраняются.</small></span>
    <button type="button" onClick={onBack}>← {backLabel}</button>
  </div>;
}

/** Text with <b>…</b> marks from the game data, shown without raw HTML. */
function Bold({ text }: { text: string }) {
  return <>{text.split(/(<b>.*?<\/b>)/g).filter(Boolean).map((part, index) => part.startsWith("<b>") ? <b key={index}>{part.slice(3, -4)}</b> : part)}</>;
}

function Page({ title, lead, onBack, children }: { title: string; lead: string; onBack: () => void; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, []);
  return <div className={styles.page}>
    <MaterialBar onBack={onBack} />
    <h4 ref={heading} tabIndex={-1}>{title}</h4>
    <p className={styles.lead}>{lead}</p>
    {children}
    <button type="button" className={styles.back} onClick={onBack}>← К результату</button>
  </div>;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => <section className={styles.section}><h5>{title}</h5>{children}</section>;

export function CaptainCruiseMaterial({ onBack }: { onBack: () => void }) {
  return <Page title="Капитан ищет свой круиз" lead="Всё, что ты узнал(а) на тренировке в учебном кабинете: вопросы капитана с ответами, круизные линии, карточка круиза и каюты." onBack={onBack}>
    <Section title="Вопросы капитана">
      <ol className={styles.answers}>{CAPTAIN_STAGES.filter((stage) => stage.options.length > 0).map((stage) => <li key={stage.title}><b>{stage.title}</b><span>{stage.explanation}</span></li>)}</ol>
    </Section>
    <Section title="Круизные линии клуба">
      <ul className={styles.rows}>{CRUISE_LINES.map(([name, premium, text]) => <li key={name}><b>{name}{premium && <span className={styles.tag}>👑 премиум</span>}</b><span>{text}</span></li>)}</ul>
    </Section>
    <Section title="Как читать карточку круиза">
      <ul className={styles.rows}>{CRUISE_CARD_ROWS.map(([key, icon, label, text]) => <li key={key}><b>{icon} {label}</b><span>{text}</span></li>)}</ul>
    </Section>
    <Section title="Каюты (учебные цены)">
      <ul className={styles.rows}>{CRUISE_CABINS.map(([icon, name, price, text]) => <li key={name}><b>{icon} {name} · {price}</b><span>{text}</span></li>)}</ul>
    </Section>
    <Section title="Маршрут учебного круиза">
      <ol className={styles.plain}>{CRUISE_PORTS.map((port) => <li key={port}>{port}</li>)}</ol>
    </Section>
  </Page>;
}

export function SafetyWatchMaterial({ onBack }: { onBack: () => void }) {
  return <Page title="Вахта безопасности" lead="Все палубы и ситуации с правильными ответами и пояснениями — чтобы правила безопасности всегда были под рукой." onBack={onBack}>
    <Section title="Главное за 30 секунд">
      <ul className={styles.plain}>{SAFETY_WATCH_SUMMARY.map((line) => <li key={line}>{line}</li>)}</ul>
    </Section>
    {SAFETY_WATCH_DECKS.map((deck) => <Section key={deck.key} title={`${deck.emoji} ${deck.kicker} · ${deck.title}`}>
      <p className={styles.note}>{deck.intro}</p>
      <ul className={styles.memo}>{deck.memo.map((line) => <li key={line}>{line}</li>)}</ul>
      <ol className={styles.answers}>{deck.qs.map((question) => {
        const answer = deck.type === "two" ? deck.labels?.[question.a] : question.opts?.[question.a];
        return <li key={question.q}>
          {question.log && <small className={styles.log}>{question.log.acc} · {question.log.dev} · {question.log.ctx}</small>}
          <b>{question.q}</b>
          <span className={styles.right}>Правильно: {answer}</span>
          <span>{question.why}</span>
          <small className={styles.source}>{SAFETY_WATCH_SOURCES[question.src]}</small>
        </li>;
      })}</ol>
    </Section>)}
  </Page>;
}

export function FirstYearMaterial({ onBack }: { onBack: () => void }) {
  return <Page title="Мой первый год в клубе" lead="Все 12 месяцев: какие решения были и чему учит каждое из них." onBack={onBack}>
    {FIRST_YEAR_MONTHS.map((month) => <Section key={month.month} title={`${month.emoji} Месяц ${month.month} · ${month.title}`}>
      <ul className={styles.rows}>{month.choices.map((choice) => <li key={choice.label}><b>{choice.label}</b><span><b>{choice.head}</b> <Bold text={choice.lesson} /></span></li>)}</ul>
    </Section>)}
  </Page>;
}
