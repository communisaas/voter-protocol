#!/usr/bin/env bash
## Shadow Atlas VM bootstrap — run once on a fresh OCI/Hetzner ARM64 instance.
##
## Usage:
##   curl -sSL https://raw.githubusercontent.com/.../deploy/setup-vm.sh | bash
##   or: scp setup-vm.sh user@host: && ssh user@host bash setup-vm.sh
##
set -euo pipefail

echo "=== Shadow Atlas VM Setup ==="

# 1. Install Docker (if not present)
if ! command -v docker &>/dev/null; then
  echo "[1/5] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
  echo "  Docker installed. You may need to log out/in for group changes."
else
  echo "[1/5] Docker already installed."
fi

# 2. Create app directory
echo "[2/5] Creating /opt/shadow-atlas..."
sudo mkdir -p /opt/shadow-atlas
sudo chown "$USER:$USER" /opt/shadow-atlas

# 3. Copy compose file
echo "[3/5] Copying docker-compose.yml..."
if [ -f docker-compose.prod.yml ]; then
  cp docker-compose.prod.yml /opt/shadow-atlas/docker-compose.yml
else
  echo "  WARNING: docker-compose.prod.yml not found. Copy it manually."
fi

# 4. GHCR login (for pulling private images)
echo "[4/5] Authenticating with GHCR..."
echo "  Create a GitHub PAT with read:packages scope, then run:"
echo "  echo \$GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin"

# 5. Cloudflare Tunnel setup
echo "[5/5] Cloudflare Tunnel..."
echo "  1. Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
echo "  2. cloudflared tunnel login"
echo "  3. cloudflared tunnel create shadow-atlas"
echo "  4. cloudflared tunnel route dns shadow-atlas atlas.voter-protocol.org"
echo "  5. Copy the tunnel token to /opt/shadow-atlas/.env as CLOUDFLARE_TUNNEL_TOKEN=..."
echo ""
echo "Then: cd /opt/shadow-atlas && docker compose up -d"
echo ""
echo "=== Setup complete ==="
