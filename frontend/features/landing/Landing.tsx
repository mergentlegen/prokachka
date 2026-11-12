import Image from "next/image";
import Link from "next/link";
import { Onest } from "next/font/google";
import type { ReactNode } from "react";
import styles from "./Landing.module.css";

// The public front page for guests (see app/page.tsx for who gets it).
// It shows the product as it is: every picture is a real screen of the site filled with an invented team
// (scripts/capture-landing-shots.cjs takes them again when the interface changes), and the numbers are those of
// the first team, with their dates. No decoration stands in for the product.
// Sign-in is the main action; «Подключить команду» opens a WhatsApp chat with the owner.
export const REGISTER_HREF = "/?auth=register";
export const LOGIN_HREF = "/?auth=login";
export const LEADER_PHONE = "+7 707 689 73 25";
export const LEADER_MESSAGE = "Здравствуйте! Хочу подключить свою команду к Прокачке.";
/** «Подключить команду»: a WhatsApp chat with the message already typed in. */
export const LEADER_HREF = `https://wa.me/${LEADER_PHONE.replace(/\D/g, "")}?text=${encodeURIComponent(LEADER_MESSAGE)}`;
/** Props for every link that opens the WhatsApp chat in a new tab. */
const leaderLink = { href: LEADER_HREF, target: "_blank", rel: "noopener noreferrer" } as const;

const text = Onest({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], variable: "--font-text", display: "swap" });

/** Real figures of the first team; the period is printed next to them, so they never pretend to be live. */
export const TEAM_PERIOD = "28 сентября — 12 ноября 2026";
export const TEAM_FACTS = [
  ["174", "участника в команде"],
  ["1 642", "работы сдано за шесть недель"],
  ["19 минут", "за это время наставники проверяют половину работ"],
  ["98%", "работ проверено в течение суток"],
] as const;

// Phone screens are 390 × 844 points, taken at double density.
const PHONE = { width: 780, height: 1688 } as const;
const shot = (name: string) => `/landing/${name}.webp`;

const week = [
  { shot: "invite", title: "Приходит по вашей ссылке",
    body: "Открывает ссылку-приглашение и регистрируется. Заявка в вашу команду уходит сама — не нужно никого добавлять вручную.",
    leader: "новую заявку и кто пригласил новичка", alt: "Экран регистрации: «Вас приглашает Марат Сейтов в команду»" },
  { shot: "program", title: "Видит программу по шагам",
    body: "Пройденные шаги, текущий шаг и срок — на одном экране. Следующий шаг откроется, когда наставник примет этот.",
    leader: "на каком шаге каждый участник и кто пропустил срок", alt: "Экран участника: программа «Старт», пройдено 3 шага из 7, сейчас шаг «Первая встреча»" },
  { shot: "step", title: "Отвечает так, как удобно",
    body: "Текстом на сайте, а фото, видео или голосовое — через Telegram-бот. Бот сам напомнит, если срок подходит.",
    leader: "ответ в очереди проверки, а не в ленте общего чата", alt: "Задание «Первая встреча» со сроком и кнопкой «Записать голосовое»" },
  { shot: "feedback", title: "Получает ответ наставника",
    body: "Работа принята или возвращена на доработку с комментарием. Вопросы — в переписке под заданием, а не в личных сообщениях.",
    leader: "список «Ждут ответа»: кто задал вопрос и сколько ждёт", alt: "Переписка с наставником под заданием: работа принята, плюс 10 миль, вопрос и ответ" },
  { shot: "ranking", title: "Набирает мили и растёт в рейтинге",
    body: "За принятые работы начисляются мили. 100 миль открывают уровень «Капитан» с новыми заданиями.",
    leader: "рейтинг команды и темп каждого за неделю", alt: "Рейтинг команды по милям: первые три места и место участника" },
] as const;

const leaderPoints = [
  ["Свои программы", "Шаги собираете сами: текст, видео, тест, PDF и способ ответа. Готовые игры-тренажёры можно поставить шагом программы."],
  ["Ветки и права", "Структура показывает, кто кого привёл. Наставнику ветки можно дать право проверять работы и публиковать задания — только для своей ветки."],
  ["Без ручных напоминаний", "О сроках, решениях по работам и объявлениях бот пишет участникам в Telegram сам."],
] as const;

