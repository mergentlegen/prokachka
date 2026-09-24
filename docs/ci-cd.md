# CI/CD для Prokachka

Подтверждено по выводу сервера: systemd, активный `prokachka.service`, пользователь `ubuntu`,
Node.js `22.23.2`, архитектура `x86_64`. Инструкция рассчитана на эту конфигурацию.
До завершения первоначальной настройки оставьте `PRODUCTION_DEPLOY_ENABLED=false`.

Всё выполняется в одном workflow `.github/workflows/check.yml`.
CI проверяет ветки и PR в `main`; CD разрешён только для `main` после успеха всех проверок.
На сервер передаётся готовый Linux x64 / Node.js 22 пакет из того же запуска CI.

1. **Code quality:** ESLint, TypeScript, Bash/ShellCheck.
2. **Unit and deployment tests:** тесты приложения и сценарии неудачного деплоя/отката.
3. **Database integration:** отдельный PostgreSQL 17, bootstrap, SQL и конкурентные тесты. Тест миграции звёзд использует ещё одну пустую БД.
4. **Build and smoke test:** production-сборка, упаковка, запуск пакета; HTTP-проверки страниц, JS/CSS, шрифтов, логотипа, отсутствующей сессии (ожидается 401), защиты Host и номера релиза.
5. **CI passed:** общий обязательный статус; любой провал/пропуск проверки блокирует его.
6. **Deploy production:** загрузка пакета по SSH, проверка checksum, запуск на 3100, переключение `current`, restart systemd, проверка на 3000. При ошибке после переключения возвращается прежний релиз.

`/api/health` проверяет процесс и номер релиза. Он не проверяет соединение с Supabase, Telegram или бизнес-сценарии.
При проверке localhost явно передаётся `Host: prokachka.kz`, так как production отклоняет неизвестные Host.

## Перед включением

Автодеплой выключен до установки repository variable `PRODUCTION_DEPLOY_ENABLED=true`.
Настроить файлы в Git недостаточно: нужны GitHub Secrets и однократная настройка systemd на сервере.
Приватные ключи, `AUTH_SECRET`, Telegram token и Supabase service role остаются вне репозитория.
Миграции production, Nginx, TLS и cron workflow не изменяет.

Требования к серверу: **Ubuntu 22.04 или новее, x86_64, Node.js 22**, systemd, bash, tar, curl, flock.
Сборка содержит Linux-зависимости, поэтому для ARM нужен другой runner и повторная сборка.

## 1. Уточните имя сервиса и окружение на сервере

Выполните по SSH:

```bash
systemctl list-units --type=service --all --no-pager | grep -Ei 'prokachka|incruises|next|node|pm2'
ps -eo pid,ppid,user,comm | grep -Ei 'node|next|npm|pm2'
command -v pm2
node --version
uname -m
command -v node
ls -l /var/www/prokachka/.env.production /var/www/prokachka/.env.local
```

Если найден systemd-сервис самого сайта, проверьте его через `systemctl cat ИМЯ_СЕРВИСА`.
Сервис `pm2-ubuntu.service` обычно запускает сам PM2: это ещё не означает, что сайт управляется напрямую systemd.
В примерах ниже сервис называется `prokachka.service`, пользователь — `ubuntu`, Node находится в `/usr/bin/node`.
Если фактические значения отличаются, замените их **в конфигурации, unit-файле и sudoers**.
Ошибка `ls` для одного из двух env-файлов допустима: выберите существующий файл с рабочими production-настройками.
Не присылайте содержимое env и секреты в переписку.

Если Node не 22, сначала установите Node 22 своим текущим способом установки. Не меняйте Node у других сервисов вслепую.
Убедитесь, что выбранный Node доступен по абсолютному пути пользователю `ubuntu`.

## 2. Сохраните текущую установку и подготовьте каталоги

Первый раз доставьте эти изменения через Git при выключенном автодеплое. Рабочая `.next` и `node_modules` должны остаться на месте:
первый откат сможет запустить их через прежнюю папку `/var/www/prokachka`.

```bash
cd /var/www/prokachka
git status --short
git pull --ff-only origin main
sudo install -d -o ubuntu -g ubuntu -m 750 /var/www/prokachka-deploy
sudo install -d -o ubuntu -g ubuntu -m 750 /var/www/prokachka-deploy/releases /var/www/prokachka-deploy/incoming
sudo install -o root -g root -m 644 scripts/prokachka-deploy.conf.example /etc/prokachka-deploy.conf
sudo nano /etc/prokachka-deploy.conf
```

При незакоммиченных изменениях на сервере сначала сохраните их; не используйте `reset --hard`.
Проверьте конфигурацию:

