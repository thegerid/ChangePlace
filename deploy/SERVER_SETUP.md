# ChangePlace backend on Ubuntu VPS

Target scheme:

```text
https://goswitch.ru       -> GitHub Pages frontend
https://api.goswitch.ru   -> Ubuntu VPS backend
```

## 1. DNS

Create an `A` record:

```text
api.goswitch.ru -> 130.49.172.96
```

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
api.goswitch.ru {
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
curl https://api.goswitch.ru/api/health
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
