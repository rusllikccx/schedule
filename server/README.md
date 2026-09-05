# Schedule Links API (Go)

Легковесный автономный микро-сервис на Go для чтения и редактирования ссылок на онлайн-пары.
Потребление RAM: ~4–6 МБ. Внешние зависимости отсутствуют.

## Переменные окружения:
- `PORT` — порт сервера (по умолчанию `3001`).
- `ADMIN_PASSWORD` — секретный пароль администратора (по умолчанию `secret123`).
- `LINKS_FILE` — путь к файлу ссылок (по умолчанию `links.json`).

## Компиляция:

### На сервере с установленным Go:
```bash
go build -ldflags="-s -w" -o schedule-api main.go
./schedule-api
```

### Кросс-компиляция с любого ПК под Linux x86_64:
```bash
# Windows PowerShell:
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -ldflags="-s -w" -o schedule-api main.go

# Linux / macOS:
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o schedule-api main.go
```

## Systemd служба (`/etc/systemd/system/schedule-api.service`):
```ini
[Unit]
Description=Schedule Links API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/schedule
Environment=PORT=3001
Environment=ADMIN_PASSWORD=ваш_надежный_пароль
Environment=LINKS_FILE=/var/www/schedule/links.json
ExecStart=/var/www/schedule/schedule-api
Restart=always

[Install]
WantedBy=multi-user.target
```
Запуск:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now schedule-api
```

## Nginx конфигурация:
```nginx
location /api/links {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

