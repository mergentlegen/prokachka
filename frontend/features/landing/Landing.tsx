import Link from "next/link";
import { Onest } from "next/font/google";
import type { ReactNode } from "react";
import { LandingMotion, ScrollTilt } from "./LandingMotion";
import styles from "./Landing.module.css";

// The public front page for guests. Its look follows the app itself (cream ground, white panels, navy text,
// Manrope headings), so the interface pictures read as the real product. Sign-in is the main action;
// «Подключить команду» opens a WhatsApp chat with the owner. /?auth=register and /?auth=login open the sign-up
// and sign-in screen in the right mode; an invitation link (/?invite=…) and a signed-in session skip this page
// (see app/page.tsx).
export const REGISTER_HREF = "/?auth=register";
export const LOGIN_HREF = "/?auth=login";
export const LEADER_PHONE = "+7 707 689 73 25";
export const LEADER_MESSAGE = "Здравствуйте! Хочу подключить свою команду к Прокачке.";
/** «Подключить команду»: a WhatsApp chat with the message already typed in. */
export const LEADER_HREF = `https://wa.me/${LEADER_PHONE.replace(/\D/g, "")}?text=${encodeURIComponent(LEADER_MESSAGE)}`;
/** Props for every link that opens the WhatsApp chat in a new tab. */
const leaderLink = { href: LEADER_HREF, target: "_blank", rel: "noopener noreferrer" } as const;

const text = Onest({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], variable: "--font-text", display: "swap" });

function Mark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="10 4 124 126" aria-hidden="true"><g fill="#E7B85B">
    <path d="M78 10 C84 31 89 36 110 42 C89 48 84 53 78 74 C72 53 67 48 46 42 C67 36 72 31 78 10Z" />
    <path d="M18 104 L42 80 L62 98 L112 48 L126 62 L62 126 L42 108 L30 120 Z" />
    <path d="M101 43 L130 34 L121 63 Z" />
  </g></svg>;
}

