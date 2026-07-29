#!/usr/bin/env bash
#
# install-vps.sh — One-shot deploy of ClaudeClaw OS onto a fresh Debian/Ubuntu VPS
# (built for Hostinger, works on any Ubuntu 22.04+ / Debian 12+ box).
#
# What it does:
#   1. Installs prerequisites (Node 20, build tools, ufw, fail2ban, tailscale)
#   2. Creates a dedicated unprivileged user to run the bot
#   3. Clones + builds ClaudeClaw OS and writes a non-interactive .env
#   4. Joins the box to your Tailscale network and publishes the dashboard over
#      HTTPS to your tailnet ONLY (dashboard stays bound to 127.0.0.1)
#   5. Runs it as a hardened systemd service
#   6. Locks the box down with ufw + fail2ban + unattended-upgrades
#
# Usage (run as root on the VPS):
#   cp claudeclaw-deploy.conf.example claudeclaw-deploy.conf
#   nano claudeclaw-deploy.conf        # fill in secrets
#   bash install-vps.sh                # reads ./claudeclaw-deploy.conf
#
# Re-running is safe (idempotent): it updates in place and never rotates an
# existing DASHBOARD_TOKEN / DB_ENCRYPTION_KEY.

set -euo pipefail

# ── pretty output ─────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  B=$'\e[1m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; Z=$'\e[0m'
else
  B=''; R=''; G=''; Y=''; C=''; Z=''
fi
step() { echo; echo "${B}${C}==> $*${Z}"; }
ok()   { echo "  ${G}✓${Z} $*"; }
warn() { echo "  ${Y}⚠${Z} $*"; }
die()  { echo "  ${R}✗ $*${Z}" >&2; exit 1; }

# ── locate + load config ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${CLAUDECLAW_DEPLOY_CONF:-$SCRIPT_DIR/claudeclaw-deploy.conf}"

step "Preflight"
[[ "$(id -u)" == "0" ]] || die "Run as root (sudo bash install-vps.sh)."
command -v apt-get >/dev/null 2>&1 || die "This script targets Debian/Ubuntu (apt not found)."

if [[ -f "$CONF" ]]; then
  # shellcheck disable=SC1090
  source "$CONF"
  ok "Loaded config: $CONF"
else
  warn "No config file at $CONF — relying on environment variables only."
fi

# ── defaults ──────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALLOWED_CHAT_ID="${ALLOWED_CHAT_ID:-}"
CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
TS_AUTHKEY="${TS_AUTHKEY:-}"
TS_HOSTNAME="${TS_HOSTNAME:-claudeclaw}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3141}"
INSTALL_DIR="${INSTALL_DIR:-/opt/claudeclaw}"
RUN_USER="${RUN_USER:-claudeclaw}"
SSH_HARDENING="${SSH_HARDENING:-public}"   # off | public | tailscale-only
ENABLE_ACP="${ENABLE_ACP:-false}"          # true unlocks the beta provider switcher
REPO_URL="${REPO_URL:-https://github.com/earlyaidopters/claudeclaw-os.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
REPO_CLONE_TOKEN="${REPO_CLONE_TOKEN:-}"   # temp GitHub token (ghs_/gho_/ghp_) for private clone
APP_DIR="$INSTALL_DIR/claudeclaw-os"
ENV_FILE="$APP_DIR/.env"

# For a private repo, inject a short-lived token into the clone URL only. The
# token is used for the git operation, then scrubbed from .git/config so it
# never persists on disk. Never echo CLONE_URL — it contains the secret.
if [[ -n "$REPO_CLONE_TOKEN" && "$REPO_URL" == https://github.com/* ]]; then
  CLONE_URL="https://x-access-token:${REPO_CLONE_TOKEN}@${REPO_URL#https://}"
else
  CLONE_URL="$REPO_URL"
fi

# ── validate ──────────────────────────────────────────────────────────────────
[[ -n "$TELEGRAM_BOT_TOKEN" ]] || die "TELEGRAM_BOT_TOKEN is required."
[[ -n "$ALLOWED_CHAT_ID"    ]] || die "ALLOWED_CHAT_ID is required."
if [[ -n "$CLAUDE_CODE_OAUTH_TOKEN" && -n "$ANTHROPIC_API_KEY" ]]; then
  die "Set only ONE of CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, not both."
fi
if [[ -z "$CLAUDE_CODE_OAUTH_TOKEN" && -z "$ANTHROPIC_API_KEY" ]]; then
  die "Set one Claude auth method: CLAUDE_CODE_OAUTH_TOKEN (Max plan) or ANTHROPIC_API_KEY."
fi
case "$SSH_HARDENING" in off|public|tailscale-only) ;; *)
  die "SSH_HARDENING must be off | public | tailscale-only (got: $SSH_HARDENING)." ;;
esac
ENABLE_ACP="$(echo "$ENABLE_ACP" | tr '[:upper:]' '[:lower:]')"
case "$ENABLE_ACP" in true|false) ;; *)
  die "ENABLE_ACP must be true or false (got: $ENABLE_ACP)." ;;
