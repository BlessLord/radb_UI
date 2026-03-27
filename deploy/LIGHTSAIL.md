# Lightsail Deployment With Caddy

This app is easiest to host on a Lightsail Ubuntu instance by:

1. running `webui.server` on `127.0.0.1:8000` with `systemd`
2. using Caddy as the public reverse proxy on ports `80` and `443`

## Assumptions

- The repo will live at `/opt/radb`
- The Python environment is `ai-class`
- The app should be served from `radb.example.com`
- The SQLite database will live at `/opt/radb/teachingData/college.db`

Adjust those paths if your server uses different locations.

## 1. Copy the project to the server

```bash
sudo mkdir -p /opt
sudo chown ubuntu:ubuntu /opt
cd /opt
git clone <your-radb-repo-url> radb
cd /opt/radb
```

## 2. Verify the app starts locally

```bash
/home/ubuntu/miniconda3/envs/ai-class/bin/python -m webui.server --host 127.0.0.1 --port 8000
```

Then in another shell:

```bash
curl http://127.0.0.1:8000/api/health
```

Stop the app after the check.

## 3. Install and configure the systemd service

Create the environment file:

```bash
sudo cp deploy/radb-webui.env.example /etc/radb-webui.env
sudo nano /etc/radb-webui.env
```

Create the service file:

```bash
sudo cp deploy/radb-webui.service.example /etc/systemd/system/radb-webui.service
sudo nano /etc/systemd/system/radb-webui.service
```

Update the paths in the service file if:

- the repo is not at `/opt/radb`
- the conda environment is not at `/home/ubuntu/miniconda3/envs/ai-class/bin/python`
- the Linux user is not `ubuntu`

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now radb-webui
sudo systemctl status radb-webui
```

Useful logs:

```bash
journalctl -u radb-webui -f
```

## 4. Install Caddy

On Ubuntu:

```bash
sudo apt update
sudo apt install -y caddy
```

## 5. Configure Caddy

Copy the example config:

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Generate the bcrypt password hash on the server:

```bash
chmod +x deploy/generate_caddy_bcrypt.sh
./deploy/generate_caddy_bcrypt.sh SwustStudent
```

Paste the generated `basic_auth` block into `/etc/caddy/Caddyfile` and replace the placeholder line.

Replace `radb.example.com` with your real domain.

Test and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

Useful logs:

```bash
journalctl -u caddy -f
```

## 6. DNS and firewall

- Point your domain's `A` record to the Lightsail public IPv4 address.
- Open ports `80` and `443` in the Lightsail networking panel.
- If you use Ubuntu's firewall, allow both:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## 7. Final check

After DNS resolves, open:

```text
https://radb.example.com
```

Caddy will automatically request and renew TLS certificates for the configured domain.

## Notes

- If you only have the server IP and no domain yet, Caddy can still proxy HTTP, but automatic public HTTPS certificates are domain-based.
- The web app's MathJax rendering uses a CDN, so the server needs outbound internet access if you want the rendered LaTeX panel to work in browsers.

## No Domain: IP + /ra Path

If you only have the instance IP and want the app under a path like:

```text
https://3.120.35.41/ra/
```

use the example at:

- `deploy/Caddyfile.ip.example`

This works because the frontend now uses relative asset and API paths, so Caddy can strip the `/ra` prefix before proxying to `webui.server`.

Important limitations:

- A bare IP will not get the same kind of browser-trusted public certificate that you get with a normal domain in this setup.
- The example uses `tls internal`, which means Caddy signs the certificate itself.
- Browsers will warn about the certificate until you install and trust Caddy's local CA certificate on every client machine that should access the site.

If you do not want to install trust certificates on client machines, use plain HTTP on the IP instead of HTTPS, or get a domain and use the domain-based Caddyfile.
