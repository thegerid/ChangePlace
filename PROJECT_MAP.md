# ChangePlace Project Map

## Purpose

- Public product: `Сервис обмена районами`
- Production domain: `https://goswitch.ru`
- Secondary domain: `https://www.goswitch.ru`
- API path: `https://goswitch.ru/api/*`

## Repositories

- Frontend/backend repo: `https://github.com/thegerid/ChangePlace.git`
- Current deploy branch: `main`

## Local Entry Points

- Main app: [index.html](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/index.html)
- Frontend logic: [app.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/app.js)
- Main styles: [styles.css](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/styles.css)
- Backend: [server.mjs](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/server.mjs)
- Runtime config: [config.js](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/config.js)

## Production Server

- Server IP: `130.49.172.96`
- Server OS target: `Ubuntu 22.04`
- App root on server: `/opt/changeplace`
- Service user: `changeplace`
- systemd unit: `changeplace-api`
- Reverse proxy: `Caddy`
- Caddy target: `127.0.0.1:4173`

## Server Files

- systemd unit source: [deploy/changeplace-api.service](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/deploy/changeplace-api.service)
- Production Caddy config: [deploy/Caddyfile.goswitch.ru](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/deploy/Caddyfile.goswitch.ru)
- Server runbook: [deploy/SERVER_SETUP.md](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/deploy/SERVER_SETUP.md)
- Approval packet: [deploy/ADMIN_APPROVAL_PACKET.md](/c:/Users/Selecty/Desktop/AI_Skills/ChangePlace/deploy/ADMIN_APPROVAL_PACKET.md)

## Runtime Contract

- Frontend and API are intended to run from the same production domain.
- Production reverse proxy should expose `goswitch.ru` and `www.goswitch.ru`.
- Node app listens on port `4173`.
- `config.js` prefers same-origin `"/api"` and keeps fallback hosts only for migration scenarios.

## Verification

- Healthcheck: `curl https://goswitch.ru/api/health`
- Frontend headers: `curl -I https://goswitch.ru/`
- Local service check on server: `curl http://127.0.0.1:4173/api/health`
- systemd: `systemctl status changeplace-api`
- Caddy: `systemctl status caddy`

## Publishing Notes

- Git publication target: `origin/main`
- Server deployment target: `/opt/changeplace`
- After file sync, expected restart sequence:
  1. `systemctl restart changeplace-api`
  2. `systemctl restart caddy`
  3. run healthchecks

## Secrets Policy

- SSH login, password, private keys, tokens and other credentials must not be stored in this repository.
- This restriction comes from [AGENT_SELF_LEARNING_RULES_RU.md](/c:/Users/Selecty/Desktop/AI_Skills/common/Instructions/rules/AGENT_SELF_LEARNING_RULES_RU.md).
- Store access credentials only in an external secure store:
  - Windows Credential Manager
  - password manager
  - local untracked secret file outside repo policy scope

## Current Deployment Split

- `обучениедоставки.рф` project is published through its own git repo: `projects/demo-sfa-go`
- `goswitch.ru` project is published from this repo and deployed to the VPS above
