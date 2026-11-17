"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CAPTAIN_STAGES, CRUISE_CABINS, CRUISE_CARD_ROWS, CRUISE_LINES, CRUISE_PORTS } from "@/shared/domain/captain-cruise";
import { FIRST_YEAR_MONTHS } from "@/shared/domain/first-year";
import { SAFETY_WATCH_DECKS, SAFETY_WATCH_SOURCES, SAFETY_WATCH_SUMMARY } from "@/shared/domain/safety-watch";
import { FREE_MEMBERSHIP_INTRO, FREE_MEMBERSHIP_MISSIONS, FREE_MEMBERSHIP_QUIZ, FREE_MEMBERSHIP_SUMMARY } from "@/shared/domain/free-membership";
import styles from "./GameMaterial.module.css";

// After a ready game is passed, its material stays open for reading: every game's result screen carries the same
// large «Посмотреть материал игры» button. Games that can be leafed through again open their own screens in a
// read-only mode; simulator games (every action checked by the server) open a reading page built from their data.

/** The large, easy-to-see button on a result screen that opens the game's material again. */
export function MaterialButton({ onClick, label = "Посмотреть материал игры", hint = "Награда уже получена — можно перечитать в любое время" }: { onClick: () => void; label?: string; hint?: string }) {
  return <button type="button" className={styles.open} onClick={onClick}>
    <span className={styles.openIcon} aria-hidden="true">📖</span>
    <span className={styles.openText}><b>{label}</b><small>{hint}</small></span>
    <span className={styles.openArrow} aria-hidden="true">→</span>
  </button>;
}

/** The strip above material opened after the game: says it is a reading mode and leads back to the result. */
/** `archive`: a game of an earlier level that was not played; it can be read, not played. */
export function MaterialBar({ onBack, backLabel = "К результату", archive = false }: { onBack: () => void; backLabel?: string; archive?: boolean }) {
  return <div className={styles.bar} role="note">
    <span><b>📖 Материал игры</b><small>{archive ? "Игра прошлого уровня: её можно прочитать, но пройти уже нельзя." : "Игра пройдена, мили уже начислены. Ответы здесь не сохраняются."}</small></span>
    <button type="button" onClick={onBack}>← {backLabel}</button>
  </div>;
}

/** Text with <b>…</b> marks from the game data, shown without raw HTML. */
export function Bold({ text }: { text: string }) {
  return <>{text.split(/(<b>.*?<\/b>)/g).filter(Boolean).map((part, index) => part.startsWith("<b>") ? <b key={index}>{part.slice(3, -4)}</b> : part)}</>;
}

type MaterialProps = { onBack: () => void; archive?: boolean };

function Page({ title, lead, onBack, archive = false, children }: MaterialProps & { title: string; lead: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, []);
  return <div className={styles.page}>
    <MaterialBar onBack={onBack} archive={archive} backLabel={archive ? "Закрыть" : undefined} />
    <h4 ref={heading} tabIndex={-1}>{title}</h4>
    <p className={styles.lead}>{lead}</p>
    {children}
    <button type="button" className={styles.back} onClick={onBack}>← {archive ? "Закрыть" : "К результату"}</button>
  </div>;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => <section className={styles.section}><h5>{title}</h5>{children}</section>;

export function CaptainCruiseMaterial({ onBack, archive }: MaterialProps) {
  return <Page title="Капитан ищет свой круиз" lead="Всё, что ты узнал(а) на тренировке в учебном кабинете: вопросы капитана с ответами, круизные линии, карточка круиза и каюты." onBack={onBack} archive={archive}>
    <Section title="Вопросы капитана">
      <ol className={styles.answers}>{CAPTAIN_STAGES.filter((stage) => stage.options.length > 0).map((stage) => <li key={stage.title}><b>{stage.title}</b><span>{stage.explanation}</span></li>)}</ol>
    </Section>
    <Section title="Круизные линии клуба">
      <ul className={styles.rows}>{CRUISE_LINES.map(([name, mark, text]) => <li key={name}><b>{name}{mark === "crown" ? <span className={styles.tag}>👑 премиум</span> : mark === "river" && <span className={styles.tag}>🌊 речные</span>}</b><span>{text}</span></li>)}</ul>
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

export function SafetyWatchMaterial({ onBack, archive }: MaterialProps) {
  return <Page title="Вахта безопасности" lead="Все палубы и ситуации с правильными ответами и пояснениями — чтобы правила безопасности всегда были под рукой." onBack={onBack} archive={archive}>
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

export function FirstYearMaterial({ onBack, archive }: MaterialProps) {
  return <Page title="Мой первый год в клубе" lead="Все 12 месяцев: какие решения были и чему учит каждое из них." onBack={onBack} archive={archive}>
    {FIRST_YEAR_MONTHS.map((month) => <Section key={month.month} title={`${month.emoji} Месяц ${month.month} · ${month.title}`}>
      <ul className={styles.rows}>{month.choices.map((choice) => <li key={choice.label}><b>{choice.label}</b><span><b>{choice.head}</b> <Bold text={choice.lesson} /></span></li>)}</ul>
    </Section>)}
  </Page>;
}

export function FreeMembershipMaterial({ onBack, archive }: MaterialProps) {
  return <Page title="Безоплатное членство" lead="Памятка тренажёра: что такое личный месяц, где в кабинете смотреть прямой объём и кто из приглашённых уже оплатил." onBack={onBack} archive={archive}>
    <Section title="Главное">
      <ul className={styles.rows}>{FREE_MEMBERSHIP_INTRO.map((card) => <li key={card.title}><b>{card.icon} {card.title}</b><span><Bold text={card.text} /></span></li>)}</ul>
      <p className={styles.note}><Bold text={FREE_MEMBERSHIP_SUMMARY} /></p>
    </Section>
    <Section title="Где это в кабинете: 7 миссий">
      <ol className={styles.answers}>{FREE_MEMBERSHIP_MISSIONS.map((mission) => <li key={mission.text}>
        <b>{mission.text}</b>
        <span className={styles.right}>{mission.ok}</span>
        <span>{mission.okText}</span>
        {mission.ask && <span><b>{mission.ask.q}</b> Правильно: {mission.ask.opts[mission.ask.right]}. {mission.ask.why}</span>}
      </li>)}</ol>
    </Section>
    <Section title="Итоговая проверка">
      <ol className={styles.answers}>{FREE_MEMBERSHIP_QUIZ.map((question) => <li key={question.q}>
        <b>{question.q}</b>
        <span className={styles.right}>Правильно: {question.opts[question.right]}</span>
      </li>)}</ol>
    </Section>
    <p className={styles.note}>Имена и цифры в тренажёре учебные.</p>
  </Page>;
}
