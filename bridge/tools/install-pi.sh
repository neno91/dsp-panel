#!/usr/bin/env bash
# One-shot install/upgrade of DSP Panel on a Raspberry Pi (Raspberry Pi OS / Ubuntu, Debian 12+).
#   From your machine, both steps in one:  bash bridge/tools/deploy-pi.sh <user>@<pi-host>
#   Or by hand:
#   1. copy the project to the Pi:   rsync -az --exclude node_modules --exclude .git <project>/ <user>@<pi-host>:~/dsp-panel/
#   2. on the Pi:                     bash ~/dsp-panel/bridge/tools/install-pi.sh
# Installs Node.js (if missing), copies the project to /opt/dsp-panel, installs the bridge's
# dependencies (ws + Crestron's ch5-cli), and registers a systemd service "dsp-panel" that starts
# on boot and restarts on failure. The Pi's bridge/site.json and bridge/data (uploads) are kept.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../.." && pwd)"     # the project folder this script lives in
DEST=/opt/dsp-panel
SERVICE=dsp-panel
RUN_USER="${SUDO_USER:-$USER}"

echo "→ Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "→ install to $DEST"
sudo mkdir -p "$DEST"
KEEP=()
[ -f "$DEST/bridge/site.json" ] && KEEP+=(--exclude bridge/site.json) && echo "  (keeping the Pi's existing bridge/site.json – edited via /admin)"
[ -d "$DEST/bridge/data" ] && KEEP+=(--exclude bridge/data)
sudo rsync -a --delete --exclude node_modules --exclude dist --exclude .build --exclude .git "${KEEP[@]}" "$SRC"/ "$DEST"/
sudo chown -R "$RUN_USER":"$RUN_USER" "$DEST"
[ -f "$DEST/bridge/site.json" ] || { cp "$DEST/bridge/site.default.json" "$DEST/bridge/site.json"; echo "  (no site.json yet – started from site.default.json; set the DSP address in /admin)"; }
(cd "$DEST/bridge" && npm install --omit=dev --no-fund --no-audit)

echo "→ systemd service"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=DSP Panel bridge (audio panel + Extron DMP 128)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DEST/bridge
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3
User=$RUN_USER
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE
sudo systemctl restart $SERVICE          # (re)start so an upgrade takes effect
sleep 2
sudo systemctl --no-pager --lines=5 status $SERVICE || true

IP=$(hostname -I | awk '{print $1}')
echo
echo "✓ DSP Panel running.  Panel: http://$IP:3000/   Admin: http://$IP:3000/admin"
echo "  Logs:    journalctl -u $SERVICE -f"
echo "  Update:  rerun deploy-pi.sh from your machine (site.json and uploads on the Pi are kept)"
