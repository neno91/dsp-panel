#!/usr/bin/env bash
# Push the project from this machine to a Raspberry Pi and (re)install DSP Panel there.
#   bash bridge/tools/deploy-pi.sh <user>@<pi-host>        e.g.  bash bridge/tools/deploy-pi.sh pi@dsp-panel.local
# Copies everything except node_modules/.git/dist/.build, then runs install-pi.sh on the Pi, which
# keeps the Pi's own bridge/site.json and uploads (DSP address, screens, tokens, logo – edited via /admin),
# runs npm install (ws + Crestron's ch5-cli) and restarts the dsp-panel service.
set -euo pipefail
TARGET="${1:?usage: deploy-pi.sh <user>@<pi-host>}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
echo "→ copying $SRC → $TARGET:~/dsp-panel/"
rsync -az --delete --exclude node_modules --exclude .git --exclude dist --exclude .build --exclude .DS_Store --exclude bridge/data "$SRC"/ "$TARGET":~/dsp-panel/
echo "→ installing on the Pi"
ssh -t "$TARGET" "bash ~/dsp-panel/bridge/tools/install-pi.sh"
