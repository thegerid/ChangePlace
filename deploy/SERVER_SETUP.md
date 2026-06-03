# ChangePlace deployment on Ubuntu VPS

Target production scheme:

```text
https://goswitch.ru        -> frontend
https://www.goswitch.ru    -> frontend
https://goswitch.ru/api/*  -> backend API
```

One domain, one server, one TLS certificate chain. No `nip.io`, `sslip.io`, GitHub Pages runtime, or cross-domain API in the target production path.

## DNS

Required records:

```text
A     @      130.49.172.96
A     www    130.49.172.96
```

If `www` must remain a CNAME, point it to `goswitch.ru` after the root domain already resolves to the VPS.

Remove GitHub Pages records before the final cutover.

## Server layout

Application root:

```text
/opt/changeplace
```

Expected contents:

- `index.html`
- `app.js`
- `styles.css`
- `config.js`
- `manifest.webmanifest`
- `service-worker.js`
- `assets/`
- `server.mjs`
- `package.json`
- `package-lock.json`
- `data/`

## Runtime

Ubuntu 22.04:

```bash
apt update
apt install -y curl debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs caddy
node -v
caddy version
```

## App user and folders

```bash
useradd --system --home /opt/changeplace --shell /usr/sbin/nologin changeplace || true
mkdir -p /opt/changeplace/data
chown -R changeplace:www-data /opt/changeplace
chmod 775 /opt/changeplace/data
```

## systemd

Copy `deploy/changeplace-api.service` to:

```text
/etc/systemd/system/changeplace-api.service
```

Then:

```bash
systemctl daemon-reload
systemctl enable --now changeplace-api
systemctl status changeplace-api
```

## Caddy

Final production config:

```text
goswitch.ru, www.goswitch.ru {
	reverse_proxy 127.0.0.1:4173
}
```

Place it in:

```text
/etc/caddy/Caddyfile
```

Then:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
systemctl status caddy
```

## Verify

```bash
curl http://127.0.0.1:4173/api/health
curl https://goswitch.ru/api/health
curl -I https://goswitch.ru/
```

Expected API response:

```json
{"ok":true,"mode":"local"}
```

## Firewall

If `ufw` is enabled:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw reload
```

## Operational notes

- `config.js` already prefers same-origin `"/api"` and falls back only during the migration period.
- The frontend bundle is self-hosted from the same server.
- There are no WebSocket or SSE connections in the current implementation.
- Remaining external runtime dependency: map tile requests to `basemaps.cartocdn.com`.
