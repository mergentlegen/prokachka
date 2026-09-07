import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prokachka",
  description: "Платформа развития команд через практические задания",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
