# Развёртывание сканера

`Caddyfile.dev` обслуживает два изолированных маршрута:

- `/dev/api/*` — DEV API и DEV-таблица;
- `/api/*` — production API и рабочая таблица.

Статические файлы production находятся в `site/`, DEV-копия — в `site/dev/`.
Оба API доступны только внутри Docker и не публикуют порт `8080` наружу.

Перед первым запуском создайте общую закрытую сеть:

```bash
docker network inspect packageflow-scanner-api >/dev/null 2>&1 || \
  docker network create packageflow-scanner-api
```

Production-бот подключается к ней под псевдонимом `packageflow-prod-api`.
Секреты Telegram и Google остаются только в контейнерах API; JavaScript
сканера их не получает.