const questions = [
  ["Сколько времени займёт запуск?", "Мы подключаем команду, вы публикуете первую программу — и участники видят задания сразу после вступления. Начать можно с готовых игр, а свои шаги добавлять по ходу."],
  ["Нужно ли что-то устанавливать?", "Нет. Кабинет работает в браузере на телефоне и компьютере, а ответы и уведомления идут через Telegram — он привязывается одной кнопкой."],
  ["Подойдут ли мои материалы?", "Да. В каждом шаге — описание, видео, вопросы теста, PDF-файлы и ссылка. Вы выбираете, как участник отвечает: текстом, фото, видео или голосовым."],
  ["Кто видит данные участников?", "Пароль не видит никто. Телефон и работы участника видят только наставники его ветки и руководитель команды."],
] as const;

function Mark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="10 4 124 126" aria-hidden="true"><g fill="#E7B85B">
    <path d="M78 10 C84 31 89 36 110 42 C89 48 84 53 78 74 C72 53 67 48 46 42 C67 36 72 31 78 10Z" />
    <path d="M18 104 L42 80 L62 98 L112 48 L126 62 L62 126 L42 108 L30 120 Z" />
    <path d="M101 43 L130 34 L121 63 Z" />
  </g></svg>;
}

const icon = (path: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
const arrow = icon(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>);
const chat = icon(<><path d="M3.6 20.4 5 16.3A8.4 8.4 0 1 1 8 19.1Z" /><path d="M9 8.6c0 3.2 2.9 6.2 6.2 6.4l1.3-1.6-2-1.1-.9.8a4.4 4.4 0 0 1-2.3-2.3l.8-.9-1.1-2Z" /></>);

function Phone({ name, alt, eager = false, className = "" }: { name: string; alt: string; eager?: boolean; className?: string }) {
  return <span className={`${styles.phone} ${className}`}>
    <Image src={shot(name)} alt={alt} {...PHONE} unoptimized loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"} />
  </span>;
}

export function Landing() {
  return <div className={`${styles.page} ${text.variable}`} data-landing>
    <header className={styles.header}>
      <div className={`${styles.wrap} ${styles.headerRow}`}>
        <Link className={styles.brand} href="/" aria-label="Прокачка — на главную"><Mark className={styles.mark} /><span>Прокачка</span></Link>
        <nav className={styles.nav} aria-label="Разделы страницы">
          <a href="#week">Как это работает</a><a href="#leader">Лидеру</a><a href="#questions">Вопросы</a>
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.headerLink} {...leaderLink}>Подключить команду</a>
          <Link className={`${styles.btn} ${styles.btnInk} ${styles.btnSmall}`} href={LOGIN_HREF}>Войти</Link>
        </div>
      </div>
    </header>

    <main>
      <section className={styles.hero}>
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <h1>Новичок знает, что делать завтра. Вы&nbsp;видите, кто застрял.</h1>
            <p className={styles.lead}>Прокачка ведёт новичков вашей команды по программе: выдаёт задания по шагам, принимает ответы через Telegram и напоминает о сроках. Вам остаётся проверять работы и отвечать на вопросы.</p>
            <div className={styles.actions}>
              <Link className={`${styles.btn} ${styles.btnInk}`} href={LOGIN_HREF}>Войти в кабинет {arrow}</Link>
              <a className={`${styles.btn} ${styles.btnLine}`} {...leaderLink}>{chat}Подключить команду</a>
            </div>
            <p className={styles.heroNote}>Новый участник? <Link href={REGISTER_HREF}>Создайте аккаунт</Link> или откройте ссылку-приглашение от наставника.</p>
          </div>
          <figure className={styles.heroShot}>
            <Phone name="program" alt="Экран участника: программа «Старт», пройдено 3 шага из 7, сейчас шаг «Первая встреча»" eager />
            <figcaption>Так программу видит участник: три шага пройдены, четвёртый открыт.</figcaption>
          </figure>
        </div>
      </section>

      <section className={styles.facts} aria-labelledby="facts-title">
        <div className={styles.wrap}>
          <p className={styles.factsTitle} id="facts-title"><b>Первая команда на Прокачке.</b> {TEAM_PERIOD}</p>
          <dl className={styles.factsRow}>
            {TEAM_FACTS.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}
          </dl>
        </div>
      </section>

      <section className={styles.section} id="week">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h2>Первая неделя новичка</h2>
            <p className={styles.lead}>Пять шагов, которые сейчас проходят у вас в общем чате и в личных сообщениях. В каждом — что делает новичок и что в этот момент видите вы.</p>
          </div>
          <div className={styles.week}>
            {week.map((step, index) => <input key={step.shot} className={`${styles.pick} ${styles[`pick${index + 1}`]}`} type="radio" name="week-step"
              id={`week-step-${index + 1}`} defaultChecked={index === 0} aria-label={`Показать экран: ${step.title}`} />)}
            <p className={styles.hint} aria-hidden="true"><span className={styles.hintWide}>Нажмите на шаг — справа появится его экран</span><span className={styles.hintNarrow}>Листайте вбок — пять экранов</span></p>
            <ol className={styles.weekList}>
              {week.map((step, index) => <li key={step.shot} className={styles.weekStep}>
                <label className={styles.weekText} htmlFor={`week-step-${index + 1}`}>
                  <span className={styles.weekNumber} aria-hidden="true">{index + 1}</span>
                  <span className={styles.weekWords}>
                    <b>{step.title}</b>
                    <span>{step.body}</span>
                    <span className={styles.weekLeader}><i>Вы видите:</i> {step.leader}.</span>
                  </span>
                </label>
                <Phone name={step.shot} alt={step.alt} className={styles.weekShot} />
              </li>)}
            </ol>
          </div>
          <p className={styles.honest}>На всех экранах — настоящий интерфейс Прокачки. Участники и команда на них вымышленные.</p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.paper}`} id="leader">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <h2>Что видит лидер</h2>
            <p className={styles.lead}>Все ответы команды приходят в одну очередь: старые — сверху. Голосовое слушаете прямо в панели, «Принять» или «На доработку» — одной кнопкой.</p>
          </div>
          <figure className={styles.panel}>
            <Image className={styles.panelWide} src={shot("mentor-review")} alt="Панель наставника, раздел «Проверка работ»: четыре работы ждут проверки, у первой — голосовой ответ и кнопки «Принять» и «На доработку»"
              width={2560} height={1640} unoptimized />
            <Phone name="mentor-review-phone" alt="Раздел «Проверка работ» на телефоне: работы ждут проверки, кнопки «Принять» и «На доработку»" className={styles.panelNarrow} />
          </figure>
          <ul className={styles.points}>
            {leaderPoints.map(([title, body]) => <li key={title}><h3>{title}</h3><p>{body}</p></li>)}
          </ul>
        </div>
      </section>

      <section className={styles.section} id="questions">
        <div className={`${styles.wrap} ${styles.questionsGrid}`}>
          <h2>Вопросы до подключения</h2>
          <dl className={styles.questions}>
            {questions.map(([question, answer]) => <div key={question}><dt>{question}</dt><dd>{answer}</dd></div>)}
          </dl>
        </div>
      </section>

      <section className={styles.connect} id="connect">
        <div className={`${styles.wrap} ${styles.connectGrid}`}>
          <div>
            <h2>Подключим вашу команду</h2>
            <p className={styles.connectLead}>Напишите нам в WhatsApp — сообщение уже набрано. Расскажем, как всё устроено, откроем панель наставника и дадим ссылку-приглашение для новичков.</p>
            <div className={styles.actions}>
              <a className={`${styles.btn} ${styles.btnGold}`} {...leaderLink}>{chat}Подключить команду</a>
            </div>
            <p className={styles.connectPhone}>WhatsApp: <a {...leaderLink}>{LEADER_PHONE}</a></p>
          </div>
          <div className={styles.forMembers}>
            <h3>Вы участник?</h3>
            <p>Есть ссылка-приглашение от наставника — откройте её, регистрация начнётся сразу в его команде. Нет ссылки — создайте аккаунт и выберите команду.</p>
            <div className={styles.memberActions}>
              <Link className={`${styles.btn} ${styles.btnOnDark}`} href={LOGIN_HREF}>Войти в кабинет {arrow}</Link>
              <Link className={styles.memberLink} href={REGISTER_HREF}>Создать аккаунт</Link>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer className={styles.footer}>
      <div className={`${styles.wrap} ${styles.footerRow}`}>
        <span className={styles.footerBrand}><Mark className={styles.markSmall} />Прокачка · платформа роста команды</span>
        <nav aria-label="Вход"><Link href={LOGIN_HREF}>Войти</Link><Link href={REGISTER_HREF}>Регистрация</Link><Link href="/admin">Панель наставника</Link></nav>
      </div>
    </footer>
  </div>;
}
