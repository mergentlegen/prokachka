"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Store, Submission, Task, User } from "@/shared/domain/types";
import type { ProgramHistory, ProgramHistoryStatus, PublicationHistoryItem } from "@/shared/domain/history";
import { Avatar } from "@/frontend/shared/Avatar";
import { ModalSheet } from "@/frontend/shared/ModalSheet";
import { formatDate, formatDateTime, formatMiles } from "@/frontend/shared/lib/format";
import { plural } from "@/frontend/shared/lib/plural";
import { participantStatusText, taskParticipantResults, taskProgress, type ParticipantStatus } from "./task-results";
import { TaskResultsSheet } from "./TaskResultsSheet";
import { deadlineLine } from "./AdminTasksView";
import styles from "./AdminHistoryView.module.css";

type Kind = "tasks" | "programs" | "people" | "publications";
const kinds: Array<[Kind, string]> = [["tasks", "Задания"], ["programs", "Программы"], ["people", "Участники"], ["publications", "Публикации"]];

const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
/** "Октябрь 2026" — lists are split by month so the fresh ones are not buried under the old ones. */
export function monthTitle(iso: string) {
  const text = monthFormat.format(new Date(iso)).replace(/\s*г\.$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export function byMonth<T>(items: T[], date: (item: T) => string) {
  const groups: Array<{ title: string; items: T[] }> = [];
  for (const item of items) {
    const title = monthTitle(date(item));
    const last = groups[groups.length - 1];
    if (last?.title === title) last.items.push(item); else groups.push({ title, items: [item] });
  }
  return groups;
}
const matches = (text: string, search: string) => !search || text.toLocaleLowerCase("ru").includes(search);

const programStatusText: Record<ProgramHistoryStatus, string> = {
  on_time: "Успел в срок", active: "Срок ещё идёт", late: "Отправил с опозданием", missed: "Просрочил", completed: "Прошёл программу", locked: "Шаг ещё не открыт",
};
const programStatusTone: Record<ProgramHistoryStatus, string> = { on_time: "good", completed: "good", active: "info", late: "warn", missed: "bad", locked: "muted" };
const participantTone: Record<ParticipantStatus, string> = { accepted: "good", pending: "info", revision: "warn", overdue: "bad", not_started: "muted" };

function Chips({ items }: { items: Array<[string, number, string]> }) {
  const shown = items.filter(([, count]) => count > 0);
  return shown.length ? <span className={styles.chips}>{shown.map(([label, count, tone]) => <span key={label} className={`${styles.chip} ${styles[tone]}`}>{count} {label}</span>)}</span> : null;
}

function Months<T>({ groups, render }: { groups: Array<{ title: string; items: T[] }>; render: (item: T) => ReactNode }) {
  return <div className={styles.months}>{groups.map((group) => <section key={group.title} className={styles.month} aria-label={group.title}>
    <h3>{group.title}</h3>
    <div className={styles.list}>{group.items.map(render)}</div>
  </section>)}</div>;
}

function Empty({ text }: { text: string }) { return <div className={styles.empty}><p>{text}</p></div>; }

/** One program: its steps on top, below who is where on the chosen step, with a search by name. */
export function ProgramHistorySheet({ program, initialQuery = "", onClose }: { program: ProgramHistory; initialQuery?: string; onClose: () => void }) {
  const [position, setPosition] = useState(program.steps[0]?.position || 1);
  const [query, setQuery] = useState(initialQuery);
  const step = program.steps.find((item) => item.position === position) || program.steps[0];
  const search = query.trim().toLocaleLowerCase("ru");
  const members = (step?.members || []).filter((member) => matches(member.name, search));
  const count = (status: ProgramHistoryStatus) => (step?.members || []).filter((member) => member.status === status).length;
  return <ModalSheet title={program.title} tall onClose={onClose}>
    <div className={styles.sheet}>
      <p className={styles.sheetFacts}>{program.steps.length} {plural(program.steps.length, "шаг", "шага", "шагов")} · на каждый шаг {program.deadlineHours} ч с момента открытия</p>
      <div className={styles.steps} role="group" aria-label="Шаг программы">
        {program.steps.map((item) => <button key={item.id} type="button" aria-pressed={item.id === step?.id} className={item.id === step?.id ? styles.stepOn : ""} onClick={() => setPosition(item.position)}>
          <b>Шаг {item.position}</b><span>{item.title}</span>
        </button>)}
      </div>
      {step && <Chips items={[["успели", count("on_time"), "good"], ["срок идёт", count("active"), "info"], ["поздно", count("late"), "warn"], ["просрочили", count("missed"), "bad"]]} />}
      <input id="program-history-search" type="search" className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти участника по имени" aria-label="Найти участника по имени" />
      {members.length === 0 ? <Empty text={search ? "Никого с таким именем." : "На этом шаге пока никого."} /> : <ul className={styles.people}>
        {members.map((member) => <li key={member.userId}>
          <Avatar className={styles.avatar} name={member.name} src={member.avatarUrl} />
          <span className={styles.person}><strong>{member.name}</strong>
            <small>{member.submittedAt ? `отправил ${formatDateTime(member.submittedAt)}` : member.dueAt ? `срок до ${formatDateTime(member.dueAt)}` : ""}{member.points ? ` · +${formatMiles(member.points)}` : ""}</small></span>
          <span className={`${styles.chip} ${styles[programStatusTone[member.status]]}`}>{programStatusText[member.status]}</span>
        </li>)}
      </ul>}
    </div>
  </ModalSheet>;
}

type PersonTask = { task: Task; status: ParticipantStatus; submission?: Submission };

/** Everything one participant has: every task with its result, every program with their place in it. */
function PersonSheet({ person, tasks, programs, store, onOpenTask, onOpenProgram, onClose }: {
  person: User; tasks: Task[]; programs: ProgramHistory[]; store: Store;
  onOpenTask: (task: Task) => void; onOpenProgram: (program: ProgramHistory) => void; onClose: () => void;
}) {
  const results: PersonTask[] = tasks.map((task) => {
    const result = taskParticipantResults(task, { users: [person], submissions: store.submissions })[0];
    return { task, status: result.status, submission: result.submission };
  });
  const accepted = results.filter((item) => item.status === "accepted");
  const memberships = programs.flatMap((program) => {
    const member = program.members.find((item) => item.userId === person.id);
    return member ? [{ program, member }] : [];
  });
  return <ModalSheet title={person.name} tall onClose={onClose}>
    <div className={styles.sheet}>
      <div className={styles.personHead}>
        <Avatar className={styles.bigAvatar} name={person.name} src={person.avatarUrl} />
        <div className={styles.personStats}>
          <span><b>{accepted.length}</b> выполнено</span>
          <span><b>{formatMiles(accepted.reduce((sum, item) => sum + (item.submission?.points || 0), 0))}</b> за задания</span>
          <span><b>{results.filter((item) => item.status === "pending").length}</b> на проверке</span>
        </div>
      </div>
      <h3 className={styles.sheetTitle}>Задания</h3>
      {results.length === 0 ? <Empty text="Заданий пока нет." /> : <div className={styles.list}>
        {results.map((item) => <button key={item.task.id} type="button" className={styles.row} onClick={() => onOpenTask(item.task)}>
          <span className={styles.rowMain}><strong>{item.task.title}</strong><small>{deadlineLine(item.task).text}</small></span>
          <span className={`${styles.chip} ${styles[participantTone[item.status]]}`}>{participantStatusText(item.status)}{item.status === "accepted" ? ` · +${formatMiles(item.submission?.points || 0)}` : ""}</span>
          <i className={styles.arrow} aria-hidden="true">→</i>
        </button>)}
      </div>}
      <h3 className={styles.sheetTitle}>Программы</h3>
      {memberships.length === 0 ? <Empty text="В программах пока не участвует." /> : <div className={styles.list}>
        {memberships.map(({ program, member }) => <button key={program.id} type="button" className={styles.row} onClick={() => onOpenProgram(program)}>
          <span className={styles.rowMain}><strong>{program.title}</strong><small>{member.status === "completed" ? "пройдена" : member.currentStep ? `сейчас шаг ${member.currentStep} из ${program.steps.length}${member.currentTaskTitle ? ` · ${member.currentTaskTitle}` : ""}` : ""}</small></span>
          <span className={`${styles.chip} ${styles[programStatusTone[member.status]]}`}>{programStatusText[member.status]}</span>
          <i className={styles.arrow} aria-hidden="true">→</i>
        </button>)}
      </div>}
    </div>
  </ModalSheet>;
}

type Props = {
  store: Store; programs: ProgramHistory[]; publications: PublicationHistoryItem[];
  onReview: (submission: Submission, status: "accepted" | "revision") => void; actorId?: string;
  onComplete?: (task: Task, member: User) => void; canNudge?: boolean; onNotice?: (message: string) => void;
};

const PEOPLE_PREVIEW = 40;

export function HistoryView({ store, programs, publications, onReview, actorId, onComplete, canNudge, onNotice }: Props) {
  const [kind, setKind] = useState<Kind>("tasks");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PublicationHistoryItem["type"]>("all");
  const [openTask, setOpenTask] = useState<{ id: string; query: string } | null>(null);
  const [openProgram, setOpenProgram] = useState<{ id: string; query: string } | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const search = query.trim().toLocaleLowerCase("ru");
  const publicationTaskIds = new Set(publications.filter((item) => item.type === "task").map((item) => item.id));
  const publicationProgramIds = new Set(publications.filter((item) => item.type === "program").map((item) => item.id));
  const tasks = store.tasks.filter((task) => task.publicationType !== "sequential" && publicationTaskIds.has(task.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visiblePrograms = programs.filter((program) => publicationProgramIds.has(program.id) && program.steps.length > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const people = store.users.filter((user) => user.role === "member").sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const person = people.find((user) => user.id === personId);
  const taskToOpen = tasks.find((task) => task.id === openTask?.id);
  const programToOpen = visiblePrograms.find((program) => program.id === openProgram?.id);
  const placeholder = kind === "people" ? "Найти участника по имени" : kind === "tasks" ? "Найти задание по названию" : kind === "programs" ? "Найти программу по названию" : "Название или автор";

  const taskRow = (task: Task) => {
    const results = taskParticipantResults(task, store);
    const progress = taskProgress(results);
    const deadline = deadlineLine(task);
    return <button key={task.id} type="button" className={styles.card} onClick={() => setOpenTask({ id: task.id, query: "" })}>
      <span className={styles.cardMain}>
        <strong>{task.title}</strong>
        <small>{task.isActive ? deadline.text : "скрыто от участников"}</small>
        {progress.total > 0 && <span className={styles.bar} aria-hidden="true"><span style={{ width: `${(progress.accepted / progress.total) * 100}%` } as CSSProperties} /><span className={styles.waiting} style={{ width: `${((progress.pending + progress.revision) / progress.total) * 100}%` }} /></span>}
        <span className={styles.cardFoot}>
          <b>Ответили {progress.sent} из {progress.total}</b>
          <Chips items={[["выполнено", progress.accepted, "good"], ["на проверке", progress.pending, "info"], ["на доработке", progress.revision, "warn"], ["просрочено", results.filter((result) => result.status === "overdue").length, "bad"]]} />
        </span>
      </span>
      <i className={styles.arrow} aria-hidden="true">→</i>
    </button>;
  };

  const programRow = (program: ProgramHistory) => {
    const count = (status: ProgramHistoryStatus) => program.members.filter((member) => member.status === status).length;
    return <button key={program.id} type="button" className={styles.card} onClick={() => setOpenProgram({ id: program.id, query: "" })}>
      <span className={styles.cardMain}>
        <strong>{program.title}</strong>
        <small>{program.steps.length} {plural(program.steps.length, "шаг", "шага", "шагов")} · {program.deadlineHours} ч на шаг · опубликовано {formatDate(program.createdAt)}</small>
        <span className={styles.cardFoot}>
          <b>{program.members.length} {plural(program.members.length, "участник", "участника", "участников")}</b>
          <Chips items={[["прошли", count("completed"), "good"], ["в процессе", count("active") + count("on_time") + count("late"), "info"], ["просрочили шаг", count("missed"), "bad"]]} />
        </span>
      </span>
      <i className={styles.arrow} aria-hidden="true">→</i>
    </button>;
  };

  const typeLabel = (type: PublicationHistoryItem["type"]) => type === "task" ? "Задание" : type === "program" ? "Программа" : "Объявление";
  const publicationRow = (item: PublicationHistoryItem) => <div key={item.type + ":" + item.id} className={`${styles.card} ${styles.static}`}>
    <span className={styles.cardMain}>
      <span className={styles.typeLine}><span className={`${styles.chip} ${styles["type_" + item.type]}`}>{typeLabel(item.type)}</span>{!item.isActive && <span className={`${styles.chip} ${styles.muted}`}>Скрыто</span>}</span>
      <strong>{item.title}</strong>
      <small>{item.authorName} · {formatDateTime(item.createdAt)}{item.stepCount ? ` · ${item.stepCount} ${plural(item.stepCount, "шаг", "шага", "шагов")}` : ""}</small>
    </span>
  </div>;

  const foundTasks = tasks.filter((task) => matches(task.title, search));
  const foundPrograms = visiblePrograms.filter((program) => matches(program.title, search));
  const foundPeople = people.filter((user) => matches(user.name, search));
  const typed = publications.filter((item) => typeFilter === "all" || item.type === typeFilter);
  const foundPublications = typed.filter((item) => matches(item.title + " " + item.authorName, search)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const typeCounts = (type: "all" | PublicationHistoryItem["type"]) => type === "all" ? publications.length : publications.filter((item) => item.type === type).length;

  return <div className={styles.view}>
    <div className="task-kind-switch history-kind-switch" role="tablist" aria-label="Что показать">
      {kinds.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={kind === id} className={kind === id ? "active" : ""} onClick={() => { setKind(id); setQuery(""); }}>{label}</button>)}
    </div>
    <input id="history-search" type="search" className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} />

    {kind === "tasks" && (tasks.length === 0 ? <Empty text="История заданий пока пуста." /> : foundTasks.length === 0 ? <Empty text="Ничего не нашлось." />
      : <Months groups={byMonth(foundTasks, (task) => task.createdAt)} render={taskRow} />)}

    {kind === "programs" && (visiblePrograms.length === 0 ? <Empty text="История программ пока пуста." /> : foundPrograms.length === 0 ? <Empty text="Ничего не нашлось." />
      : <Months groups={byMonth(foundPrograms, (program) => program.createdAt)} render={programRow} />)}

    {kind === "people" && (people.length === 0 ? <Empty text="Участников пока нет." /> : foundPeople.length === 0 ? <Empty text="Никого с таким именем." /> : <>
      {!search && people.length > PEOPLE_PREVIEW && <p className={styles.hint}>{people.length} {plural(people.length, "участник", "участника", "участников")}. Начните вводить имя, чтобы быстро найти нужного.</p>}
      <div className={styles.list}>{(search ? foundPeople : foundPeople.slice(0, PEOPLE_PREVIEW)).map((user) => {
        const done = store.submissions.filter((submission) => submission.userId === user.id && submission.status === "accepted").length;
        const waiting = store.submissions.filter((submission) => submission.userId === user.id && submission.status === "pending").length;
        return <button key={user.id} type="button" className={`${styles.card} ${styles.personCard}`} onClick={() => setPersonId(user.id)}>
          <Avatar className={styles.avatar} name={user.name} src={user.avatarUrl} />
          <span className={styles.cardMain}><strong>{user.name}</strong><small>{done} {plural(done, "задание выполнено", "задания выполнено", "заданий выполнено")}{waiting ? ` · ${waiting} на проверке` : ""}</small></span>
          <i className={styles.arrow} aria-hidden="true">→</i>
        </button>;
      })}</div>
    </>)}

    {kind === "publications" && <>
      <div className={styles.filters} role="group" aria-label="Тип публикации">
        {([["all", "Все"], ["task", "Задания"], ["program", "Программы"], ["announcement", "Объявления"]] as const).filter(([id]) => id === "all" || typeCounts(id) > 0).map(([id, label]) =>
          <button key={id} type="button" aria-pressed={typeFilter === id} className={typeFilter === id ? styles.filterOn : ""} onClick={() => setTypeFilter(id)}>{label} <b>{typeCounts(id)}</b></button>)}
      </div>
      {publications.length === 0 ? <Empty text="История публикаций пока пуста." /> : foundPublications.length === 0 ? <Empty text="Ничего не нашлось." />
        : <Months groups={byMonth(foundPublications, (item) => item.createdAt)} render={publicationRow} />}
    </>}

    {person && !taskToOpen && !programToOpen && <PersonSheet person={person} tasks={tasks} programs={visiblePrograms} store={store} onClose={() => setPersonId(null)}
      onOpenTask={(task) => setOpenTask({ id: task.id, query: person.name })} onOpenProgram={(program) => setOpenProgram({ id: program.id, query: person.name })} />}
    {taskToOpen && <TaskResultsSheet key={taskToOpen.id + openTask?.query} task={taskToOpen} store={store} actorId={actorId} canNudge={canNudge} onNotice={onNotice} onReview={onReview} onComplete={onComplete}
      initialQuery={openTask?.query} onClose={() => setOpenTask(null)} />}
    {programToOpen && <ProgramHistorySheet key={programToOpen.id + openProgram?.query} program={programToOpen} initialQuery={openProgram?.query} onClose={() => setOpenProgram(null)} />}
  </div>;
}
