import type { Store } from "@/shared/domain/types";

export const seedStore: Store = {
  users: [
    { id: "u-1", name: "Мерген", telegramId: "demo-telegram-mergen", role: "member", createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "u-2", name: "Александр", telegramId: "demo-telegram-alex", role: "member", createdAt: "2026-08-09T10:00:00.000Z" },
    { id: "u-3", name: "Алия", telegramId: "demo-telegram-aliya", role: "member", createdAt: "2026-08-10T10:00:00.000Z" },
  ],
  tasks: [
    {
      id: "task-1",
      title: "Запиши короткое знакомство",
      description: "Расскажи о себе и своей цели в команде за 60 секунд. Отправь видео наставнику.",
      maxPoints: 10,
      isActive: true,
      createdAt: "2026-08-25T09:00:00.000Z",
      updatedAt: "2026-08-25T09:00:00.000Z",
    },
    {
      id: "task-2",
      title: "Презентуй круиз мечты",
      description: "Выбери маршрут и запиши голосовое сообщение: почему клиенту стоит начать с него.",
      maxPoints: 20,
      isActive: true,
      createdAt: "2026-08-21T09:00:00.000Z",
      updatedAt: "2026-08-21T09:00:00.000Z",
    },
    {
      id: "task-3",
      title: "Разбор возражения",
      description: "Ответь на возражение клиента в формате мини-диалога и покажи следующий шаг.",
      maxPoints: 30,
      isActive: true,
      createdAt: "2026-08-15T09:00:00.000Z",
      updatedAt: "2026-08-15T09:00:00.000Z",
    },
    {
      id: "task-4",
      title: "Маршрут клиента",
      description: "Собери путь клиента от первого сообщения до бронирования в пяти шагах.",
      maxPoints: 25,
      isActive: false,
      createdAt: "2026-08-04T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
    },
  ],
  programs: [],
  programProgress: [],
  announcements: [],
  starAwards: [],
  submissions: [
    { id: "s-1", userId: "u-1", taskId: "task-1", status: "accepted", points: 10, comment: "Отличное знакомство, цель звучит уверенно.", mediaType: "demo", submittedAt: "2026-08-26T12:15:00.000Z", reviewedAt: "2026-08-26T13:10:00.000Z" },
    { id: "s-2", userId: "u-1", taskId: "task-3", status: "pending", points: 0, comment: "", mediaType: "demo", submittedAt: "2026-08-30T08:20:00.000Z" },
    { id: "s-3", userId: "u-2", taskId: "task-1", status: "accepted", points: 10, comment: "Хороший темп и ясная подача.", mediaType: "demo", submittedAt: "2026-08-25T14:10:00.000Z", reviewedAt: "2026-08-25T15:00:00.000Z" },
    { id: "s-4", userId: "u-2", taskId: "task-2", status: "accepted", points: 20, comment: "Сильная рекомендация маршрута.", mediaType: "demo", submittedAt: "2026-08-27T14:10:00.000Z", reviewedAt: "2026-08-27T15:00:00.000Z" },
    { id: "s-5", userId: "u-3", taskId: "task-1", status: "accepted", points: 10, comment: "Спасибо за искренность.", mediaType: "demo", submittedAt: "2026-08-27T10:10:00.000Z", reviewedAt: "2026-08-27T11:00:00.000Z" },
    { id: "s-6", userId: "u-3", taskId: "task-2", status: "accepted", points: 20, comment: "Маршрут выбран точно.", mediaType: "demo", submittedAt: "2026-08-29T10:10:00.000Z", reviewedAt: "2026-08-29T11:00:00.000Z" },
    { id: "s-7", userId: "u-3", taskId: "task-3", status: "accepted", points: 30, comment: "Уверенно отработано возражение.", mediaType: "demo", submittedAt: "2026-08-30T10:10:00.000Z", reviewedAt: "2026-08-30T11:00:00.000Z" },
  ],
};

export function cloneSeed() {
  return JSON.parse(JSON.stringify(seedStore)) as Store;
}