```bash
APP_ROOT=/var/www/prokachka-deploy
LEGACY_APP_PATH=/var/www/prokachka
APP_ENV_FILE=/var/www/prokachka/.env.production
NODE_BIN=/usr/bin/node
SERVICE_NAME=prokachka.service
APP_PORT=3000
PREFLIGHT_PORT=3100
```

Порт 3100 должен быть свободен; он будет слушать только localhost.
`APP_ROOT` оставьте как в примере — workflow загружает пакет по этому пути.
Конфигурация содержит пути, её можно читать пользователю деплоя. Секреты находятся только в `APP_ENV_FILE`;
он должен читаться `ubuntu`, например иметь владельца `ubuntu` и права `600`.

Не создавайте отдельную копию env для каждого релиза. `AUTH_SECRET` сохраняйте прежним, чтобы не сбросить сессии.
Значения `NEXT_PUBLIC_APP_URL` и `NEXT_PUBLIC_SUPABASE_URL` должны совпадать с GitHub Variables из шага 4.
Подстановки вида `URL=$OTHER_VAR` в env не используются: укажите готовые значения.

## 3. Подключите launcher к существующему systemd-сервису

Установите launcher:

```bash
cd /var/www/prokachka
sudo install -o root -g root -m 755 scripts/start-production.sh /usr/local/bin/prokachka-start
sudo systemctl edit prokachka.service
```

Добавьте override:

```ini
[Service]
Type=simple
User=ubuntu
Group=ubuntu
ExecStart=
ExecStart=/usr/local/bin/prokachka-start
WorkingDirectory=/var/www/prokachka
KillSignal=SIGTERM
TimeoutStopSec=30
Restart=on-failure
RestartSec=3
```

Проверьте полный unit через `systemctl cat`: прежний `ExecStartPre`, отдельные shell-скрипты сборки,
ограничения `ReadWritePaths`/`ProtectSystem` могут потребовать адаптации к новому каталогу.
Пример полного unit есть в `scripts/prokachka.service.example`; существующие нужные настройки сохраняйте.

```bash
sudo systemctl daemon-reload
sudo systemctl restart prokachka.service
sudo systemctl status prokachka.service --no-pager
curl -I -H 'Host: prokachka.kz' http://127.0.0.1:3000/
```

До первого релиза launcher запускает старую установку. После создания `current` — выбранный релиз.
Если старый сайт не запускается, верните override к прежнему состоянию и разберитесь до включения CD.

Разрешите только restart этого сервиса:

```bash
sudo visudo -f /etc/sudoers.d/prokachka-deploy
```

Добавьте строку:

```text
ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl restart prokachka.service
```

Проверьте синтаксис: `sudo visudo -cf /etc/sudoers.d/prokachka-deploy`.
Workflow использует `sudo -n`: запрос пароля приведёт к ошибке, а не к зависанию.

## 4. Настройте GitHub

**Repository → Settings → Secrets and variables → Actions → Variables**:

| Имя | Значение |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL вашего Supabase, точно как на сервере; это публичный URL, не service role key |
| `NEXT_PUBLIC_APP_URL` | `https://prokachka.kz` (без завершающего /, точно как на сервере) |
| `PRODUCTION_DEPLOY_ENABLED` | сначала `false`, после подготовки сервера — `true` |

Это **repository variables**, не Environment variables: они требуются уже во время сборки.
`NEXT_PUBLIC_*` встраиваются Next.js при сборке; несовпадение с сервером остановит деплой.

**Settings → Environments → New environment → `production`**:

