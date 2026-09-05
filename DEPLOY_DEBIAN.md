# Инструкция по развертыванию на Debian Linux

Проект состоит из двух частей:
1. **Frontend (статический сайт)**: собирается через `npm run build` в директорию `build/` и раздаётся через Nginx.
2. **Backend (Go микросервис)**: исполняемый бинарник `schedule-api` (потребляет ~4–6 МБ RAM), сохраняет и читает `links.json`.

---

## 1. Подготовка на Debian

Обновите пакеты и установите Nginx (и Go, если будете собирать прямо на сервере):
```bash
sudo apt update && sudo apt install -y nginx
# (Опционально) если собираете Go прямо на Debian:
sudo apt install -y golang-go
```

Создайте директорию проекта:
```bash
sudo mkdir -p /var/www/schedule
sudo chown -R $USER:www-data /var/www/schedule
```

---

## 2. Сборка и деплой фронтенда

### Вариант А: Собрать на Windows и скопировать на сервер (Рекомендуется)
На вашей рабочей Windows-машине:
```bash
npm run build
```
Скопируйте полученную папку `build/` на Debian сервер (через SCP / rsync / WinSCP / Git):
```bash
scp -r build/* user@your-server-ip:/var/www/schedule/build/
```

### Вариант Б: Сборка прямо на Debian
Если собираете на самом Debian:
```bash
# Установите Node.js (v20+ или v22+)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# В папке проекта:
npm ci
npm run build
cp -r build /var/www/schedule/
```

---

## 3. Сборка и запуск Go API (`schedule-api`)

Файл `server/main.go` компилируется в один независимый бинарник:

### Сборка на Debian:
```bash
cd server
go build -ldflags="-s -w" -o /var/www/schedule/schedule-api main.go
```

### Или кросс-компиляция с Windows (без установки Go на Debian):
```powershell
# В PowerShell на Windows:
cd server
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -ldflags="-s -w" -o schedule-api main.go
# Скопируйте schedule-api на сервер:
scp schedule-api user@your-server-ip:/var/www/schedule/
```

На Debian сделайте бинарник исполняемым и скопируйте начальный `links.json`:
```bash
chmod +x /var/www/schedule/schedule-api
cp src/lib/data/links.json /var/www/schedule/links.json
sudo chown -R www-data:www-data /var/www/schedule
sudo chmod 664 /var/www/schedule/links.json
```

---

## 4. Настройка автозапуска через Systemd

Создайте сервис `/etc/systemd/system/schedule-api.service`:
```bash
sudo nano /etc/systemd/system/schedule-api.service
```

Вставьте следующее содержимое (замените `ваш_секретный_пароль` на свой):
```ini
[Unit]
Description=Schedule Links Go API Service
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/schedule
Environment=PORT=3001
Environment=ADMIN_PASSWORD=ваш_секретный_пароль
Environment=LINKS_FILE=/var/www/schedule/links.json
ExecStart=/var/www/schedule/schedule-api
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Включите и запустите сервис:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now schedule-api
# Проверка статуса:
sudo systemctl status schedule-api
```

---

## 5. Настройка Nginx

Создайте конфигурационный файл для сайта `/etc/nginx/sites-available/schedule`:
```bash
sudo nano /etc/nginx/sites-available/schedule
```

Конфигурация:
```nginx
server {
    listen 80;
    # Укажите ваш домен или IP сервера
    server_name your-domain.com; 

    root /var/www/schedule/build;
    index index.html;

    # Сжатие gzip для быстрой загрузки
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;

    # 1. Проксирование API запросов к Go-сервису
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 2. Кэширование неизменяемых статических файлов Vite (_app/immutable)
    location /_app/immutable/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # 3. Раздача фронтенда (SPA fallback)
    location / {
        try_files $uri $uri/ /404.html;
    }
}
```

Активируйте сайт и перезапустите Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/schedule /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

*(Опционально)* Для подключения бесплатного HTTPS сертификата:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Итог:
- **Разработка на Windows**: запускается `npm run dev`. Прокси в `vite.config.ts` автоматически перенаправляет вызовы `/api` на локальный Go-сервер (порт 3001).
- **Продакшен на Debian**: Nginx отдаёт оптимизированную статику со скоростью 1–2 мс, а Go-сервер обрабатывает чтение и безопасное сохранение ссылок в фоне, потребляя всего ~5 МБ RAM.

