# Shadow Atlas Deployment Guide

**Cost-efficient, self-hosted deployment for zero cloud fees**

---

## Quick Start (5 minutes)

### Local Development (Zero Cost)

```bash
# 1. Clone the repository
git clone https://github.com/voter-protocol/voter-protocol.git
cd voter-protocol/packages/shadow-atlas

# 2. Build the Docker image
docker build -t shadow-atlas .

# 3. Run the container
docker run -d \
  --name shadow-atlas \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  shadow-atlas

# 4. Verify it's running
curl http://localhost:3000/v1/health
```

**That's it!** You now have Shadow Atlas running locally with zero cloud costs.

---

## Deployment Options

### Option 1: Docker Compose (Recommended)

Perfect for persistent deployment on any machine.

**1. Create configuration:**
```bash
cp .env.example .env
# Edit .env with your settings
```

**2. Start the service:**
```bash
docker-compose up -d
```

**3. Check logs:**
```bash
docker-compose logs -f shadow-atlas
```

**4. Stop the service:**
```bash
docker-compose down
```

### Option 2: Docker CLI

For manual control and custom configurations.

**Basic deployment:**
```bash
docker run -d \
  --name shadow-atlas \
  -p 3000:3000 \
  -v shadow-atlas-data:/data \
  -e PORT=3000 \
  -e DB_PATH=/data/shadow-atlas.db \
  --restart unless-stopped \
  shadow-atlas
```

**With environment file:**
```bash
docker run -d \
  --name shadow-atlas \
  -p 3000:3000 \
  -v shadow-atlas-data:/data \
  --env-file .env \
  --restart unless-stopped \
  shadow-atlas
```

**Custom CORS origins:**
```bash
docker run -d \
  --name shadow-atlas \
  -p 3000:3000 \
  -v shadow-atlas-data:/data \
  -e CORS_ORIGINS=https://voter-protocol.org,https://app.voter-protocol.org \
  --restart unless-stopped \
  shadow-atlas
```

### Option 3: VPS Deployment

Deploy to a low-cost VPS for $5-10/month.

**DigitalOcean Droplet:**
```bash
# 1. SSH into your droplet
ssh root@your-droplet-ip

# 2. Install Docker
curl -fsSL https://get.docker.com | sh

# 3. Clone and deploy
git clone https://github.com/voter-protocol/voter-protocol.git
cd voter-protocol/packages/shadow-atlas

# 4. Configure environment
cp .env.example .env
nano .env  # Edit configuration

# 5. Start with Docker Compose
docker-compose up -d

# 6. (Optional) Set up reverse proxy with Caddy
echo "api.yourdomain.com {
  reverse_proxy localhost:3000
}" > /etc/caddy/Caddyfile
systemctl restart caddy
```

**Linode/Vultr/Hetzner:**
Same process as DigitalOcean above.

### Option 4: Home Server / NAS

Run on Synology, QNAP, or Raspberry Pi.

**Requirements:**
- Docker support
- 2GB RAM minimum
- 10GB storage

**Steps:**
1. Install Docker from package manager
2. Upload Dockerfile via web UI or SSH
3. Build and run as shown in Quick Start

---

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Server
PORT=3000                    # API port
HOST=0.0.0.0                # Bind to all interfaces

# Database (persisted to /data volume)
DB_PATH=/data/shadow-atlas.db

# IPFS gateway for snapshots
IPFS_GATEWAY=https://w3s.link

# Rate limiting
RATE_LIMIT_PER_MINUTE=60

# CORS (comma-separated or *)
CORS_ORIGINS=*
```

### Volume Mounts

The `/data` volume persists:
- SQLite database (`shadow-atlas.db`)
- Snapshot cache
- Logs

**Named volume (recommended):**
```bash
docker volume create shadow-atlas-data
docker run -v shadow-atlas-data:/data ...
```

**Host directory:**
```bash
docker run -v /path/on/host:/data ...
```

### Port Mapping

Default: `3000:3000` (host:container)

**Custom port:**
```bash
docker run -p 8080:3000 ...  # Access at http://localhost:8080
```

---

## Production Hardening

### 1. Reverse Proxy (Recommended)

Use Caddy for automatic HTTPS:

```bash
# Install Caddy
sudo apt install caddy

