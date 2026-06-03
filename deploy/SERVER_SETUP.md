# ChangePlace backend on Ubuntu VPS

Target scheme:

```text
https://goswitch.ru       -> GitHub Pages frontend
https://130.49.172.96.sslip.io -> Ubuntu VPS backend
```

`sslip.io` already resolves to the server IP, so a temporary HTTPS domain works immediately without DNS changes.

## 2. Copy project to server

Backend files required on the server:

- `server.mjs`
- `package.json`
- `package-lock.json`
- `config.js` is not required for the backend
- `data/` directory

Recommended target path:

```text
/opt/changeplace
```

## 3. Install runtime

Ubuntu 22.04:

```bash
apt update
apt install -y curl debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs caddy
node -v
caddy version
```

## 4. Create app user and folders

```bash
useradd --system --home /opt/changeplace --shell /usr/sbin/nologin changeplace || true
mkdir -p /opt/changeplace/data
chown -R changeplace:www-data /opt/changeplace
chmod 775 /opt/changeplace/data
```

## 5. systemd

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

## 6. Caddy

Server `Caddyfile`:

```text
130.49.172.96.sslip.io {
	reverse_proxy 127.0.0.1:4173
}
```

Place it in:

```text
/etc/caddy/Caddyfile
```

Then:

```bash
systemctl restart caddy
systemctl status caddy
```

## 7. Verify

```bash
curl http://127.0.0.1:4173/api/health
curl https://130.49.172.96.sslip.io/api/health
```

Expected response:

```json
{"ok":true,"mode":"local"}
```

## 8. Firewall

If `ufw` is enabled:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw reload
```

## 9. Switch to project subdomain later

When `api.goswitch.ru` is created in DNS:

1. replace `130.49.172.96.sslip.io` with `api.goswitch.ru` in `Caddyfile`
2. replace the public backend URL in `config.js`
3. restart `caddy`
