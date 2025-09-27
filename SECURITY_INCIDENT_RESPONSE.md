# Security Documentation: Circuit Breakers & Incident Response

## Automated Security: Mathematical Circuit Breakers

VOTER Protocol implements multi-layer automated security without administrative intervention.

### Circuit Breaker Protection Levels

**CircuitBreaker.sol** - Automatic attack prevention:
- **Massive single actions**: Block individual actions >100,000 VOTER tokens
- **Rapid user actions**: Limit users to 50 actions per hour
- **Suspicious batches**: Flag >20 identical actions in same block
- **Zero-value spam**: Reject all zero-value transactions

**Treasury Protection** - Mathematical spending limits:
- **Daily disbursement caps**: Automatic limits prevent treasury drainage
- **Weekly spending limits**: Multi-day protection against sustained attacks
- **Emergency reserves**: Protected funds that can only grow, never withdraw

**Parameter Protection** - Time-locked changes:
- **48-hour timelock**: All parameter changes require waiting period
- **Agent consensus required**: No changes without cryptographic proof
- **Bounded modifications**: Hard min/max limits agents cannot exceed

### Attack Response Protocol

1. **Automatic detection**: Circuit breakers trigger on suspicious patterns
2. **Mathematical halting**: Attacks blocked by code, not administrators
3. **Agent consensus**: Only mechanism for emergency responses
4. **Event emission**: All security actions logged transparently
5. **No human override**: Zero administrative backdoors exist

**Security Status**: Zero admin control. Attacks prevented by mathematics.

---

## Incident History

### Previous Incident Summary
**Date**: January 15, 2025
**Severity**: CRITICAL
**Type**: Exposed credentials in version control

The `.env` file containing sensitive credentials was accidentally committed to the public GitHub repository.

## Exposed Credentials
The following credentials were exposed and have been rotated:

- **N8N API Key**: Old key removed, new key generated and deployed
- **Fly.io App**: `voter-n8n`

Note: N8N admin password and webhook secret were removed as they are not needed for API-only access to self-hosted N8N.

## Immediate Actions Required

### 1. Clean Git History (URGENT)
```bash
# Install BFG Repo-Cleaner if not installed
brew install bfg  # macOS
# or download from https://rtyley.github.io/bfg-repo-cleaner/

# Clean all traces of .env from history
bfg --delete-files .env
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push cleaned history
git push origin --force --all
git push origin --force --tags
```

### 2. Rotate N8N Credentials on Fly.io
```bash
# Login to Fly.io
fly auth login

# Generate new secure credentials
export NEW_ADMIN_PASSWORD=$(openssl rand -base64 32)
export NEW_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Update N8N instance
fly secrets set -a voter-n8n \
  N8N_ADMIN_PASSWORD="$NEW_ADMIN_PASSWORD" \
  N8N_WEBHOOK_SECRET="$NEW_WEBHOOK_SECRET"

# Restart the app to apply changes
fly apps restart voter-n8n

# Save new credentials to local .env (NOT in git!)
echo "N8N_ADMIN_PASSWORD=$NEW_ADMIN_PASSWORD" >> .env
echo "N8N_WEBHOOK_SECRET=$NEW_WEBHOOK_SECRET" >> .env
```

### 3. Generate New N8N API Key
1. Login to N8N with new admin password: https://voter-n8n.fly.dev
2. Navigate to Settings → API Keys
3. Delete the compromised API key
4. Generate a new API key
5. Update local .env file with new key

### 4. Update Communiqué Integration
```bash
# Update the Communiqué app with new N8N credentials
cd /Users/noot/Documents/communique

# Update environment variables in production
fly secrets set -a communique \
  N8N_API_KEY="<new-api-key-from-n8n>" \
  N8N_WEBHOOK_SECRET="<new-webhook-secret>"

# Restart Communiqué
fly apps restart communique
```

### 5. Audit Access Logs
```bash
# Check N8N access logs for unauthorized access
fly logs -a voter-n8n --since 24h | grep -E "(auth|login|api)"

# Monitor for suspicious workflow executions
fly ssh console -a voter-n8n
# Inside container:
sqlite3 /home/node/.n8n/database.sqlite \
  "SELECT * FROM workflow_statistics WHERE created_at > datetime('now', '-1 day');"
```

## Prevention Measures

### Already Implemented
- ✅ Added comprehensive `.gitignore` with environment variable exclusions
- ✅ Created secure `.env.example` template with warnings
- ✅ Removed `.env` from version control

### Additional Recommendations
1. **Pre-commit Hooks**: Install git-secrets or similar tools
   ```bash
   brew install git-secrets
   git secrets --install
   git secrets --register-aws  # Detects AWS keys
   git secrets --add '.env'    # Block .env files
   ```

2. **Secret Management Service**: Consider using:
   - Fly.io secrets for production
   - 1Password CLI for local development
   - AWS Secrets Manager for enterprise deployment

3. **Regular Audits**:
   - Weekly credential rotation schedule
   - Monthly git history audit for sensitive data
   - Quarterly security review

## Verification Checklist

- [ ] BFG cleanup completed
- [ ] Repository force-pushed
- [ ] N8N admin password changed
- [ ] N8N webhook secret rotated
- [ ] N8N API key regenerated
- [ ] Communiqué updated with new credentials
- [ ] Access logs reviewed for unauthorized access
- [ ] Team notified of incident
- [ ] Pre-commit hooks installed
- [ ] Incident documented in security log

## Lessons Learned

1. **Never commit .env files** - Even temporarily
2. **Use .env.example** - Always maintain a template without real values
3. **Gitignore first** - Set up .gitignore before creating sensitive files
4. **Regular audits** - Scan repository for exposed secrets regularly
5. **Secret management** - Use proper secret management tools in production

## Contact

If you discover unauthorized access or need assistance:
- Security Team: [security@voterprotocol.org]
- Incident Response: [Use internal Slack #security channel]

---

**Remember**: This incident requires immediate action. All exposed credentials should be considered compromised and must be rotated before any other development work continues.