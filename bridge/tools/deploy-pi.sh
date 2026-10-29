#!/usr/bin/env bash
# Push the project from this machine to a Raspberry Pi and (re)install DSP Panel there.
#   bash bridge/tools/deploy-pi.sh <user>@<pi-host>        e.g.  bash bridge/tools/deploy-pi.sh pi@dsp-panel.local
# Copies everything except node_modules/.git/dist/.build, then runs install-pi.sh on the Pi, which
# keeps the Pi's own bridge/site.json and uploads (DSP address, screens, tokens, logo – edited via /admin),
# runs npm install (ws + Crestron's ch5-cli) and restarts the dsp-panel service.
#
# Logins: rsync and ssh share one SSH connection (ControlMaster), so you are asked for the SSH
# password at most once. To be asked nothing at all:
#   ssh-copy-id <user>@<pi-host>                                    # SSH key instead of password
#   ssh <user>@<pi-host> "echo '$USER ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/$USER"   # no sudo prompt on the Pi
set -euo pipefail
TARGET="${1:?usage: deploy-pi.sh <user>@<pi-host>}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
CTL="${TMPDIR:-/tmp}/dsp-panel-ssh-$$"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$CTL" -o ControlPersist=120)
trap 'ssh -o "ControlPath=$CTL" -O exit "$TARGET" 2>/dev/null || true' EXIT

echo "→ connecting to $TARGET"
ssh "${SSH_OPTS[@]}" "$TARGET" true                 # the one login; rsync and ssh below reuse it
echo "→ copying $SRC → $TARGET:~/dsp-panel/"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" --exclude node_modules --exclude .git --exclude dist --exclude .build --exclude .DS_Store --exclude bridge/data "$SRC"/ "$TARGET":~/dsp-panel/
echo "→ installing on the Pi"
ssh -t "${SSH_OPTS[@]}" "$TARGET" "bash ~/dsp-panel/bridge/tools/install-pi.sh"
