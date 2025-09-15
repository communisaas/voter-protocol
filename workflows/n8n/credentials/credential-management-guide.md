# N8N Credential Management Guide

## Overview

This guide outlines best practices for managing credentials in our N8N workflows, including proper credential storage, rotation strategies, and security configurations.

## Credential Types

### 1. HTTP Header Auth (Agent API Authentication)

**Credential Name**: `agent-api-auth`
**Type**: HTTP Header Auth
**Usage**: Authentication for our agent communication sub-workflow

```json
{
  "name": "x-webhook-secret",
  "value": "{{$env.AGENT_API_SECRET}}"
}
```

**Environment Variables Required**:
- `AGENT_API_SECRET`: Secret key for agent API authentication

### 2. PostgreSQL Database

**Credential Name**: `communique-db`
**Type**: Postgres
**Usage**: All database operations through the database operations sub-workflow

```json
{
  "host": "{{$env.DB_HOST}}",
  "port": "{{$env.DB_PORT}}",
  "database": "{{$env.DB_NAME}}",
  "user": "{{$env.DB_USER}}",
  "password": "{{$env.DB_PASSWORD}}",
  "ssl": "require"
}
```

**Environment Variables Required**:
- `DB_HOST`: Database hostname
- `DB_PORT`: Database port (default: 5432)
- `DB_NAME`: Database name
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password

### 3. Redis Cache

**Credential Name**: `redis-cache`
**Type**: Redis
**Usage**: Caching and dead letter queue storage

```json
{
  "host": "{{$env.REDIS_HOST}}",
  "port": "{{$env.REDIS_PORT}}",
  "password": "{{$env.REDIS_PASSWORD}}",
  "database": "{{$env.REDIS_DB}}"
}
```

**Environment Variables Required**:
- `REDIS_HOST`: Redis hostname
- `REDIS_PORT`: Redis port (default: 6379)
- `REDIS_PASSWORD`: Redis password
- `REDIS_DB`: Redis database number (default: 0)

### 4. Slack Notifications

**Credential Name**: `slack-notifications`
**Type**: Slack API
**Usage**: Standard notifications for workflow completions

```json
{
  "accessToken": "{{$env.SLACK_BOT_TOKEN}}"
}
```

**Environment Variables Required**:
- `SLACK_BOT_TOKEN`: Slack bot token (starts with `xoxb-`)

### 5. Slack Alerts

**Credential Name**: `slack-alerts`
**Type**: Slack API
**Usage**: Critical alerts and error notifications

```json
{
  "accessToken": "{{$env.SLACK_ALERT_TOKEN}}"
}
```

**Environment Variables Required**:
- `SLACK_ALERT_TOKEN`: Slack bot token for alerts (can be same as notifications)

### 6. Webhook Secrets

**Credential Name**: `webhook-secret`
**Type**: HTTP Header Auth
**Usage**: Webhook signature validation

```json
{
  "name": "x-webhook-secret",
  "value": "{{$env.N8N_WEBHOOK_SECRET}}"
}
```

**Environment Variables Required**:
- `N8N_WEBHOOK_SECRET`: Secret for webhook signature validation

## Security Best Practices

### 1. Environment Variable Management

```bash
# Production environment variables
export AGENT_API_SECRET="secure-random-string-here"
export DB_PASSWORD="strong-database-password"
export REDIS_PASSWORD="strong-redis-password"
export SLACK_BOT_TOKEN="xoxb-your-slack-token"
export N8N_WEBHOOK_SECRET="webhook-validation-secret"

# Database connection
export DB_HOST="your-db-host.com"
export DB_PORT="5432"
export DB_NAME="voter_protocol"
export DB_USER="n8n_worker"

# Redis connection
export REDIS_HOST="your-redis-host.com"
export REDIS_PORT="6379"
export REDIS_DB="0"
```

### 2. Credential Rotation Strategy

#### Quarterly Rotation Schedule

