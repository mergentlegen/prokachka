"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Submission } from "@/shared/domain/types";
import { countDreamAction } from "@/frontend/shared/api/count-your-dream-client";
import { createCompanyVoiceLink } from "@/frontend/shared/api/ready-program-client";
import { ApiError, createTelegramLink } from "@/frontend/shared/api/client";
import styles from "./CountYourDreamGame.module.css";

type Item = { n: string; p: string };
type Form = {
  items: Item[]; currency: "₸" | "$"; howlong: string; plan: string; confidence: number; save: string;
  caseChoice: "" | "fast" | "big"; extraN: string; extraP: string; why: string; value: string; time: string; feel: string; pledged: boolean;
};
const initial: Form = { items: [{ n: "", p: "" }], currency: "₸", howlong: "", plan: "", confidence: 5, save: "", caseChoice: "", extraN: "", extraP: "", why: "", value: "", time: "", feel: "", pledged: false };
const values = [["🕊", "Свобода"], ["👨‍👩‍👧", "Семья"], ["🌍", "Путешествия"], ["🏆", "Признание"], ["📈", "Рост"], ["🛡", "Безопасность"]] as const;
const feelings = [["🔥", "Вдохновение", "Эту энергию важно не потерять. Запомни это чувство — оно пригодится на маршруте."], ["😔", "Немного грустно", "Это нормально. Грусть говорит о том, что мечта для тебя по-настоящему важна. Теперь у неё появился более ясный маршрут."], ["😨", "Страшно от цифр", "Цифры показывают текущий путь, а не твою судьбу. Это точка отсчёта, не приговор."], ["🤔", "Не верю, что это возможно", "Не нужно верить на слово. Посмотри на варианты и реши сам."]] as const;

