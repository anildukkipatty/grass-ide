#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Grass Sandbox Setup Script
# Idempotent — safe to run on every sandbox reboot.
# =============================================================================

# --- Detect workspace user ---------------------------------------------------
if [ "$(id -u)" -eq 0 ]; then
  WORKSPACE_USER=$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 && $7 !~ /nologin|false/ {print $1; exit}')
  if [ -z "$WORKSPACE_USER" ]; then
    echo "ERROR: Could not detect a non-root workspace user." >&2
    exit 1
  fi
  echo "Detected workspace user: $WORKSPACE_USER (running as root, will switch)"
  exec sudo -u "$WORKSPACE_USER" bash "$0" "$@"
fi

# From here on we are the workspace user.
WORKSPACE_USER=$(id -un)
HOME_DIR=$(getent passwd "$WORKSPACE_USER" | cut -d: -f6)
echo "Running setup as: $WORKSPACE_USER (home: $HOME_DIR)"

# --- Paths -------------------------------------------------------------------
GRASS_WORKSPACE="$HOME_DIR/start"
GRASS_CONFIG_DIR="$HOME_DIR/.config/grass"
GRASS_ENV_FILE="$GRASS_CONFIG_DIR/env"
GRASS_PORT=3000
GRASS_LOG="$GRASS_CONFIG_DIR/grass.log"
RELAY_URL="wss://relay.codeongrass.com"

# --- Create workspace folder -------------------------------------------------
echo ""
echo "==> Creating workspace folder: $GRASS_WORKSPACE"
mkdir -p "$GRASS_WORKSPACE"

# --- Install grass -----------------------------------------------------------
echo ""
echo "==> Installing @grass-ai/ide globally"
if ! grass -V &>/dev/null; then
  npm install -g @grass-ai/ide
  if ! grass -V &>/dev/null; then
    echo "ERROR: grass not found after install." >&2
    exit 1
  fi
fi
echo "grass installed: $(grass -V)"

# --- Create config directory and env file ------------------------------------
echo ""
echo "==> Writing environment file: $GRASS_ENV_FILE"
mkdir -p "$GRASS_CONFIG_DIR"

cat > "$GRASS_ENV_FILE" <<EOF
# Grass sandbox environment
# Add secrets here (e.g. ANTHROPIC_API_KEY, GITHUB_TOKEN).
# This file is readable only by $WORKSPACE_USER.
# grass-api will append secrets here during provisioning.

GRASS_PORT=$GRASS_PORT
GRASS_WORKSPACE=$GRASS_WORKSPACE
EOF

chmod 600 "$GRASS_ENV_FILE"
echo "Env file written and locked to owner-read-only."

# --- Register cron @reboot entry (idempotent) --------------------------------
echo ""
echo "==> Registering cron @reboot entry"
(crontab -l 2>/dev/null | grep -v 'grass' || true; echo "@reboot nohup bash -c \"cd '$GRASS_WORKSPACE' && grass start -p $GRASS_PORT -r $RELAY_URL\" >> $GRASS_LOG 2>&1 &") | crontab -
echo "Cron entry registered."

# --- Kill any existing grass process and start fresh -------------------------
echo ""
echo "==> Starting grass"
pkill -x grass 2>/dev/null || true
sleep 1
nohup bash -c "cd '$GRASS_WORKSPACE' && grass start -p $GRASS_PORT -r $RELAY_URL" >> "$GRASS_LOG" 2>&1 &
echo "grass started (pid $!)"

# --- Health check ------------------------------------------------------------
echo ""
echo "==> Waiting for grass to become healthy on port $GRASS_PORT"
MAX_ATTEMPTS=30
ATTEMPT=0
until curl -sf "http://localhost:$GRASS_PORT/health" > /dev/null 2>&1; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    echo "ERROR: grass did not become healthy after ${MAX_ATTEMPTS} attempts." >&2
    echo "Check logs at: $GRASS_LOG" >&2
    tail -n 50 "$GRASS_LOG" >&2 || true
    exit 1
  fi
  echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS — waiting..."
  sleep 2
done

echo ""
echo "================================================================"
echo "  Grass sandbox setup complete."
echo "  Logs:    $GRASS_LOG"
echo "  Env:     $GRASS_ENV_FILE"
echo "  Port:    $GRASS_PORT"
echo "================================================================"
