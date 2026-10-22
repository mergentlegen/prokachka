import type { Metadata } from "next";
import { cookies } from "next/headers";
import { MemberApp } from "@/frontend/features/member/MemberApp";
import { Landing } from "@/frontend/features/landing/Landing";
import { readSession } from "@/backend/services/auth.service";

export const metadata: Metadata = {
  title: "Прокачка — платформа роста команды",
  description: "Платформа для лидеров команд: программы по шагам для новичков, проверка работ, Telegram-бот, рейтинг и уровни. Команда растёт по системе — даже когда вас нет рядом.",
  openGraph: { title: "Прокачка — платформа роста команды", description: "Команда растёт по системе — даже когда вас нет рядом. Программы по шагам, проверка работ, рейтинг и уровни.", locale: "ru_RU", type: "website" },
};

/**
 * A guest on the bare address sees the landing page. Anyone signed in, and any link with parameters
 * (an invitation, ?auth=register|login from the landing, Telegram deep links) opens the app as before.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, store] = await Promise.all([searchParams, cookies()]);
  const signedIn = Boolean(readSession(store.get("incruises_session")?.value));
  if (signedIn || Object.keys(params).length > 0) return <MemberApp />;
  return <Landing />;
}
