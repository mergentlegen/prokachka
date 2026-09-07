# Prokachka

Платформа для развития команд через практические задания, программы, рейтинг и обратную связь наставников.

## Возможности

- Регистрация и вход по email и паролю.
- Команды с одной командой на участника.
- Глобальные роли: CEO, наставник и участник.
- Задания без дедлайна, с общим дедлайном и последовательные программы.
- Персональные дедлайны для каждого шага программы.
- Проверка работ наставником, баллы и возврат на доработку.
- Рейтинг команды по баллам и звёздам.
- Объявления команды.
- Привязка Telegram и отправка материалов через бота.
- Автоматическое обновление данных интерфейса.

## Стек

- Next.js 16 и React 19
- TypeScript
- Supabase / PostgreSQL
- Telegram Bot API
- CSS без сторонней UI-библиотеки

## Требования

- Node.js 20+
- npm
- Проект Supabase
- Для Telegram в production — публичный HTTPS-домен

## Быстрый запуск

Установите зависимости:

```powershell
npm install
```

Создайте локальный файл окружения:

```powershell
Copy-Item .env.example .env.local
```

Заполните `.env.local`, затем запустите development-сервер:

```powershell
npm run dev
```

Приложение будет доступно по адресу:

```text
http://localhost:3000
```

## Переменные окружения

Обязательные серверные переменные:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AUTH_SECRET=
```

Telegram:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=
```

Для локального тестирования аккаунтов в разных вкладках можно временно использовать:

```env
AUTH_DEV_MODE=true
```

В production значение должно быть `false`.

Файл `.env.local` нельзя добавлять в Git. Ключ `SUPABASE_SERVICE_ROLE_KEY` используется только на сервере.


## Структура проекта

```text
app/                    Next.js страницы, layout и API routes
frontend/features/      UI-функции участника, наставника, CEO и авторизации
frontend/shared/        Клиентские API, хуки и общие утилиты
backend/controllers/    Обработка HTTP-запросов
backend/services/       Бизнес-логика приложения
backend/infrastructure/ Интеграции с Supabase
shared/domain/          Общие TypeScript-типы
public/brand/           Логотипы и брендовые ассеты
```

## Команды

```powershell
npm run dev      # development-сервер
npm run lint     # проверка TypeScript
npm run build    # production-сборка
npm start        # запуск production-сервера
```

## Production

Перед публикацией:

1. Установите `AUTH_DEV_MODE=false`.
2. Задайте длинный случайный `AUTH_SECRET`.
3. Используйте HTTPS.
4. Проверьте, что секреты отсутствуют в Git.
5. Настройте Telegram webhook на:
   `https://your-domain.example/api/telegram/webhook`.