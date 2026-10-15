"use client";
import type { Store, Submission } from "@/shared/domain/types";
import { SubmissionCard } from "./SubmissionCard";
import { plural, waitingInfo } from "./review-queue";

export function AccessDenied({ onLogout }: { onLogout: () => void }) { return <main className="admin-login"><div className="admin-login-card"><a className="brand" href="/"><img className="brand-logo" src="/brand/logo.svg" alt="Прокачка" /></a><p className="eyebrow">Доступ ограничен</p><h1>Это раздел наставника</h1><p>Твой аккаунт участника не может открыть админ-панель.</p><button className="primary-button full" onClick={() => { void onLogout(); }}>Выйти</button><a className="back-link" href="/">Вернуться к заданиям</a></div></main>; }
// The mentor task list lives in its own file; this module keeps exporting it for the panel.
export { TasksView } from "./AdminTasksView";
export { HistoryView } from "./AdminHistoryView";

export function ReviewView({ store, submissions, onReview, onStart, onEditTemplates }: { store: Store; submissions: Submission[]; onReview: (submission: Submission, status: "accepted" | "revision") => void; onStart: () => void; onEditTemplates?: () => void }) {
  const oldest = submissions[0] ? waitingInfo(submissions[0].submittedAt) : null;
  return <div className="submission-review-list">
    {submissions.length > 0 && <div className="review-queue-bar"><div><strong>{submissions.length} {plural(submissions.length, "работа ждёт", "работы ждут", "работ ждут")} проверки</strong>{oldest && <small>Сверху самые старые · первая {oldest.text}</small>}</div>
      <div className="review-queue-actions">{onEditTemplates && <button type="button" className="button button-edit" onClick={onEditTemplates}>Готовые комментарии</button>}<button type="button" className="button button-primary" onClick={onStart}>Проверять по очереди</button></div></div>}
    {submissions.length === 0 ? <div className="admin-panel"><EmptyAdmin text="Нет работ, ожидающих проверки." /></div> : submissions.map((submission) =>
      <SubmissionCard key={submission.id} submission={submission} name={store.users.find((user) => user.id === submission.userId)?.name || "Неизвестный участник"} avatarUrl={store.users.find((user) => user.id === submission.userId)?.avatarUrl} taskTitle={submission.taskTitle || store.tasks.find((task) => task.id === submission.taskId)?.title || "Удалённое задание"} onReview={onReview} />
    )}</div>;
}
function EmptyAdmin({ text }: { text: string }) { return <div className="empty-admin"><span>✓</span><p>{text}</p></div>; }