const icon = (path: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
const icons = {
  arrow: icon(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>),
  check: icon(<path d="m5 12.5 4.2 4.2L19 7" />),
  cross: icon(<><path d="M7 7l10 10" /><path d="M17 7 7 17" /></>),
  send: icon(<><path d="M21 3 10.5 13.5" /><path d="M21 3 14.5 21l-4-7.5L3 9.5 21 3Z" /></>),
  mic: icon(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>),
  steps: icon(<path d="M4 18h5v-5h5V8h6" />),
  users: icon(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5" /><path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M17.5 14.2c1.6.7 2.6 2.3 3 4.8" /></>),
  star: icon(<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" />),
  phone: icon(<><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></>),
  chat: icon(<><path d="M3.6 20.4 5 16.3A8.4 8.4 0 1 1 8 19.1Z" /><path d="M9 8.6c0 3.2 2.9 6.2 6.2 6.4l1.3-1.6-2-1.1-.9.8a4.4 4.4 0 0 1-2.3-2.3l.8-.9-1.1-2Z" /></>),
};

type Tone = "ok" | "wait" | "late" | "check";
const toneLabel: Record<Tone, string> = { ok: "в срок", wait: "ждёт ответа", late: "просрочил", check: "на проверке" };

const people: ReadonlyArray<readonly [string, string, number, string, Tone]> = [
  ["АБ", "Алия Бекова", 4, "Первая встреча", "ok"],
  ["ТА", "Тимур Ахметов", 3, "Список контактов", "wait"],
  ["ДК", "Дана Ким", 2, "Видео о себе", "late"],
  ["РИ", "Руслан Ибраев", 6, "Итоговый тест", "check"],
  ["ОС", "Ольга Смирнова", 5, "Разбор встречи", "ok"],
];

const compare = [
  ["Задания", "Теряются среди сотен сообщений в общем чате", "Открываются по шагам в кабинете, у каждого шага свой срок"],
  ["Ответы новичков", "Приходят в личку, в чат и голосовыми — вперемешку", "Собираются в одну очередь проверки"],
  ["Напоминания", "Вы пишете каждому вручную", "Бот сам напоминает о сроках в Telegram"],
  ["Прогресс", "Не видно, кто застрял, пока не спросишь лично", "Видны шаг и статус каждого участника"],
  ["Мотивация", "Держится на вашей энергии", "Мили, звёзды, рейтинг команды и уровни"],
] as const;

const launch = [
  ["Подключаете команду", "Получаете панель наставника и ссылку-приглашение. Новички регистрируются по ней и сразу попадают в вашу команду."],
  ["Публикуете программу", "Свою — с видео, тестами, PDF и голосовыми ответами — или готовые игры-тренажёры из каталога."],
  ["Проверяете и отвечаете", "Работы приходят в очередь, напоминания о сроках бот отправляет сам. Вы занимаетесь людьми, а не рутиной."],
] as const;

const queue = [["ТА", "Тимур Ахметов", "Список контактов", "2 дня"], ["ОС", "Ольга Смирнова", "Видео о себе", "5 ч"], ["АБ", "Алия Бекова", "Первая встреча", "20 мин"]] as const;
const funnel = [["Видео о себе", 46], ["Гайд по старту", 41], ["Список контактов", 33], ["Первая встреча", 24], ["Разбор встречи", 12]] as const;
const ranking = [["1", "Алия Бекова", 212], ["2", "Руслан Ибраев", 198], ["3", "Ольга Смирнова", 174], ["4", "Вы", 160]] as const;

const memberPoints = [
  [icons.steps, "Шаг за шагом", "Следующий шаг программы открывается, когда пройден предыдущий."],
  [icons.users, "Наставник рядом", "Каждую работу проверяют, на вопросы отвечают в переписке по заданию."],
  [icons.star, "Рейтинг и уровни", "Мили и звёзды за задания, место в команде и уровень «Капитан»."],
  [icons.phone, "Всё с телефона", "Кабинет в браузере, ответы и уведомления — в Telegram."],
] as const;

const faq = [
  ["Сколько времени займёт запуск?", "Команда подключается, вы публикуете первую программу — и участники видят задания сразу после вступления. Начать можно с готовых игр из каталога, а свои шаги добавлять по ходу."],
  ["Можно ли использовать свои материалы?", "Да. Каждый шаг — это описание, видео, вопросы прямо на сайте, PDF-файлы, ссылки и способ ответа: текстом, фото, видео или голосовым в Telegram."],
  ["Как участники попадают в команду?", "По вашей ссылке-приглашению: после регистрации заявка уходит в вашу команду автоматически. Без ссылки человек выбирает команду и отправляет заявку — её одобряете вы."],
  ["Можно ли разделить команду на ветки?", "Да. Структура сети показывает, кто кого привёл. Наставникам веток можно дать право проверять работы и публиковать задания — каждый видит только свою ветку."],
  ["Нужно ли участникам что-то устанавливать?", "Нет. Всё работает в браузере на телефоне и компьютере, а ответы и уведомления идут через Telegram — привязка в одну кнопку."],
  ["Кто видит данные участников?", "Пароль не видит никто. Телефон и работы участника видят только наставники его ветки и руководитель команды."],
] as const;

const connectSteps = [
  ["Пишете в WhatsApp", "Сообщение уже набрано — осталось отправить"],
  ["Обсуждаем команду", "Сколько людей и какие программы нужны на старте"],
  ["Открываем доступ", "Панель наставника и ссылка-приглашение для новичков"],
] as const;

const Status = ({ tone }: { tone: Tone }) => <em className={`${styles.status} ${styles[tone]}`}>{toneLabel[tone]}</em>;
const Avatar = ({ initials }: { initials: string }) => <span className={styles.avatar}>{initials}</span>;

export function Landing() {
  return <div className={`${styles.page} ${text.variable}`} data-landing>
    <LandingMotion />
    <header className={styles.header}>
      <div className={`${styles.wrap} ${styles.headerRow}`}>
        <Link className={styles.brand} href="/" aria-label="Прокачка — на главную"><Mark className={styles.mark} /><span>Прокачка</span></Link>
        <nav className={styles.nav} aria-label="Разделы страницы">
          <a href="#features">Возможности</a><a href="#launch">Запуск</a><a href="#members">Участникам</a><a href="#faq">Вопросы</a>
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.headerLink} {...leaderLink}>Подключить команду</a>
          <Link className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`} href={LOGIN_HREF}>Войти</Link>
        </div>
      </div>
    </header>

    <main>
      <section className={styles.hero}>
        <div className={`${styles.wrap} ${styles.heroCopy}`}>
          <h1>Система обучения новичков для&nbsp;вашей команды</h1>
          <p className={styles.heroLead}>Задания по шагам, проверка работ, ответы через Telegram и рейтинг — в одном месте. Новички идут по программе, а вы видите, кто где и кто застрял.</p>
          <div className={styles.actions}>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} href={LOGIN_HREF}>Войти в кабинет {icons.arrow}</Link>
            <a className={`${styles.btn} ${styles.btnOutline}`} {...leaderLink}>{icons.chat}Подключить команду</a>
          </div>
          <p className={styles.heroNote}>Новый участник? <Link href={REGISTER_HREF}>Создайте аккаунт</Link> или откройте ссылку-приглашение от наставника.</p>
        </div>

        <div className={styles.wrap}>
          <ScrollTilt className={styles.frame}>
            <div className={styles.frameBar} aria-hidden="true"><i /><i /><i /><span>Панель наставника</span></div>
            <div className={styles.app} aria-label="Пример панели наставника" role="img">
              <div className={styles.appHead}>
                <div><small>Программа</small><b>«Старт» · 7 шагов</b></div>
                <span className={styles.appChip}>48 участников</span>
              </div>
              <div className={styles.metrics}>
                <span><b>3</b>ждут ответа</span><span><b>5</b>на проверке</span><span><b>12</b>прошли программу</span><span className={styles.metricWide}><b>87%</b>сдают в срок</span>
              </div>
              <div className={styles.table}>
                <div className={styles.tableHead}><span>Участник</span><span>Шаг</span><span>Статус</span></div>
                {people.map(([initials, name, step, title, tone]) => <div key={name} className={styles.tableRow}>
                  <span className={styles.person}><Avatar initials={initials} /><span><b>{name}</b><small>{title}</small></span></span>
                  <span className={styles.progress}><i><b style={{ width: (step / 7) * 100 + "%" }} /></i><small>{step} из 7</small></span>
                  <Status tone={tone} />
                </div>)}
              </div>
            </div>
          </ScrollTilt>
        </div>
      </section>

      <section className={styles.section} id="problem">
        <div className={styles.wrap}>
          <div className={styles.sectionHead} data-reveal>
            <h2>Когда команда учится в общем чате, всё держится на&nbsp;вас</h2>
            <p className={styles.sectionLead}>Прокачка забирает рутину: выдаёт задания, собирает ответы и напоминает о сроках. Вам остаётся то, что важно, — люди.</p>
          </div>
          <div className={styles.compare} data-reveal>
            <div className={styles.compareHead} aria-hidden="true"><span /><span>В общем чате</span><span>В Прокачке</span></div>
            {compare.map(([topic, before, after]) => <div key={topic} className={styles.compareRow}>
              <b>{topic}</b>
              <span className={styles.before}>{icons.cross}<span><span className={styles.mobileLabel}>В чате: </span>{before}</span></span>
              <span className={styles.after}>{icons.check}<span><span className={styles.mobileLabel}>В Прокачке: </span>{after}</span></span>
            </div>)}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionWhite}`} id="launch">
        <div className={styles.wrap}>
          <div className={styles.sectionHead} data-reveal><h2>Запуск в три шага</h2></div>
          <ol className={styles.launch}>
            {launch.map(([title, body], index) => <li key={title} data-reveal><span className={styles.launchNum}>Шаг {index + 1}</span><h3>{title}</h3><p>{body}</p></li>)}
          </ol>
        </div>
      </section>

      <section className={styles.section} id="features">
        <div className={styles.wrap}>
          <div className={styles.sectionHead} data-reveal><h2>Что получает лидер команды</h2></div>

          <article className={styles.feature} data-reveal>
            <div className={styles.featureCopy}>
              <h3>Все работы — в одной очереди</h3>
              <p>Ответы участников приходят в очередь проверки. «Принять» или «На доработку» с комментарием, готовые шаблоны ответов. Список «Ждут ответа» показывает, кто ждёт дольше всех.</p>
            </div>
            <div className={styles.panel} aria-hidden="true">
              <div className={styles.panelTitle}><b>Ждут ответа</b><span>3</span></div>
              {queue.map(([initials, name, task, wait]) => <div key={name} className={styles.queueRow}><Avatar initials={initials} /><span className={styles.personText}><b>{name}</b><small>{task}</small></span><em className={styles.waitTime}>{wait}</em></div>)}
              <div className={styles.queueActions}><span className={styles.accept}>Принять · +10 миль</span><span className={styles.revise}>На доработку</span></div>
            </div>
          </article>

          <article className={`${styles.feature} ${styles.featureFlip}`} data-reveal>
            <div className={styles.featureCopy}>
              <h3>Прогресс каждого — по шагам</h3>
              <p>У каждого шага персональный срок. Воронка показывает, сколько людей на каждом шаге, кто успевает, а кто просрочил. По любому участнику — полная история его работ.</p>
            </div>
            <div className={styles.panel} aria-hidden="true">
              <div className={styles.panelTitle}><b>Программа «Старт»</b><span>48</span></div>
              <div className={styles.funnel}>
                {funnel.map(([label, value], index) => <div key={label} className={styles.funnelRow}><span>{index + 1}. {label}</span><i><b style={{ width: (value / 48) * 100 + "%" }} /></i><em>{value}</em></div>)}
              </div>
            </div>
          </article>

          <article className={styles.feature} data-reveal>
            <div className={styles.featureCopy}>
              <h3>Мотивация, которая работает без вас</h3>
              <p>Мили за задания и звёзды за достижения складываются в опыт — до 300 XP. Рейтинг показывает, сколько XP до следующего места, а 300 XP открывают уровень «Капитан» с новыми заданиями и значком.</p>
            </div>
            <div className={`${styles.panel} ${styles.course}`} aria-hidden="true">
              <div className={styles.courseTop}>
                <div className={styles.coinStage}>
                  <div className={styles.coin}>
                    <span className={styles.coinFace}><Mark className={styles.coinMark} /><small>Капитан</small></span>
                    <span className={`${styles.coinFace} ${styles.coinBack}`}><b>300</b><small>XP</small></span>
                  </div>
                </div>
                <div className={styles.courseMeter}>
                  <small>Опыт</small>
                  <b>160 <span>из 300 XP</span></b>
                  <i><b style={{ width: "53%" }} /></i>
                  <small>До уровня «Капитан» — 140 XP</small>
                </div>
              </div>
              <ol className={styles.ranking}>
                {ranking.map(([place, name, score]) => <li key={name} className={name === "Вы" ? styles.rankMe : undefined}><span>{place}</span><b>{name}</b><em>{score}</em></li>)}
              </ol>
            </div>
          </article>

          <article className={`${styles.feature} ${styles.featureFlip}`} data-reveal>
            <div className={styles.featureCopy}>
              <h3>Вся связь — в Telegram</h3>
              <p>Участники отправляют ответы фото, видео или голосовым прямо в бот. Решения, ответы наставника, напоминания о сроках и объявления приходят туда же — ничего не теряется в общем чате.</p>
            </div>
            <div className={styles.phoneWrap} aria-hidden="true">
              <div className={styles.phone}>
                <div className={styles.phoneTop}><span className={styles.botAvatar}><Mark /></span><span><b>Прокачка</b><small>бот</small></span></div>
                <div className={styles.tgChat}>
                  <p className={styles.tgIn}>Задание «Первая встреча» выбрано. Ответ — голосовое: удерживайте микрофон и отправьте.</p>
                  <p className={styles.tgOut}><span className={styles.voice}>{icons.mic}<i /><i /><i /><i /><i /><i /><i /><i /></span><small>0:42</small></p>
                  <p className={styles.tgIn}>Голосовое отправлено наставнику на проверку.</p>
                  <p className={styles.tgIn}>Работа принята ✓ +10 миль. До конца шага «Разбор встречи» — 3 дня.</p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionWhite}`} id="members">
        <div className={`${styles.wrap} ${styles.membersGrid}`}>
          <div data-reveal>
            <h2>Участникам</h2>
            <p className={styles.sectionLead}>В кабинете всегда виден следующий шаг, срок и награда за него. Не нужно искать задания в чатах.</p>
            <div className={styles.actions}>
              <Link className={`${styles.btn} ${styles.btnPrimary}`} href={LOGIN_HREF}>Войти в кабинет {icons.arrow}</Link>
              <Link className={`${styles.btn} ${styles.btnOutline}`} href={REGISTER_HREF}>Создать аккаунт</Link>
            </div>
            <p className={styles.note}>Есть ссылка-приглашение от наставника? Откройте её — регистрация начнётся сразу в его команде.</p>
          </div>
          <ul className={styles.memberList}>
            {memberPoints.map(([glyph, title, body]) => <li key={title} data-reveal><span className={styles.memberIcon}>{glyph}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}
          </ul>
        </div>
      </section>

      <section className={styles.section} id="faq">
        <div className={`${styles.wrap} ${styles.faqGrid}`}>
          <div data-reveal>
            <h2>Частые вопросы</h2>
            <p className={styles.sectionLead}>Не нашли ответ? Напишите нам — покажем всё на примере вашей команды.</p>
          </div>
          <div className={styles.faq}>
            {faq.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true" /></summary><p>{answer}</p></details>)}
          </div>
        </div>
      </section>

      <section className={styles.connectBand} id="connect">
        <div className={`${styles.wrap} ${styles.connect}`}>
          <div className={styles.connectText} data-reveal>
            <h2>Подключите свою команду</h2>
            <p className={styles.connectLead}>Напишите нам в WhatsApp — расскажем, как всё устроено, и подключим вашу команду. Программа, проверка работ, рейтинг и уровни работают с первого дня.</p>
            <ol className={styles.connectSteps}>
              {connectSteps.map(([title, note], index) => <li key={title}><span>{index + 1}</span><div><b>{title}</b><small>{note}</small></div></li>)}
            </ol>
            <div className={styles.actions}>
              <Link className={`${styles.btn} ${styles.btnGold}`} href={LOGIN_HREF}>Войти в кабинет {icons.arrow}</Link>
              <a className={`${styles.btn} ${styles.btnWa}`} {...leaderLink}>{icons.chat}Подключить команду</a>
            </div>
            <p className={styles.connectPhone}>WhatsApp: <a {...leaderLink}>{LEADER_PHONE}</a></p>
          </div>
          <a className={styles.wa} {...leaderLink} aria-label={`Открыть чат WhatsApp ${LEADER_PHONE}`} data-reveal>
            <span className={styles.waHead}>
              <span className={styles.waAvatar}><Mark /></span>
              <span><b>Прокачка</b><small><i />подключение команд</small></span>
              <span className={styles.waBadge}>{icons.chat}</span>
            </span>
            <span className={styles.waBody}>
              <span className={styles.waDay}>сегодня</span>
              <span className={styles.waBubble}>{LEADER_MESSAGE}<small>сейчас ✓✓</small></span>
              <span className={styles.typing} aria-hidden="true"><i /><i /><i /></span>
            </span>
            <span className={styles.waInput}><span>Сообщение уже набрано</span><span className={styles.waSend}>{icons.send}</span></span>
          </a>
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
