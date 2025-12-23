# Development environment configuration
# Low resource allocation for testing and development

cloudflare_account_id = "REPLACE_WITH_YOUR_ACCOUNT_ID"
zone_name             = "shadow-atlas.org"
environment           = "development"
api_version           = "v1"

# Disable production features
enable_logging      = false
notification_email  = ""
rate_limit_threshold = 100 # Lower threshold for dev

# Cost estimation (minimal usage)
estimated_monthly_requests = 100000  # 100k requests/month
r2_storage_gb             = 1       # 1 GB storage