1. **Week 1**: Generate new credentials
2. **Week 2**: Update staging environment
3. **Week 3**: Test all workflows in staging
4. **Week 4**: Deploy to production

#### Rotation Checklist

- [ ] Generate new strong passwords/tokens
- [ ] Update environment variables
- [ ] Test all workflow connections
- [ ] Verify sub-workflow functionality
- [ ] Monitor for authentication errors
- [ ] Document rotation in security log

### 3. Access Control

#### N8N User Roles

- **Admin**: Full access to credentials and workflows
- **Developer**: Read access to workflows, limited credential access
- **Operator**: Execute workflows, no credential access

#### Credential Scope

- **Global**: Available to all workflows (database, Redis)
- **Workflow-specific**: Limited to specific workflows (API keys)
- **Sub-workflow**: Shared across related workflows (agent auth)

### 4. Monitoring and Auditing

#### Failed Authentication Alerts

```json
{
  "alert_name": "credential_authentication_failure",
  "condition": "authentication_failures > 5 in 5 minutes",
  "actions": [
    "slack_alert_critical",
    "email_security_team",
    "temporarily_disable_credential"
  ]
}
```

#### Credential Usage Logging

- Log all credential access attempts
- Monitor unusual usage patterns
- Track credential rotation dates
- Alert on expired credentials

## Configuration Files

### N8N Environment Configuration

```env
# N8N Core Configuration
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=secure_admin_password

# Webhook Configuration
N8N_HOST=your-n8n-host.com
N8N_PORT=5678
N8N_PROTOCOL=https

# Database Configuration (for N8N itself)
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=${DB_HOST}
DB_POSTGRESDB_PORT=${DB_PORT}
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=${DB_PASSWORD}

# Security Configuration
N8N_SECURE_COOKIE=true
N8N_JWT_AUTH_ACTIVE=true
N8N_JWT_AUTH_HEADER=authorization
```

### Docker Compose for Production

```yaml
version: '3.8'
services:
  n8n:
    image: n8nio/n8n:latest
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
      - WEBHOOK_URL=https://your-n8n-host.com/
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=${DB_HOST}
      - DB_POSTGRESDB_PORT=${DB_PORT}
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=${DB_PASSWORD}
    volumes:
      - n8n_data:/home/node/.n8n
    ports:
      - "5678:5678"
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=n8n
      - POSTGRES_USER=n8n
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data

volumes:
  n8n_data:
  postgres_data:
  redis_data:
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Check environment variables are set
   - Verify credential configuration in N8N
   - Test connections manually

2. **Token Expiration**
   - Slack tokens may expire
   - Database passwords may be rotated
   - Check expiration dates regularly

3. **Network Connectivity**
   - Verify firewall rules
   - Check DNS resolution
   - Test with curl/telnet

### Emergency Procedures

#### Credential Compromise

1. Immediately rotate affected credentials
2. Update all workflow configurations
3. Review access logs for suspicious activity
4. Document incident for security review

#### Service Outage

1. Check credential validity first
2. Verify network connectivity
3. Review error logs
4. Escalate to infrastructure team if needed

## Integration with VOTER Protocol

### Agent API Integration

Our agent communication sub-workflow uses HTTP header authentication to communicate with the VOTER Protocol agent APIs. The credentials are configured to use environment variables for security.

### Database Integration

The database operations sub-workflow connects to the same PostgreSQL instance used by the VOTER Protocol, ensuring data consistency and efficient operations.

### Monitoring Integration

All credential-related events are logged and can be integrated with the VOTER Protocol's monitoring infrastructure for comprehensive security oversight.

## Maintenance Schedule

### Daily
- Monitor authentication failure alerts
- Check credential usage logs

### Weekly
- Review access patterns
- Update credential documentation

### Monthly
- Test credential backup/restore procedures
- Review and update access controls

### Quarterly
- Rotate all credentials
- Security audit of credential management
- Update this documentation

---

**Security Contact**: For credential-related security issues, contact the security team immediately.

**Last Updated**: 2024-01-14
**Next Review**: 2024-04-14