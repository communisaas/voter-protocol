# Docker Deployment - Shadow Atlas

**Quick reference for Docker deployment**

---

## Quick Start

```bash
# Build
docker build -t shadow-atlas .

# Run
docker run -d -p 3000:3000 -v $(pwd)/data:/data shadow-atlas

# Check health
curl http://localhost:3000/v1/health
```

---

## Dockerfile Features

- **Multi-stage build**: Minimal runtime image (~200MB)
- **Non-root user**: `shadow-atlas` user for security
- **Volume mount**: `/data` for SQLite database persistence
- **Health check**: Automatic container monitoring
- **Node.js 22 slim**: Latest LTS with minimal footprint

---

## Environment Variables

Set via `-e` flag or `--env-file`:

```bash
# Server
PORT=3000
HOST=0.0.0.0

# Database (persisted to /data volume)
DB_PATH=/data/shadow-atlas.db

# IPFS
IPFS_GATEWAY=https://w3s.link

# API
CORS_ORIGINS=*
RATE_LIMIT_PER_MINUTE=60
```

---

## Volume Mounts

### Named Volume (Recommended)
```bash
docker volume create shadow-atlas-data
docker run -v shadow-atlas-data:/data shadow-atlas
```

### Host Directory
```bash
docker run -v /path/on/host:/data shadow-atlas
```

### List Data
```bash
docker run --rm -v shadow-atlas-data:/data alpine ls -la /data
```

---

## Docker Compose

```yaml
version: '3.8'
services:
  shadow-atlas:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - shadow-atlas-data:/data
    environment:
      - PORT=3000
      - DB_PATH=/data/shadow-atlas.db
    restart: unless-stopped

volumes:
  shadow-atlas-data:
```

Run:
```bash
docker-compose up -d
docker-compose logs -f
docker-compose down
```

---

## Commands

### Build
```bash
docker build -t shadow-atlas .
docker build -t shadow-atlas:v0.1.0 .
```

### Run
```bash
# Basic
docker run -d --name shadow-atlas -p 3000:3000 shadow-atlas

# With volume
docker run -d -p 3000:3000 -v shadow-atlas-data:/data shadow-atlas

# With env file
docker run -d -p 3000:3000 --env-file .env shadow-atlas

# With custom CORS
docker run -d -p 3000:3000 \
  -e CORS_ORIGINS=https://voter-protocol.org \
  shadow-atlas
```

### Manage
```bash
# View logs
docker logs -f shadow-atlas

# Stop
docker stop shadow-atlas

# Start
docker start shadow-atlas

# Restart
docker restart shadow-atlas

# Remove
docker rm shadow-atlas

# Shell access
docker exec -it shadow-atlas sh
```

### Inspect
```bash
# Container stats
docker stats shadow-atlas

# Inspect
docker inspect shadow-atlas

# Health check
docker inspect --format='{{.State.Health.Status}}' shadow-atlas
```

---

## Health Check

Built-in health check runs every 30 seconds:

```bash
# View health status
docker inspect --format='{{json .State.Health}}' shadow-atlas | jq

# Manual health check
curl http://localhost:3000/v1/health
```

---

## Troubleshooting

### Container won't start
```bash
docker logs shadow-atlas
```

### Port already in use
```bash
# Use different port
docker run -p 8080:3000 shadow-atlas
```

### Volume permissions
```bash
# Check ownership
docker run --rm -v shadow-atlas-data:/data alpine ls -la /data

# Fix permissions (if needed)
docker run --rm -v shadow-atlas-data:/data alpine chown -R 1000:1000 /data
```

### Database locked
```bash
# Stop container
docker stop shadow-atlas

# Check for other processes
docker ps -a | grep shadow-atlas

# Restart
docker start shadow-atlas
```

---

## Production Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for:
- VPS deployment
- Reverse proxy setup
- Monitoring
- Backups
- Security hardening

---

## Image Size

```bash
docker images shadow-atlas
```

Expected: ~200MB (multi-stage build optimized)

---

## Cost Comparison

| Platform | Cost/Month |
|----------|------------|
| Local machine | $0 |
| DigitalOcean Droplet | $6 |
| Linode Nanode | $5 |
| Hetzner Cloud | €4.51 (~$5) |

**Recommendation:** Run locally for $0, or use Hetzner for best value.