# Configure
echo "api.yourdomain.com {
  reverse_proxy localhost:3000
}" > /etc/caddy/Caddyfile

sudo systemctl restart caddy
```

Caddy automatically handles:
- HTTPS certificates (Let's Encrypt)
- Certificate renewal
- HTTP → HTTPS redirect

### 2. Firewall

```bash
# Allow only HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# SSH should already be allowed
sudo ufw allow 22/tcp
```

### 3. Resource Limits

Prevent runaway resource usage:

```yaml
# docker-compose.yml
services:
  shadow-atlas:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### 4. Health Monitoring

Built-in health check:
```bash
curl http://localhost:3000/v1/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 3600,
  "queries": { "total": 1000, "latencyP95": 42.1 },
  "cache": { "hitRate": 0.85 }
}
```

### 5. Logging

View logs:
```bash
# Docker Compose
docker-compose logs -f shadow-atlas

# Docker CLI
docker logs -f shadow-atlas
```

### 6. Backups

Backup the database:
```bash
# Stop container
docker-compose down

# Backup data volume
docker run --rm \
  -v shadow-atlas-data:/data \
  -v $(pwd)/backups:/backups \
  alpine tar czf /backups/shadow-atlas-$(date +%Y%m%d).tar.gz /data

# Restart container
docker-compose up -d
```

---

## Monitoring (Optional)

### Prometheus + Grafana

**1. Add Prometheus to docker-compose.yml:**
```yaml
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  grafana-data:
```

**2. Create prometheus.yml:**
```yaml
scrape_configs:
  - job_name: 'shadow-atlas'
    static_configs:
      - targets: ['shadow-atlas:3000']
    metrics_path: '/v1/metrics'
    scrape_interval: 15s
```

**3. Access:**
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker logs shadow-atlas

# Common issues:
# - Port already in use: Change port mapping
# - Volume permission: Check /data ownership
# - Missing .env: Copy from .env.example
```

### High memory usage

```bash
# Check stats
docker stats shadow-atlas

# Reduce cache size in .env:
CACHE_SIZE=5000
CACHE_TTL_SECONDS=1800
```

### Slow queries

```bash
# Check health endpoint
curl http://localhost:3000/v1/health | jq '.queries'

# Look for:
# - Low cache hit rate (<50%): Increase CACHE_SIZE
# - High p95 latency (>100ms): Check database size
```

### Database corruption

```bash
# Stop container
docker-compose down

# Restore from backup
docker run --rm \
  -v shadow-atlas-data:/data \
  -v $(pwd)/backups:/backups \
  alpine tar xzf /backups/shadow-atlas-20260126.tar.gz -C /

# Restart
docker-compose up -d
```

---

## Cost Comparison

| Deployment | Monthly Cost | Notes |
|------------|--------------|-------|
| **Local Machine** | $0 | Run on laptop/desktop |
| **Home Server** | $0 | One-time hardware cost |
| **Raspberry Pi 4** | $0 | $50 one-time, <$2/month power |
| **VPS (DigitalOcean)** | $6 | 1 vCPU, 2GB RAM |
| **VPS (Linode)** | $5 | 1 vCPU, 2GB RAM |
| **VPS (Hetzner)** | €4.51 (~$5) | 2 vCPU, 4GB RAM (best value) |
| **AWS/GCP/Azure** | $30-50 | NOT recommended - overpriced |

**Recommendation:** Start with local deployment ($0), then move to Hetzner VPS if needed ($5/month).

---

## Upgrade Process

```bash
# 1. Pull latest code
git pull origin main

# 2. Rebuild image
docker-compose build

# 3. Restart with new image
docker-compose up -d

# 4. Verify
curl http://localhost:3000/v1/health
```

---

## Support

- **Documentation:** `/docs` directory
- **Issues:** https://github.com/voter-protocol/voter-protocol/issues
- **Health Check:** `GET /v1/health`

---

**Goal:** Maximum cost efficiency. Run locally for zero cloud costs, or deploy to a $5/month VPS if needed.