Ограничьте deployment branches веткой `main`. При желании включите Required reviewers, если ваш тариф/тип репозитория поддерживает эту настройку.
Без reviewers публикация автоматическая. Workflow сам не создаёт эти правила.
Это настройки GitHub [Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Добавьте Environment secrets:

| Имя | Значение |
| --- | --- |
| `PRODUCTION_HOST` | IP или домен Ubuntu-сервера без `https://` |
| `PRODUCTION_USER` | `ubuntu` |
| `PRODUCTION_SSH_PORT` | `22` или ваш SSH-порт (необязательно) |
| `PRODUCTION_SSH_KEY` | отдельный приватный SSH-ключ для Actions |
| `PRODUCTION_KNOWN_HOSTS` | проверенная строка host key сервера |

Создайте отдельный ключ **на своём компьютере**:

```bash
ssh-keygen -t ed25519 -f prokachka-actions -C github-actions-prokachka
```

Для автоматического входа оставьте passphrase пустым. Файл `prokachka-actions` вставляется только в Secret.
Содержимое `prokachka-actions.pub` добавьте одной строкой в `/home/ubuntu/.ssh/authorized_keys` на сервере.
Можно поставить перед ключом опцию `restrict` (OpenSSH), отключающую forwarding и PTY; команды SSH и SFTP остаются доступны.

```bash
chmod 700 /home/ubuntu/.ssh
chmod 600 /home/ubuntu/.ssh/authorized_keys
```

Для `KNOWN_HOSTS` на компьютере:

```bash
ssh-keyscan -t ed25519 -p 22 SERVER_IP
```

Перед сохранением сверьте fingerprint с сервером через уже доверенную SSH-сессию:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Сканирование само по себе не подтверждает подлинность. Сохраните проверенную строку целиком.
При нестандартном порте в строке будет `[SERVER_IP]:PORT`. Host в строке должен совпадать с `PRODUCTION_HOST`.
Сервер должен принимать SSH от GitHub-hosted runner; при IP allowlist понадобится согласованный способ доступа.

В защите `main` сделайте обязательным статус **CI passed**. Сам workflow не запрещает merge — это делает правило ветки.
Actions закреплены по commit SHA; Dependabot предложит обновления.
Подход соответствует [ограничению прав и использованию Secrets](https://docs.github.com/en/actions/reference/security/secure-use).

## 5. Первый запуск и дальнейшие обновления

Закоммитьте подготовленные файлы, отправьте рабочую ветку и создайте PR в `main`.
После успешного CI слейте PR, настройте сервер по шагам выше, установите `PRODUCTION_DEPLOY_ENABLED=true`.
Для первого деплоя откройте **Actions → Project checks → Run workflow → main**.

Далее push/merge в main запускает проверки и деплой. Другие ветки и PR на сервер не выкладываются.
Повторять неудачный запуск следует через **Re-run all jobs**: пакет привязан к номеру попытки, повтор только deploy-job не переиспользует старый пакет.
Если main уже ушёл вперёд, устаревший deployment пропускается.

После первого успеха проверьте:

```bash
readlink -f /var/www/prokachka-deploy/current
sudo systemctl status prokachka.service --no-pager
curl -H 'Host: prokachka.kz' http://127.0.0.1:3000/api/health
curl https://prokachka.kz/api/health
```

Номера `release` должны совпасть с успешным запуском GitHub.
Проверьте вход, открытие заданий и Telegram двумя тестовыми аккаунтами: smoke-test не заменяет проверку бизнеса.

## Cron Telegram, миграции и обслуживание

После успешного перехода поменяйте в существующей строке cron **только путь к скрипту**, не добавляйте вторую задачу.
Пример с прежним env и lock:

```cron
* * * * * /usr/bin/flock -n /tmp/prokachka-telegram-delivery.lock /usr/bin/node --env-file=/var/www/prokachka/.env.production /var/www/prokachka-deploy/current/scripts/deliver-telegram.cjs >> /var/www/prokachka/telegram-delivery.log 2>&1
```

Это оставляет очередь на HTTP API, но обновляет версию скрипта вместе с релизами.
До первого успешного релиза оставьте старую строку; при ручном возврате к legacy верните старый путь.

SQL-миграции выполняются отдельно с backup, до публикации зависимого от них кода.
Перед несовместимой миграцией выключите `PRODUCTION_DEPLOY_ENABLED`; автоматический откат приложения не откатывает базу.

Перезапуск одного systemd-процесса даёт краткий перерыв. Nginx продолжает проксировать на 3000, SSE переподключается.
Это не zero-downtime. Новая сборка никогда не перезаписывает рабочие `.next`/`node_modules`.
Предыдущие hashed JS/CSS доступны и после переключения для уже открытых вкладок.

Релизы и архивы сохраняются для диагностики; автоматического удаления нет. Следите за `df -h` и
`du -sh /var/www/prokachka-deploy`, периодически удаляйте только старые неактивные релизы и их архивы,
сохраняя текущий и хотя бы один предыдущий. Папка current — symlink, не удаляйте её цель наугад.

Логи запуска: `sudo journalctl -u prokachka.service -n 100 --no-pager`.
Лог предварительного запуска: `/var/www/prokachka-deploy/releases/RELEASE_ID/preflight.log`.
Не публикуйте логи без проверки: приложение может вывести внутренние детали ошибок.

Ручной откат на существующий проверенный релиз (подставьте конкретный ID):

```bash
cd /var/www/prokachka-deploy
flock deploy.lock bash -c 'ln -s /var/www/prokachka-deploy/releases/RELEASE_ID .rollback && mv -Tf .rollback current && sudo -n /usr/bin/systemctl restart prokachka.service'
curl -H 'Host: prokachka.kz' http://127.0.0.1:3000/api/health
```

При ошибке автоматического отката job остаётся красным и явно выводит `ROLLBACK FAILED`; проверьте systemd и восстановите рабочую версию.
