# Staging environment configuration
# Moderate resource allocation for pre-production testing

cloudflare_account_id = "REPLACE_WITH_YOUR_ACCOUNT_ID"
zone_name             = "shadow-atlas.org"
environment           = "staging"
api_version           = "v1"

# Enable logging for staging validation
enable_logging      = true
notification_email  = "staging-alerts@voter-protocol.org"
rate_limit_threshold = 500

# Cost estimation (moderate usage)
estimated_monthly_requests = 1000000  # 1M requests/month
r2_storage_gb             = 10       # 10 GB storage
