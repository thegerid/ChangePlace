# ChangePlace: данные для согласования доступа

## Целевая схема

```text
https://goswitch.ru
https://www.goswitch.ru
https://goswitch.ru/api/*
```

Сервис будет работать на одном домене и одном сервере. `Dynamic DNS` в целевой схеме не используется.

## Хостинг

- IPv4: `130.49.172.96`
- ОС: `Ubuntu 22.04`
- Reverse proxy: `Caddy`
- Backend: `Node.js`
- TLS: `Let's Encrypt`

## Что будет доступно снаружи

- `GET /` и статические файлы frontend
- `GET /api/health`
- `GET /api/state`
- `POST /api/points`
- `DELETE /api/points/:id`
- `POST /api/offers`
- `POST /api/offers/:id/accept`
- `POST /api/offers/:id/decline`

## Что не используется

- `nip.io`
- `sslip.io`
- GitHub Pages как production runtime
- cross-domain API
- WebSocket
- SSE

## Внешние зависимости runtime

Основной frontend bundle будет отдаваться с `goswitch.ru`.

Остающаяся внешняя runtime-зависимость:

- `basemaps.cartocdn.com` — тайлы карты

Пользовательские исходящие переходы по кнопкам связи:

- `t.me`
- `xlink.achat.best`
- `max.ru`

Эти домены не нужны для загрузки самой страницы, но используются при ручном открытии каналов связи.

## Что нужно разрешить

Минимально:

- `goswitch.ru`
- `www.goswitch.ru`

Если политика требует учитывать внешние карты:

- `*.basemaps.cartocdn.com`

Если политика учитывает ручные переходы из карточки контактов:

- `t.me`
- `xlink.achat.best`
- `max.ru`

## Что проверить после публикации

1. `https://goswitch.ru/` открывается.
2. `https://goswitch.ru/api/health` отвечает `200`.
3. В сетевых запросах нет обращений к `nip.io` или `sslip.io`.
4. Карта и публикация точки работают без VPN.

## Примечание по DNS

Для production-cutover домен должен указывать на VPS:

```text
A     @      130.49.172.96
A     www    130.49.172.96
```
