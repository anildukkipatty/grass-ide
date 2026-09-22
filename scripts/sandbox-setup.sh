#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# jarvis Sandbox Setup Script
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
JARVIS_WORKSPACE="$HOME_DIR/start"
JARVIS_CONFIG_DIR="$HOME_DIR/.config/jarvis"
JARVIS_ENV_FILE="$JARVIS_CONFIG_DIR/env"
JARVIS_PORT=3000
JARVIS_LOG="$JARVIS_CONFIG_DIR/jarvis.log"
RELAY_URL="wss://relay.codeongrass.com"

# --- Create workspace folder -------------------------------------------------
echo ""
echo "==> Creating workspace folder: $JARVIS_WORKSPACE"
mkdir -p "$JARVIS_WORKSPACE"

# --- Install jarvis -----------------------------------------------------------
echo ""
echo "==> Installing jarvis-ai globally"
if ! jarvis -V &>/dev/null; then
  npm install -g jarvis-ai
  if ! jarvis -V &>/dev/null; then
    echo "ERROR: jarvis not found after install." >&2
    exit 1
  fi
fi
echo "jarvis installed: $(jarvis -V)"

# --- Create config directory and env file ------------------------------------
echo ""
echo "==> Writing environment file: $JARVIS_ENV_FILE"
mkdir -p "$JARVIS_CONFIG_DIR"

cat > "$JARVIS_ENV_FILE" <<EOF
# jarvis sandbox environment
# Add secrets here (e.g. ANTHROPIC_API_KEY, GITHUB_TOKEN).
# DEEPGRAM_API_KEY and OPENAI_API_KEY enable voice dictation in the UI.
# jarvis loads this file on startup, so no need to source it.
# This file is readable only by $WORKSPACE_USER.
# jarvis-api will append secrets here during provisioning.

JARVIS_PORT=$JARVIS_PORT
JARVIS_WORKSPACE=$JARVIS_WORKSPACE
EOF

chmod 600 "$JARVIS_ENV_FILE"
echo "Env file written and locked to owner-read-only."

# --- Register cron @reboot entry (idempotent) --------------------------------
echo ""
echo "==> Registering cron @reboot entry"
(crontab -l 2>/dev/null | grep -Ev 'grass|gitbot|jarvis' || true; echo "@reboot nohup bash -c \"cd '$JARVIS_WORKSPACE' && jarvis start -p $JARVIS_PORT -r $RELAY_URL\" >> $JARVIS_LOG 2>&1 &") | crontab -
echo "Cron entry registered."

# --- Kill any existing jarvis process and start fresh -------------------------
echo ""
echo "==> Starting jarvis"
pkill -x jarvis 2>/dev/null || true; pkill -x gitbot 2>/dev/null || true
pkill -x grass 2>/dev/null || true  # pre-rename binary, if still running
sleep 1
nohup bash -c "cd '$JARVIS_WORKSPACE' && jarvis start -p $JARVIS_PORT -r $RELAY_URL" >> "$JARVIS_LOG" 2>&1 &
echo "jarvis started (pid $!)"

# --- Health check ------------------------------------------------------------
echo ""
echo "==> Waiting for jarvis to become healthy on port $JARVIS_PORT"
MAX_ATTEMPTS=30
ATTEMPT=0
until curl -sf "http://localhost:$JARVIS_PORT/health" > /dev/null 2>&1; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    echo "ERROR: jarvis did not become healthy after ${MAX_ATTEMPTS} attempts." >&2
    echo "Check logs at: $JARVIS_LOG" >&2
    tail -n 50 "$JARVIS_LOG" >&2 || true
    exit 1
  fi
  echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS — waiting..."
  sleep 2
done

echo ""
echo "================================================================"
echo "  jarvis sandbox setup complete."
echo "  Logs:    $JARVIS_LOG"
echo "  Env:     $JARVIS_ENV_FILE"
echo "  Port:    $JARVIS_PORT"
echo "================================================================"
