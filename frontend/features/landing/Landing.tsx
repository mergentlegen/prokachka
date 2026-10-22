import Link from "next/link";
import { Geologica, Onest } from "next/font/google";
import type { CSSProperties, ReactNode } from "react";
import { LandingMotion, TiltScene } from "./LandingMotion";
import styles from "./Landing.module.css";

// The public front page for guests, written first for team leaders. «Подключить команду» opens a WhatsApp chat
// with the owner; participant actions lead into the existing sign-up and sign-in screen: /?auth=register and
// /?auth=login open it in the right mode; an invitation link (/?invite=…) and a signed-in session skip this page
// (see app/page.tsx).
export const REGISTER_HREF = "/?auth=register";
export const LOGIN_HREF = "/?auth=login";
export const LEADER_PHONE = "+7 707 689 73 25";
export const LEADER_MESSAGE = "Здравствуйте! Хочу подключить свою команду к Прокачке.";
/** «Подключить команду»: a WhatsApp chat with the message already typed in. */
export const LEADER_HREF = `https://wa.me/${LEADER_PHONE.replace(/\D/g, "")}?text=${encodeURIComponent(LEADER_MESSAGE)}`;
/** Props for every link that opens the WhatsApp chat in a new tab. */
const leaderLink = { href: LEADER_HREF, target: "_blank", rel: "noopener noreferrer" } as const;