esac
ok "Config validated (install dir: $INSTALL_DIR, user: $RUN_USER, port: $DASHBOARD_PORT)"

# ── 1. base packages ──────────────────────────────────────────────────────────
step "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl git ca-certificates gnupg jq openssl \
  build-essential python3 \
  ufw fail2ban unattended-upgrades >/dev/null
ok "Base packages installed"

# ── 2. Node 20 ────────────────────────────────────────────────────────────────
step "Ensuring Node.js 20+"
node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
fi
if [[ "$node_major" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v) / npm $(npm -v)"

# ── 3. dedicated unprivileged user ────────────────────────────────────────────
# The bot spawns Claude Code, which can run arbitrary code — it must never run
# as root. Home lives under /opt so systemd ProtectHome doesn't hide it.
step "Creating service user '$RUN_USER'"
if ! id "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$RUN_USER"
  ok "Created user $RUN_USER (home: $INSTALL_DIR)"
else
  ok "User $RUN_USER already exists"
fi
mkdir -p "$INSTALL_DIR"
chown "$RUN_USER:$RUN_USER" "$INSTALL_DIR"

# Run a command as the service user with HOME pointed at its install dir, so
# npm/git write caches/config there rather than into root's home.
# GIT_TERMINAL_PROMPT=0 makes git fail fast on a private repo instead of hanging
# on an interactive username/password prompt.
run_as() { runuser -u "$RUN_USER" -- env "HOME=$INSTALL_DIR" GIT_TERMINAL_PROMPT=0 "$@"; }

clone_help="Clone failed. If this is the private earlyaidopters repo, open the members
  token site, copy the ghs_... token from its clone command, set
  REPO_CLONE_TOKEN=ghs_... in $CONF, then re-run (tokens expire ~1h)."

# ── 4. clone + build ──────────────────────────────────────────────────────────
step "Cloning + building ClaudeClaw OS"
if [[ -d "$APP_DIR/.git" ]]; then
  run_as git -C "$APP_DIR" fetch --depth 1 "$CLONE_URL" "$REPO_BRANCH" || die "$clone_help"
  run_as git -C "$APP_DIR" reset --hard -q FETCH_HEAD
  run_as git -C "$APP_DIR" remote set-url origin "$REPO_URL"   # scrub any token
  ok "Updated existing checkout to latest $REPO_BRANCH"
else
  run_as git clone --branch "$REPO_BRANCH" --depth 1 "$CLONE_URL" "$APP_DIR" || die "$clone_help"
  run_as git -C "$APP_DIR" remote set-url origin "$REPO_URL"   # scrub any token
  ok "Cloned $REPO_URL ($REPO_BRANCH)"
fi
run_as bash -lc "cd '$APP_DIR' && npm install --no-audit --no-fund"
run_as bash -lc "cd '$APP_DIR' && npm run build"
run_as mkdir -p "$APP_DIR/store"
ok "Build complete"

# ── 5. Tailscale install + join ───────────────────────────────────────────────
step "Installing + joining Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
fi
systemctl enable --now tailscaled >/dev/null 2>&1 || true

if [[ -n "$TS_AUTHKEY" ]]; then
  tailscale up --authkey="$TS_AUTHKEY" --hostname="$TS_HOSTNAME" --ssh
else
  warn "No TS_AUTHKEY provided — starting interactive login."
  warn "Open the URL below on an authorized device to add this VPS to your tailnet:"
  tailscale up --hostname="$TS_HOSTNAME" --ssh
fi

# Derive the MagicDNS FQDN (strip trailing dot).
TS_FQDN="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
[[ -n "$TS_FQDN" && "$TS_FQDN" != "null" ]] || \
  die "Could not resolve Tailscale MagicDNS name. Enable MagicDNS + HTTPS certs in the admin console, then re-run."
ok "Tailnet name: $TS_FQDN"

# ── 6. write .env (non-interactive) ───────────────────────────────────────────
# Preserve secrets that must stay stable across re-runs.
step "Writing $ENV_FILE"
preserve() { # preserve <VAR_NAME> — echo existing value from .env if present
  # Strip one layer of surrounding quotes (mirrors readEnvFile in src/env.ts) so single- or
  # double-quoted values (e.g. quoted paths) round-trip cleanly for any caller.
  [[ -f "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- | sed -E "s/^'(.*)'\$/\1/; s/^\"(.*)\"\$/\1/" || true
}
DASHBOARD_TOKEN="$(preserve DASHBOARD_TOKEN)"; DASHBOARD_TOKEN="${DASHBOARD_TOKEN:-$(openssl rand -hex 24)}"
DB_ENCRYPTION_KEY="$(preserve DB_ENCRYPTION_KEY)"; DB_ENCRYPTION_KEY="${DB_ENCRYPTION_KEY:-$(openssl rand -hex 32)}"

CLAUDE_AUTH_LINE=""
if [[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]]; then
  CLAUDE_AUTH_LINE="CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN"
else
  CLAUDE_AUTH_LINE="ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
fi

umask 077
cat > "$ENV_FILE" <<EOF
# Generated by deploy/install-vps.sh on $(date -u +%FT%TZ). Do not commit.
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
ALLOWED_CHAT_ID=$ALLOWED_CHAT_ID

# Claude Code auth for headless host (no 'claude login' available).
$CLAUDE_AUTH_LINE

# Dashboard: bound to loopback; reachable only via Tailscale Serve (below).
DASHBOARD_TOKEN=$DASHBOARD_TOKEN
DASHBOARD_PORT=$DASHBOARD_PORT
DASHBOARD_URL=https://$TS_FQDN

# Persistent SQLite store lives on the VPS disk.
CLAUDECLAW_STORE_DIR=$APP_DIR/store
DB_ENCRYPTION_KEY=$DB_ENCRYPTION_KEY

# Beta multi-provider (ACP) switcher in the dashboard. When false, the provider
# is forced to Claude and the picker is hidden. Non-Claude providers additionally
# require their CLI installed + authenticated on this host.
ENABLE_ACP=$ENABLE_ACP
EOF
chown "$RUN_USER:$RUN_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok ".env written (mode 600, owner $RUN_USER)"

# ── 7. Tailscale Serve: publish dashboard over HTTPS to the tailnet ───────────
step "Publishing dashboard via Tailscale Serve (HTTPS, tailnet-only)"
# tailscaled (root) proxies https://$TS_FQDN -> http://127.0.0.1:$DASHBOARD_PORT
tailscale serve --bg --https=443 "http://127.0.0.1:${DASHBOARD_PORT}" \
  || die "tailscale serve failed. Ensure HTTPS certificates are enabled for your tailnet."
ok "Dashboard served at https://$TS_FQDN"

# ── 8. systemd service ────────────────────────────────────────────────────────
step "Installing systemd service"
UNIT=/etc/systemd/system/claudeclaw.service
cat > "$UNIT" <<EOF
[Unit]
Description=ClaudeClaw OS
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

# Hardening (compatible with spawning subprocesses + writing the store dir).
# Relax these if an optional feature breaks (see deploy/README.md).
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$INSTALL_DIR
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now claudeclaw >/dev/null
ok "Service enabled + started"

# ── 9. firewall ───────────────────────────────────────────────────────────────
step "Configuring firewall (ufw)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow in on tailscale0 >/dev/null         # all tailnet traffic
if [[ "$SSH_HARDENING" != "tailscale-only" ]]; then
  ufw allow OpenSSH >/dev/null                # public SSH stays open
fi
# DASHBOARD_PORT is intentionally NEVER opened publicly.
ufw --force enable >/dev/null
ok "ufw active (deny incoming; SSH=$SSH_HARDENING; dashboard not publicly exposed)"

# ── 10. extra hardening ───────────────────────────────────────────────────────
step "Hardening: fail2ban, auto-updates, SSH"
systemctl enable --now fail2ban >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

if [[ "$SSH_HARDENING" != "off" ]]; then
  SSHD_DROPIN=/etc/ssh/sshd_config.d/99-claudeclaw.conf
  if [[ "$SSH_HARDENING" == "tailscale-only" ]]; then
    warn "SSH_HARDENING=tailscale-only: public port 22 is now BLOCKED by ufw."
    warn "Recovery if Tailscale ever fails: use Hostinger's browser/VNC console"
    warn "(hPanel) — it bypasses ufw — and run 'ufw allow OpenSSH'."
    warn "Also disable this node's KEY EXPIRY in the Tailscale admin console so it"
    warn "never silently drops off the tailnet."
  fi
  cat > "$SSHD_DROPIN" <<'EOF'
# Managed by claudeclaw deploy. Key-only auth.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || true
  ok "SSH: password auth disabled, root password login disabled"
else
  ok "SSH: left unchanged (SSH_HARDENING=off)"
fi

# ── 11. verify + summary ──────────────────────────────────────────────────────
step "Verifying"
sleep 3
if systemctl is-active --quiet claudeclaw; then
  ok "Service is active"
else
  warn "Service not active yet — check: journalctl -u claudeclaw -n 50"
fi
if curl -fsS -o /dev/null "http://127.0.0.1:${DASHBOARD_PORT}/?token=${DASHBOARD_TOKEN}&chatId=${ALLOWED_CHAT_ID}"; then
  ok "Dashboard responds on loopback"
else
  warn "Dashboard did not respond yet (it may still be starting)."
fi

cat <<EOF

${B}${G}ClaudeClaw OS deployed.${Z}

  Dashboard (tailnet devices only):
    ${C}https://$TS_FQDN/?token=$DASHBOARD_TOKEN&chatId=$ALLOWED_CHAT_ID${Z}

  Service:   systemctl status claudeclaw
  Logs:      journalctl -u claudeclaw -f
  Tailscale: tailscale serve status
  .env:      $ENV_FILE  (chmod 600, owner $RUN_USER)

  Rotate the dashboard token:
    sudo sed -i "s/^DASHBOARD_TOKEN=.*/DASHBOARD_TOKEN=\$(openssl rand -hex 24)/" $ENV_FILE
    sudo systemctl restart claudeclaw

  Next steps: send a message from your allowed Telegram chat to confirm the bot replies.
EOF