function restore(raw: Record<string, unknown>): Form {
  const items = Array.isArray(raw.items) ? raw.items.slice(0, 3).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return { n: String(row.n || ""), p: row.p === undefined ? "" : String(row.p) };
  }) : initial.items;
  return { ...initial, ...raw, items: items.length ? items : initial.items, currency: raw.currency === "$" ? "$" : "₸", save: raw.save === undefined ? "" : String(raw.save), extraP: raw.extraP === undefined ? "" : String(raw.extraP), pledged: raw.pledged === true } as Form;
}
function payload(form: Form) { return { ...form, items: form.items.filter((item) => item.n.trim() || item.p).map((item) => ({ n: item.n.trim(), p: Number(item.p) })), save: form.save === "" ? null : Number(form.save), extraP: form.extraP === "" ? null : Number(form.extraP) }; }
function validMoney(value: string, allowZero = false) { return /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) <= 1e12 && (allowZero ? Number(value) >= 0 : Number(value) >= 1); }
function yearsText(years: number) {
  if (years < 1) return "меньше года";
  if (years >= 100) return "больше 100 лет";
  const rounded = Math.round(years * 10) / 10;
  if (!Number.isInteger(rounded)) return `${rounded.toLocaleString("ru-RU")} года`;
  const n = rounded % 100, last = rounded % 10;
  return `${rounded.toLocaleString("ru-RU")} ${n >= 11 && n <= 19 ? "лет" : last === 1 ? "год" : last >= 2 && last <= 4 ? "года" : "лет"}`;
}
function Choice({ options, value, onChange, columns = false }: { options: readonly (readonly [string, string])[]; value: string; onChange: (value: string) => void; columns?: boolean }) {
  return <div className={`${styles.options} ${columns ? styles.two : ""}`}>{options.map(([icon, label]) => <button type="button" key={label} className={`${styles.option} ${value === label ? styles.selected : ""}`} aria-pressed={value === label} onClick={() => onChange(label)}>{icon && <span aria-hidden="true">{icon} </span>}{label}</button>)}</div>;
}
function RoadScene({ active }: { active: boolean }) {
  const id = useId().replace(/:/g, "");
  return <div className={`${styles.scene} ${active ? styles.sceneActive : ""}`}><svg viewBox="0 0 320 230" role="img" aria-label="От туманной дороги к освещённому пути"><defs>
    <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#1a2a3c"/><stop offset=".55" stopColor="#23405f"/><stop offset="1" stopColor="#f0a53a"/></linearGradient>
    <linearGradient id={`${id}-fog`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9d2dc" stopOpacity=".95"/><stop offset="1" stopColor="#c9d2dc" stopOpacity="0"/></linearGradient>
    <linearGradient id={`${id}-road`} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#f4b73f"/><stop offset="1" stopColor="#ffe9a8"/></linearGradient>
    <radialGradient id={`${id}-glow`}><stop offset="0" stopColor="#ffd976" stopOpacity=".9"/><stop offset="1" stopColor="#ffd976" stopOpacity="0"/></radialGradient>
  </defs><rect width="320" height="95" fill={`url(#${id}-sky)`}/><g className={styles.sun}><circle cx="240" cy="92" r="60" fill={`url(#${id}-glow)`}/><circle cx="240" cy="95" r="20" fill="#ffd25e"/></g>
  <rect y="92" width="320" height="138" fill="#0f2b44"/><rect y="92" width="320" height="3" fill="#2b5a80"/><polygon points="15,230 135,230 82,95 72,95" fill="#5b6877"/><polygon points="72,230 78,230 78,95 77,95" fill="#8a96a3" opacity=".6"/><rect x="0" y="80" width="170" height="80" fill={`url(#${id}-fog)`}/>
  <g className={styles.goldenRoad}><polygon points="180,230 305,230 245,95 235,95" fill={`url(#${id}-road)`}/><text x="240" y="89" fontSize="16">🛳</text></g>
  {Array.from({ length: 7 }, (_, k) => { const t = k / 7, y = 225 - t * 125; return [180 + 55 * t + 4, 305 - 60 * t - 4].map((x, i) => <circle key={`${k}-${i}`} className={styles.light} style={{ animationDelay: `${1.8 + k * .17}s` }} cx={x} cy={y} r={Math.max(1.4, 3.4 - k * .3)} fill="#fff7d1"/>); })}
  <g className={styles.wings}><path d="M238 60 C220 40 196 34 178 40 C194 44 204 50 212 58 C200 56 190 58 182 64 C200 64 214 66 224 70 C230 68 235 65 238 60Z" fill="#fff"/><path d="M242 60 C260 40 284 34 302 40 C286 44 276 50 268 58 C280 56 290 58 298 64 C280 64 266 66 256 70 C250 68 245 65 242 60Z" fill="#fff"/><circle cx="240" cy="62" r="4" fill="#ffd25e"/></g></svg></div>;
}

export function CountYourDreamGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  const [form, setForm] = useState<Form>(initial), [step, setStep] = useState(0), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [linkRequired, setLinkRequired] = useState(false);
  const [seconds, setSeconds] = useState(60), [sceneReady, setSceneReady] = useState(false), [completed, setCompleted] = useState(false);
  const inFlight = useRef(false), version = useRef(0), content = useRef<HTMLElement>(null);
  const total = form.items.reduce((sum, item) => sum + (Number(item.p) || 0), 0);
  const savings = Number(form.save) || 0, baseYears = savings > 0 ? total / savings / 12 : Infinity;
  const extra = form.caseChoice === "big" ? Number(form.extraP) || 0 : 0;
  const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ${form.currency}`;
  const dreamName = form.items.filter((item) => item.n.trim()).map((item) => item.n.trim()).join(", ");
  const need = total / 60;
  const combinedYears = savings > 0 ? (total + extra) / savings / 12 : Infinity;
  const combinedGap = (total + extra) / 60 - savings;
  const voiceLine = savings <= 0 ? `Сейчас я не откладываю. Чтобы успеть за 5 лет, нужно ${money(need)} в месяц.`
    : baseYears > 5 ? `Сейчас я откладываю ${money(savings)}, а чтобы успеть за 5 лет, не хватает ${money(need - savings)} в месяц.`
    : form.caseChoice === "fast" ? `Я успеваю за ${yearsText(baseYears)}, но хочу быстрее: для этого нужно ${money(savings * 2)} в месяц.`
    : combinedYears > 5 ? `Первую мечту я могу накопить своими силами, но вместе со второй мечтой (${form.extraN}) не хватает ${money(combinedGap)} в месяц, чтобы успеть за 5 лет.`
      : `Я могу накопить и на вторую мечту (${form.extraN}) за ${yearsText(combinedYears)}, но хочу быстрее и больше.`;
  const voice = `${form.items.filter((item) => item.n.trim()).length > 1 || form.caseChoice === "big" ? "Мои мечты" : "Моя мечта"} — ${dreamName}${form.extraN && form.caseChoice === "big" ? ` и ${form.extraN}` : ""}. ${form.caseChoice === "big" || form.items.length > 1 ? "Вместе они стоят" : "Она стоит"} ${money(total + extra)}. ${voiceLine} Когда я посчитал(а), я почувствовал(а) ${form.feel.toLowerCase()}. Для меня это важно, потому что ${form.why.trim()} Я решил(а) остаться и активно вовлекаться.`;
  function update<K extends keyof Form>(key: K, value: Form[K]) { setForm((previous) => ({ ...previous, [key]: value })); setError(""); }
  function updateItem(index: number, key: keyof Item, value: string) { setForm((previous) => ({ ...previous, items: previous.items.map((item, i) => i === index ? { ...item, [key]: value } : item) })); setError(""); }
  useEffect(() => {
    const current = ++version.current;
    void countDreamAction(taskId, "start").then((saved) => { if (version.current !== current) return; setForm(restore(saved.answers)); setStep(saved.step); setCompleted(saved.completed); setLoading(false); }).catch((cause) => { if (version.current === current) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить тренажёр."); setLoading(false); } });
    return () => { version.current = current + 1; };
  }, [taskId]);
  useEffect(() => { if (step !== 1 || seconds <= 0) return; const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer); }, [step, seconds]);
  useEffect(() => { if (step !== 10) return; const timer = window.setTimeout(() => setSceneReady(true), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 6500); return () => window.clearTimeout(timer); }, [step]);
  useEffect(() => { content.current?.closest("[data-modal-scroll]")?.scrollTo({ top: 0, behavior: "instant" }); content.current?.focus({ preventScroll: true }); }, [step]);
  async function save(next: number, nextForm = form) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try { const result = await countDreamAction(taskId, "save", next, payload(nextForm)); setStep(result.step); setForm(nextForm); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить ответы. Попробуйте ещё раз."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function finish() {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try { const result = await countDreamAction(taskId, "complete"); if (!result.completed || !result.submission) throw new Error("Не удалось подтвердить начисление. Попробуйте ещё раз."); setStep(13); setCompleted(true); onCompleted?.(result.submission); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось завершить тренажёр."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function telegram() {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (linkRequired) { const linked = await createTelegramLink(); if (linked.url) { window.location.assign(linked.url); return; } if (!linked.linked) throw new Error("Не удалось привязать Telegram."); setLinkRequired(false); }
      const { url } = await createCompanyVoiceLink(taskId);
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== "t.me") throw new Error("Некорректная ссылка Telegram.");
      setNotice("В Telegram нажми «Начать», затем запиши голосовое прямо в чате бота.");
      window.location.assign(target.href);
    } catch (cause) { if (cause instanceof ApiError && cause.status === 422) setLinkRequired(true); setError(cause instanceof Error ? cause.message : "Не удалось открыть Telegram."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const button = (label: string, next: number, disabled = false) => <button type="button" className={styles.primary} disabled={busy || disabled} onClick={() => void save(next)}>{busy ? "Сохраняем…" : label}</button>;
  const selected = (options: readonly (readonly [string, string])[], key: "howlong" | "plan" | "value" | "time" | "feel", columns = false) => <Choice options={options} value={form[key]} onChange={(value) => update(key, value)} columns={columns}/>;

  return <section className={styles.game} aria-label="Тренажёр Посчитай свою мечту" ref={content} tabIndex={-1}>
    <div className={styles.wrap}><header className={styles.top}><strong>Посчитай свою мечту</strong><span className={styles.miles}>✈️ {completed ? 10 : 0} миль</span></header><div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(step / 13 * 100)} aria-label="Прогресс тренажёра"><i style={{ width: `${step / 13 * 100}%` }}/></div>
    <article className={styles.card}>
      {step > 0 && step < 13 && <button type="button" className={styles.back} disabled={busy} onClick={() => void save(step - 1)}>← Назад</button>}
      {loading ? <p>Загружаем прогресс…</p> : <>
      {step === 0 && <><span className={styles.kicker}>Блок · Посчитай свою мечту</span><div className={styles.emoji}>💳</div><h2>Деньги сами по себе никому не нужны</h2><p>Нужно то, что они дают: дом, свобода, путешествия, спокойствие за семью. Давай за 5 минут узнаем, чего хочешь именно ты, и посчитаем это.</p>{button("Начать", 1)}</>}
      {step === 1 && <><span className={styles.kicker}>Вопрос 1 из 7</span><h2>Тебе дали карту без лимита. Но только на ОДИН день.</h2><p>Завтра в полночь она перестанет работать. Что ты купишь или оплатишь первым? Пиши первое, что приходит в голову.</p><div className={styles.timer}><strong>{seconds || "⏰"}</strong><span>{seconds ? "секунд на ответ" : "Время вышло. Первое, что пришло в голову, — и есть главное."}</span></div>
        {form.items.map((item, i) => <div className={styles.item} key={i}><label>Что купишь или оплатишь<input maxLength={120} value={item.n} onChange={(event) => updateItem(i, "n", event.target.value)} placeholder="Например, дом для семьи"/></label><label>Сколько это стоит?<input type="number" min="1" max="1000000000000" inputMode="decimal" value={item.p} onChange={(event) => updateItem(i, "p", event.target.value)} placeholder="Только число"/></label></div>)}
        {form.items.length < 3 && <button type="button" className={styles.link} onClick={() => update("items", [...form.items, { n: "", p: "" }])}>+ добавить ещё (до 3)</button>}
        <span className={styles.label}>Валюта</span><Choice options={[["", "₸"], ["", "$"]]} value={form.currency} onChange={(value) => update("currency", value as "₸" | "$")} columns/>
        {button("Дальше", 2, !form.items.some((item) => item.n.trim() && validMoney(item.p)) || form.items.some((item) => Boolean(item.n.trim() || item.p) && (!item.n.trim() || !validMoney(item.p))))}</>}
      {step === 2 && <><span className={styles.kicker}>Вопрос 1 из 7</span><div className={styles.result}><small>Вот что для тебя по-настоящему важно</small><strong>{dreamName}</strong><small>Стоимость</small><b>{money(total)}</b></div><p className={styles.center}>Твоя мечта — не абстракция. У неё есть цена. А значит, до неё можно построить маршрут.</p><h2>Как давно ты об этом думаешь?</h2>{selected([["", "Меньше года"], ["", "1–3 года"], ["", "Больше 3 лет"]], "howlong")}{button("Дальше", 3, !form.howlong)}</>}
      {step === 3 && <><span className={styles.kicker}>Вопрос 2 из 7</span><h2>Есть ли у тебя план на ближайшие 5 лет, как заработать эти деньги?</h2>{selected([["", "Да"], ["", "Нет"]], "plan", true)}{form.plan === "Да" && <label>Насколько ты уверен, что он сработает? <b>{form.confidence}</b>/10<input type="range" min="1" max="10" value={form.confidence} onChange={(event) => update("confidence", Number(event.target.value))}/></label>}{form.plan === "Нет" && <p className={styles.tip}>Ты не один: у большинства людей такого плана нет. Давай посчитаем вместе.</p>}{button("Дальше", 4, !form.plan)}</>}
      {step === 4 && <><span className={styles.kicker}>Вопрос 3 из 7 · Честный расчёт</span><h2>Сколько ты сейчас реально можешь откладывать в месяц?</h2><input type="number" min="0" max="1000000000000" inputMode="decimal" value={form.save} onChange={(event) => update("save", event.target.value)} placeholder="Например, 50000"/><p className={styles.hint}>Честно, без «если бы». Можно 0.</p>{validMoney(form.save, true) && <div className={styles.result}><small>При таком темпе мечта сбудется через</small><b>{savings <= 0 ? "никогда — при текущем темпе" : yearsText(baseYears)}</b></div>}{button("Дальше", 5, !validMoney(form.save, true))}</>}
      {step === 5 && <><span className={styles.kicker}>Вопрос 4 из 7 · Твоя цифра</span>{savings <= 0 ? <><h2>Чтобы мечта сбылась за 5 лет</h2><p>Сейчас у тебя не получается откладывать — и это честно. Чтобы мечта сбылась за 5 лет, нужно откладывать:</p><div className={styles.result}><small>в месяц</small><b>{money(need)}</b></div><p>Запомни эту цифру. Мы ещё к ней вернёмся.</p></> : baseYears > 5 ? <><h2>А если успеть за 5 лет?</h2><p>Ты уже откладываешь — и это здорово.</p><div className={styles.compare}><div><small>Сейчас откладываешь</small><b>{money(savings)}</b></div><div><small>Нужно, чтобы успеть за 5 лет</small><b>{money(need)}</b></div></div><div className={styles.gap}><small>Каждый месяц не хватает</small><b>{money(need - savings)}</b></div><p>Именно эту разницу мы будем искать дальше.</p></> : <><h2>{baseYears < 1 ? "Твоя мечта уже почти в руках! 🎉" : "🎉 Отличный результат!"}</h2><div className={styles.win}>{baseYears < 1 ? "Ты можешь прийти к ней меньше чем за год. Значит, ты готов к большему." : <>Ты можешь прийти к мечте своими силами за <b>{yearsText(baseYears)}</b>. Это говорит о дисциплине.</>}</div>{baseYears >= 1 && <><p>Но давай честно посмотрим на две вещи:</p><ul><li>все эти годы почти каждая свободная копейка уходит только на одну мечту;</li><li>за это время цены тоже вырастут.</li></ul><p><b>А что, если мечтать смелее?</b></p></>}
        <div className={styles.options}>{baseYears >= 1 && <button type="button" className={`${styles.option} ${form.caseChoice === "fast" ? styles.selected : ""}`} aria-pressed={form.caseChoice === "fast"} onClick={() => update("caseChoice", "fast")}>⚡ Хочу быстрее</button>}<button type="button" className={`${styles.option} ${form.caseChoice === "big" ? styles.selected : ""}`} aria-pressed={form.caseChoice === "big"} onClick={() => update("caseChoice", "big")}>🌟 {baseYears < 1 ? "Какая у меня следующая мечта?" : "Хочу мечту больше"}</button></div>
        {form.caseChoice === "fast" && <><p className={styles.tip}>Чтобы мечта сбылась в 2 раза быстрее — за <b>{yearsText(baseYears / 2)}</b>, нужно откладывать:</p><div className={styles.result}><small>в месяц</small><b>{money(savings * 2)}</b></div><div className={styles.gap}><small>Это больше, чем сейчас, на</small><b>{money(savings)}</b></div></>}
        {form.caseChoice === "big" && <><p className={styles.tip}>Что бы ты добавил к своей мечте, если бы денег было в 2 раза больше?</p><label>Моя следующая мечта<input maxLength={120} value={form.extraN} onChange={(event) => update("extraN", event.target.value)} placeholder="Например, путешествие всей семьёй"/></label><label>Сколько она стоит?<input type="number" min="1" max="1000000000000" inputMode="decimal" value={form.extraP} onChange={(event) => update("extraP", event.target.value)} placeholder="Только число"/></label>{form.extraN.trim() && extra > 0 && <><div className={styles.result}><small>Обе мечты вместе стоят</small><b>{money(total + extra)}</b><small>При твоём темпе — через {yearsText(combinedYears)}</small></div>{combinedYears > 5 ? <><div className={styles.compare}><div><small>Сейчас откладываешь</small><b>{money(savings)}</b></div><div><small>Нужно, чтобы успеть за 5 лет</small><b>{money((total + extra) / 60)}</b></div></div><div className={styles.gap}><small>Каждый месяц не хватает</small><b>{money(combinedGap)}</b></div></> : <p>Ты успеваешь даже с двумя мечтами. Ты уже умеешь копить — можно искать, как ускорить путь ещё сильнее.</p>}</>}</>}
        </>}{button("Дальше", 6, baseYears <= 5 && (form.caseChoice === "" || (form.caseChoice === "big" && (!form.extraN.trim() || !validMoney(form.extraP)))))}</>}
      {step === 6 && <><span className={styles.kicker}>Вопрос 5 из 7</span><h2>Что изменится в твоей жизни, когда мечта сбудется?</h2><p>И кто будет рядом с тобой в этот момент?</p><textarea maxLength={1000} value={form.why} onChange={(event) => update("why", event.target.value)} placeholder="Напиши своими словами…"/>{button("Дальше", 7, form.why.trim().length < 5)}</>}
      {step === 7 && <><span className={styles.kicker}>Вопрос 6 из 7</span><h2>Что для тебя важнее всего?</h2><p>Выбери одно — главное.</p>{selected(values, "value", true)}{button("Дальше", 8, !form.value)}</>}
      {step === 8 && <><span className={styles.kicker}>Вопрос 7 из 7</span><h2>Сколько времени в неделю ты готов вкладывать в то, что может приблизить эту мечту?</h2>{selected([["", "3–5 часов"], ["", "5–10 часов"], ["", "10 часов и больше"], ["", "Пока не знаю"]], "time")}{button("Готово", 9, !form.time)}</>}
      {step === 9 && <><span className={styles.kicker}>Пауза</span><h2>Давай на секунду остановимся</h2><p>Ты только что честно посмотрел на свою мечту в цифрах. Это бывает непросто. Что ты чувствуешь сейчас?</p>{selected(feelings.map(([icon, label]) => [icon, label]), "feel")}{form.feel && <div className={styles.feel}>{feelings.find(([, label]) => label === form.feel)?.[2]}</div>}{button("Дальше", 10, !form.feel)}</>}
      {step === 10 && <><span className={styles.kicker}>Ты не был в иллюзии</span><h2>У тебя просто не было карты</h2><p>Большинство людей годами носят мечту в голове и не решаются её посчитать. Ты сегодня посмотрел правде в глаза — это первый шаг.</p><p>Главный вывод не в том, что мечта недостижима. <b>{baseYears <= 5 ? "Текущий путь может привести к ней, а другая дорога — быстрее и к большему." : "Текущего пути для неё не хватает. Значит, нужен ещё один путь."}</b></p><RoadScene active/><div className={styles.roads}><div><b>Текущий путь</b>{savings <= 0 ? "При текущем темпе — никогда" : `${yearsText((total + extra) / savings / 12)} · своими силами`}</div><div><b>Другой путь</b>✨ уже рядом</div></div><div className={`${styles.reveal} ${styles.revealOne}`}>Ты в нужном месте.<br/>В нужное время.</div><p className={`${styles.reveal} ${styles.revealTwo}`}>Ты уже здесь: в клубе, рядом с наставником и командой. Мечта никуда не делась. Просто теперь к ней ведёт не одна дорога, а две.</p><ul className={`${styles.facts} ${styles.reveal} ${styles.revealThree}`}><li>🛫 <b>Ты уже здесь.</b> Первый шаг сделан.</li><li>🧭 <b>Маршрут уже есть.</b> Не нужно начинать с нуля.</li><li>🤝 <b>Ты не один.</b> Рядом наставник и команда.</li></ul><div className={`${styles.reveal} ${styles.revealFour}`}>Твоя мечта ждёт тебя на второй дороге.</div>{button("✨ Расправить крылья →", 11, !sceneReady)}</>}
      {step === 11 && <><span className={styles.kicker}>Твой потенциал</span><h2>Оставаясь здесь, ты увидишь себя по-новому</h2><p>Сегодня ты посчитал мечту. А дальше, шаг за шагом, будешь открывать в себе умение говорить с людьми, вести за собой и доводить цели до результата.</p><p><b>Чем дольше ты с нами, тем яснее видишь, на что способен.</b></p><div className={styles.team}><strong>🌅 Ты не первый на этой дороге</strong><p>Многие люди из команды когда-то стояли там же: с мечтой и сомнениями. Они выбрали идти дальше.</p></div><h3>Как раскрыть свой потенциал</h3><ul className={styles.path}><li><span>📚</span><div><b>Изучай</b>Проходи блоки до конца.</div></li><li><span>🙋</span><div><b>Вовлекайся активно</b>Задавай вопросы и пиши наставнику.</div></li><li><span>⚡</span><div><b>Действуй</b>Маленький шаг сегодня лучше большого плана «когда-нибудь».</div></li></ul><button type="button" className={styles.primary} disabled={busy} onClick={() => { const next = { ...form, pledged: true }; void save(12, next); }}>🙌 Я остаюсь и вовлекаюсь</button></>}
      {step === 12 && <><span className={styles.kicker}>Задание · Сделай</span><div className={styles.emoji}>🎙</div><h2>Расскажи о мечте наставнику — 1 минута</h2><p>Это не экзамен: скажи своими словами, что увидел в цифрах и что для тебя важно. Можно опираться на этот план:</p><blockquote className={styles.quote}>{voice}</blockquote><button type="button" className={styles.primary} disabled={busy} onClick={() => void finish()}>{busy ? "Завершаем…" : "Завершить тренажёр · +10 миль"}</button><p className={styles.hint}>После начисления откроется отправка голосового. Ответ наставника не нужен для 10 миль.</p></>}
      {step === 13 && <><span className={styles.kicker}>Следующий шаг</span><div className={styles.emoji}>✈️</div><h2>Ты знаешь свою мечту</h2><div className={styles.reward}>+10 миль начислены</div><p>Теперь расскажи наставнику, что ты посчитал и какой путь хочешь попробовать. Голосовое получат наставники твоей ветки, у которых есть право проверки.</p><blockquote className={styles.quote}>{voice}</blockquote><button type="button" className={styles.primary} disabled={busy} onClick={() => void telegram()}>{busy ? "Открываем Telegram…" : "🎙 Записать голосовое наставнику"}</button><p className={styles.hint}>В Telegram нажми «Начать» и отправь одно голосовое через микрофон бота. Повторных миль за него нет.</p></>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}{error && <div className={styles.error} role="alert">{error}{step === 0 && <button type="button" className={styles.link} onClick={() => { setLoading(true); setError(""); void countDreamAction(taskId, "start").then((saved) => { setForm(restore(saved.answers)); setStep(saved.step); setCompleted(saved.completed); setLoading(false); }).catch((cause) => { setError(cause instanceof Error ? cause.message : "Не удалось загрузить."); setLoading(false); }); }}>Повторить</button>}</div>}
      </>}
    </article></div>
  </section>;
}