const display = Geologica({ subsets: ["latin", "cyrillic"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const text = Onest({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "600"], variable: "--font-text", display: "swap" });

function Mark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="10 4 124 126" aria-hidden="true"><g fill="#E8B65A">
    <path d="M78 10 C84 31 89 36 110 42 C89 48 84 53 78 74 C72 53 67 48 46 42 C67 36 72 31 78 10Z" />
    <path d="M18 104 L42 80 L62 98 L112 48 L126 62 L62 126 L42 108 L30 120 Z" />
    <path d="M101 43 L130 34 L121 63 Z" />
  </g></svg>;
}

const icon = (path: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
const icons = {
  arrow: icon(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>),
  check: icon(<path d="m5 12.5 4.2 4.2L19 7" />),
  steps: icon(<path d="M4 18h5v-5h5V8h6" />),
  eye: icon(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>),
  star: icon(<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" />),
  send: icon(<><path d="M21 3 10.5 13.5" /><path d="M21 3 14.5 21l-4-7.5L3 9.5 21 3Z" /></>),
  mic: icon(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>),
  users: icon(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5" /><path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M17.5 14.2c1.6.7 2.6 2.3 3 4.8" /></>),
  phone: icon(<><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></>),
  chat: icon(<><path d="M3.6 20.4 5 16.3A8.4 8.4 0 1 1 8 19.1Z" /><path d="M9 8.6c0 3.2 2.9 6.2 6.2 6.4l1.3-1.6-2-1.1-.9.8a4.4 4.4 0 0 1-2.3-2.3l.8-.9-1.1-2Z" /></>),
};

const connectSteps = [
  ["Пишете в WhatsApp", "Сообщение уже набрано — осталось отправить"],
  ["Обсуждаем команду", "Сколько людей, какие программы нужны на старте"],
  ["Открываем доступ", "Панель наставника и ссылка-приглашение для новичков"],
] as const;

const pains = [
  ["Задания тонут в чатах", "Ссылки, ответы и вопросы новичков перемешаны с сотней других сообщений. Найти, кто что сдал, — отдельная работа."],
  ["Не видно, кто реально двигается", "Пока не спросишь лично, не узнаешь, что человек застрял на третьем дне и тихо выпадает."],
  ["Рутина съедает вечера", "Напомнить, проверить, ответить каждому — вручную, каждый день, для каждого новичка."],
] as const;

const launch = [
  ["Подключаете команду", "Получаете панель наставника и ссылку-приглашение. Новички регистрируются по ней и сразу попадают в вашу команду."],
  ["Запускаете программу", "Свою — с видео, тестами, PDF и голосовыми ответами — или готовые игры-тренажёры из каталога."],
  ["Ведёте по результату", "Проверяете работы, отвечаете, награждаете звёздами. Напоминания о сроках система отправляет сама."],
] as const;

const faq = [
  ["Сколько времени займёт запуск?", "Команда подключается, вы публикуете первую программу — и участники видят задания сразу после вступления. Начать можно с готовых игр из каталога, а свои шаги добавлять по ходу."],
  ["Можно ли использовать свои материалы?", "Да. Каждый шаг — это описание, видео, вопросы прямо на сайте, PDF-файлы, ссылки и способ ответа: текстом, фото, видео или голосовым в Telegram."],
  ["Как участники попадают в команду?", "По вашей ссылке-приглашению: после регистрации заявка уходит в вашу команду автоматически. Без ссылки человек выбирает команду и отправляет заявку — её одобряете вы."],
  ["Можно ли разделить команду на ветки?", "Да. Структура сети показывает, кто кого привёл. Наставникам веток можно дать право проверять работы и публиковать задания — каждый видит только свою ветку."],
  ["Нужно ли участникам что-то устанавливать?", "Нет. Всё работает в браузере на телефоне и компьютере, а ответы и уведомления идут через Telegram — привязка в одну кнопку."],
  ["Кто видит данные участников?", "Пароль не видит никто. Телефон и работы участника видят только наставники его ветки и руководитель команды."],
] as const;

const people = [
  ["АБ", "Алия Бекова", "Шаг 4 · Первая встреча", "в срок", "ok"],
  ["ТА", "Тимур Ахметов", "Шаг 3 · Список контактов", "ждёт ответа", "wait"],
  ["ДК", "Дана Ким", "Шаг 2 · Видео о себе", "просрочил", "late"],
  ["РИ", "Руслан Ибраев", "Шаг 6 · Итоговый тест", "в срок", "ok"],
] as const;

const inbox = [["ТА", "Тимур Ахметов", "Список контактов", "ждёт 2 дня"], ["ОС", "Ольга Смирнова", "Видео о себе", "ждёт 5 ч"], ["АБ", "Алия Бекова", "Первая встреча", "ждёт 20 мин"]] as const;
const stepsLoad = [["1 · Видео о себе", 46, "ok"], ["2 · Гайд", 41, "ok"], ["3 · Контакты", 33, "wait"], ["4 · Первая встреча", 24, "ok"], ["5 · Разбор", 12, "late"]] as const;
const memberPoints = [
  [icons.steps, "Шаг за шагом", "Программа открывает следующий шаг, когда пройден предыдущий"],
  [icons.users, "Наставник рядом", "Каждая работа проверяется, на вопросы отвечают в переписке по заданию"],
  [icons.star, "Мили, звёзды, рейтинг", "Видно своё место в команде и сколько до следующего"],
  [icons.phone, "Всё с телефона", "Кабинет в браузере, ответы и уведомления — в Telegram"],
] as const;

export function Landing() {
  return <div className={`${styles.page} ${display.variable} ${text.variable}`} data-landing>
    <LandingMotion />
    <header className={styles.header}>
      <div className={`${styles.wrap} ${styles.headerRow}`}>
        <Link className={styles.brand} href="/" aria-label="Прокачка — на главную"><Mark className={styles.mark} /><span>Прокачка</span></Link>
        <nav className={styles.nav} aria-label="Разделы страницы">
          <a href="#features">Возможности</a><a href="#launch">Как запустить</a><a href="#members">Участникам</a><a href="#faq">Вопросы</a>
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.textLink} {...leaderLink}>Подключить команду</a>
          <Link className={`${styles.btn} ${styles.btnGold} ${styles.btnSmall}`} href={LOGIN_HREF}>Войти</Link>
        </div>
      </div>
    </header>

    <main>
      <section className={styles.hero}>
        <div className={styles.stars} aria-hidden="true" />
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}><span className={styles.dot} />Платформа для лидеров команд</p>
            <h1>Команда растёт по&nbsp;системе — даже когда вас нет рядом</h1>
            <p className={styles.heroLead}>Прокачка ведёт каждого новичка по программе: задание на каждый день, проверка работ, рейтинг и уровни. Вы видите, кто где, и тратите время на людей, а не на напоминания.</p>
            <div className={styles.actions}>
              <Link className={`${styles.btn} ${styles.btnGold}`} href={LOGIN_HREF}>Войти в кабинет {icons.arrow}</Link>
              <a className={`${styles.btn} ${styles.btnGhost}`} {...leaderLink}>{icons.chat}Подключить команду</a>
            </div>
            <ul className={styles.heroFacts}>
              <li><b>Пошаговые</b> программы для новичков</li>
              <li><b>Telegram</b> для ответов и напоминаний</li>
              <li><b>Без установки</b> — телефон и компьютер</li>
            </ul>
          </div>

          <TiltScene className={styles.stage}>
            <div className={styles.scene} aria-hidden="true">
              <div className={styles.board}>
                <div className={styles.boardHead}><span className={styles.boardDots}><i /><i /><i /></span><b>Команда «Север»</b><span className={styles.boardTag}>Панель наставника</span></div>
                <div className={styles.boardStats}>
                  <span><b>48</b>участников</span><span><b>3</b>ждут ответа</span><span><b>5</b>на проверке</span>
                </div>
                <div className={styles.funnel}>
                  <span className={styles.funnelTitle}>Программа «Старт» · кто на каком шаге</span>
                  {[92, 78, 64, 51, 38, 22].map((value, index) => <span key={index} className={styles.funnelRow}><em>{index + 1}</em><i style={{ width: value + "%" }} /><small>{Math.round(value / 2)}</small></span>)}
                </div>
                <ul className={styles.people}>
                  {people.map(([initials, name, step, state, tone]) => <li key={name}><span className={styles.avatar}>{initials}</span><span className={styles.personText}><b>{name}</b><small>{step}</small></span><em className={styles[tone]}>{state}</em></li>)}
                </ul>
              </div>
              <div className={`${styles.float} ${styles.floatReview}`}>
                <span className={styles.floatLabel}>Ждут ответа · дольше всех</span>
                <b>Тимур Ахметов</b><small>«Можно добавить ещё пять контактов завтра?» · ждёт 2 дня</small>
                <span className={styles.floatButtons}><i className={styles.accept}>Принять</i><i>На доработку</i></span>
              </div>
              <div className={`${styles.float} ${styles.floatCourse}`}>
                <svg viewBox="0 0 120 120" className={styles.ring}><circle cx="60" cy="60" r="50" /><circle cx="60" cy="60" r="50" className={styles.ringValue} /></svg>
                <span className={styles.ringText}><b>160</b><small>из 300</small></span>
                <span className={styles.ringLabel}>Звёздный курс</span>
              </div>
              <div className={`${styles.float} ${styles.floatTelegram}`}>
                <span className={styles.tgIcon}>{icons.mic}</span><span><b>Голосовое от Алии</b><small>Шаг 4 · отправлено в Telegram</small></span>
              </div>
            </div>
          </TiltScene>
        </div>
        <div className={styles.marquee} aria-hidden="true"><div>{[0, 1].map((copy) => <span key={copy}>Программы<i>✦</i>Проверка работ<i>✦</i>Звёздный курс<i>✦</i>Уровни<i>✦</i>Telegram-бот<i>✦</i>Структура сети<i>✦</i>Рейтинг команды<i>✦</i></span>)}</div></div>
      </section>

      <section className={styles.paper} id="problem">
        <div className={`${styles.wrap} ${styles.problemGrid}`}>
          <div data-reveal>
            <p className={styles.index}>01 · Почему команды буксуют</p>
            <h2>В чатах новички теряются. И&nbsp;вы&nbsp;— вместе с&nbsp;ними.</h2>
          </div>
          <ol className={styles.pains}>
            {pains.map(([title, body], index) => <li key={title} data-reveal style={{ transitionDelay: index * 90 + "ms" }}><span className={styles.painNum}>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}
          </ol>
          <div className={styles.answer} data-reveal>
            <span className={styles.answerLabel}>С Прокачкой</span>
            <ul>
              <li>{icons.check}Каждый новичок видит один понятный следующий шаг</li>
              <li>{icons.check}Вы видите воронку программы и список «Ждут ответа»</li>
              <li>{icons.check}Напоминания и уведомления уходят без вашего участия</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.dark} id="launch">
        <div className={styles.wrap}>
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.index}>02 · Как запустить</p>
            <h2>Три шага — и&nbsp;программа работает на&nbsp;вас</h2>
          </div>
          <div className={styles.launchWrap}>
            <svg className={styles.route} viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true"><path d="M10 20 C 250 -10, 400 50, 500 20 S 800 -10, 990 20" /></svg>
            <ol className={styles.launch}>
              {launch.map(([title, body], index) => <li key={title} data-reveal style={{ transitionDelay: index * 120 + "ms" }}><span className={styles.launchNum}>{index + 1}</span><h3>{title}</h3><p>{body}</p></li>)}
            </ol>
          </div>
        </div>
      </section>

      <section className={styles.paper} id="features">
        <div className={styles.wrap}>
          <div className={styles.sectionHead} data-reveal>
            <p className={styles.index}>03 · Возможности для лидера</p>
            <h2>Всё, что раньше держалось на&nbsp;вашей памяти</h2>
          </div>

          <article className={styles.feature} data-reveal>
            <div className={styles.featureCopy}>
              <span className={styles.featureIcon}>{icons.eye}</span>
              <h3>Проверка работ за минуты, а не вечера</h3>
              <p>Все работы — в одной очереди. Готовые шаблоны ответов, «Принять» или «На доработку» с комментарием. Список «Ждут ответа» собирает вопросы по всем заданиям и показывает, кто ждёт дольше всех.</p>
            </div>
            <div className={styles.mock}>
              <div className={styles.inbox}>
                {inbox.map(([initials, name, task, wait]) => <div key={name} className={styles.inboxRow}><span className={styles.avatar}>{initials}</span><span className={styles.personText}><b>{name}</b><small>{task}</small></span><em className={styles.wait}>{wait}</em></div>)}
                <div className={styles.inboxActions}><span className={styles.accept}>Принять · +10 миль</span><span>На доработку</span></div>
              </div>
            </div>
          </article>

          <article className={`${styles.feature} ${styles.featureFlip}`} data-reveal>
            <div className={styles.featureCopy}>
              <span className={styles.featureIcon}>{icons.steps}</span>
              <h3>Видно каждый шаг каждого</h3>
              <p>Программы с персональным сроком на каждый шаг. Воронка показывает, сколько людей на каждом шаге, кто успевает, а кто просрочил. По любому участнику — полная история его работ.</p>
            </div>
            <div className={styles.mock}>
              <div className={styles.bars}>
                {stepsLoad.map(([label, value, tone]) => <div key={label} className={styles.barRow}><span>{label}</span><i><b className={styles[`bar_${tone}`]} style={{ width: value * 2 + "%" }} /></i><em>{value}</em></div>)}
              </div>
            </div>
          </article>

          <article className={styles.feature} data-reveal>
            <div className={styles.featureCopy}>
              <span className={styles.featureIcon}>{icons.star}</span>
              <h3>Мотивация, которая работает без вас</h3>
              <p>Мили за задания и звёзды за достижения складываются в Звёздный курс до 300. Рейтинг показывает, сколько до следующего места, а прохождение курса открывает уровень «Капитан» — с новыми заданиями и значком.</p>
            </div>
            <div className={`${styles.mock} ${styles.mockCenter}`}>
              <div className={styles.coinStage}>
                <div className={styles.coin}>
                  <div className={styles.coinFace}><Mark className={styles.coinMark} /><span>Капитан</span></div>
                  <div className={`${styles.coinFace} ${styles.coinBack}`}><b>300</b><span>Звёздный курс</span></div>
                </div>
                <div className={styles.coinShadow} />
              </div>
            </div>
          </article>

          <article className={`${styles.feature} ${styles.featureFlip}`} data-reveal>
            <div className={styles.featureCopy}>
              <span className={styles.featureIcon}>{icons.send}</span>
              <h3>Вся связь — в Telegram</h3>
              <p>Участники отправляют ответы фото, видео или голосовым прямо в бот. Решения, ответы наставника, напоминания о сроках и объявления приходят туда же — без потерь в общем чате.</p>
            </div>
            <div className={`${styles.mock} ${styles.mockCenter}`}>
              <div className={styles.phone}>
                <div className={styles.phoneTop}><span className={styles.botAvatar}><Mark /></span><b>Прокачка</b><small>бот</small></div>
                <div className={styles.chat}>
                  <p className={styles.bubbleIn}>Задание «Первая встреча» выбрано. Ответ — голосовое: удерживайте микрофон и отправьте.</p>
                  <p className={styles.bubbleOut}><span className={styles.voice}>{icons.mic}<i /><i /><i /><i /><i /><i /><i /><i /></span>0:42</p>
                  <p className={styles.bubbleIn}>Голосовое отправлено наставнику на проверку.</p>
                  <p className={styles.bubbleIn}>До конца шага «Разбор встречи» осталось 3 часа.</p>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.members} id="members">
        <div className={`${styles.wrap} ${styles.membersGrid}`}>
          <div data-reveal>
            <p className={styles.index}>04 · Участникам</p>
            <h2>Участнику — понятно и&nbsp;азартно</h2>
            <p className={styles.sectionLead}>Не нужно разбираться в чатах: в кабинете всегда виден следующий шаг, срок и награда за него.</p>
            <div className={styles.actions}>
              <Link className={`${styles.btn} ${styles.btnInk}`} href={LOGIN_HREF}>Войти в кабинет {icons.arrow}</Link>
              <Link className={`${styles.btn} ${styles.btnLine}`} href={REGISTER_HREF}>Создать аккаунт</Link>
            </div>
            <p className={styles.note}>Есть ссылка-приглашение от наставника? Откройте её — регистрация начнётся сразу в его команде.</p>
          </div>
          <ul className={styles.memberList}>
            {memberPoints.map(([glyph, title, body]) => <li key={title} data-reveal><span className={styles.memberIcon}>{glyph}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}
          </ul>
        </div>
      </section>

      <section className={styles.paper} id="faq">
        <div className={`${styles.wrap} ${styles.faqGrid}`}>
          <div data-reveal>
            <p className={styles.index}>05 · Вопросы</p>
            <h2>Частые вопросы</h2>
            <p className={styles.sectionLead}>Не нашли ответ? Подключите команду — покажем всё на вашем примере.</p>
          </div>
          <div className={styles.faq}>
            {faq.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true" /></summary><p>{answer}</p></details>)}
          </div>
        </div>
      </section>

      <section className={styles.final}>
        <div className={styles.orbitStage} aria-hidden="true">
          <div className={styles.orbit}>
            <span className={styles.orbitRing} />
            {["Игрок", "Капитан", "Уровень 3"].map((label, index) => <span key={label} className={styles.planet} style={{ "--angle": index * 120 + "deg" } as CSSProperties}><b>{index + 1}</b><small>{label}</small></span>)}
          </div>
        </div>
        <div className={`${styles.wrap} ${styles.connect}`} id="connect">
          <div className={styles.connectText} data-reveal>
            <p className={styles.index}>06 · Подключение</p>
            <h2>Запустите систему для своей команды</h2>
            <p className={styles.connectLead}>Напишите нам в WhatsApp — расскажем, как всё устроено, и подключим вашу команду. Программа, проверка работ, рейтинг и уровни — с первого дня.</p>
            <ol className={styles.connectSteps}>
              {connectSteps.map(([title, note], index) => <li key={title}><span>{index + 1}</span><div><b>{title}</b><small>{note}</small></div></li>)}
            </ol>
            <div className={styles.actions}>
              <Link className={`${styles.btn} ${styles.btnGold}`} href={LOGIN_HREF}>Войти в кабинет {icons.arrow}</Link>
              <a className={`${styles.btn} ${styles.btnWa}`} {...leaderLink}>{icons.chat}Подключить команду</a>
            </div>
            <p className={styles.connectPhone}>WhatsApp: <a {...leaderLink}>{LEADER_PHONE}</a></p>
          </div>
          <TiltScene className={styles.chatStage}>
            <a className={styles.chat} {...leaderLink} aria-label={`Открыть чат WhatsApp ${LEADER_PHONE}`}>
              <span className={styles.chatHead}>
                <span className={styles.chatAvatar}><Mark /></span>
                <span><b>Прокачка</b><small><i />подключение команд</small></span>
                <span className={styles.chatBadge}>{icons.chat}</span>
              </span>
              <span className={styles.chatBody}>
                <span className={styles.chatDay}>сегодня</span>
                <span className={`${styles.bubble} ${styles.bubbleOut}`}>{LEADER_MESSAGE}<small>сейчас ✓✓</small></span>
                <span className={styles.typing} aria-hidden="true"><i /><i /><i /></span>
              </span>
              <span className={styles.chatInput}><span>Сообщение уже набрано</span><span className={styles.chatSend}>{icons.send}</span></span>
            </a>
          </TiltScene>
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
