# Production environment configuration
# Full resource allocation for production workloads

cloudflare_account_id = "REPLACE_WITH_YOUR_ACCOUNT_ID"
zone_name             = "shadow-atlas.org"
environment           = "production"
api_version           = "v1"

# Enable all production features
enable_logging      = true
notification_email  = "ops@voter-protocol.org"
rate_limit_threshold = 1000

# Cost estimation (production scale)
estimated_monthly_requests = 100000000  # 100M requests/month
r2_storage_gb             = 50         # 50 GB storage

# Production-specific configuration
# - Health checks enabled globally (5 regions)
# - Logpush enabled to R2
# - Rate limiting with CAPTCHA challenge
# - DNS records configured
# - CAA records for certificate security
