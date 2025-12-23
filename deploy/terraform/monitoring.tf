# Monitoring and alerting configuration

# Workers Analytics Engine binding (for custom metrics)
resource "cloudflare_workers_kv_namespace" "analytics" {
  account_id = var.cloudflare_account_id
  title      = "${local.project}-analytics-${local.environment}"
}

# Healthcheck (production only)
resource "cloudflare_healthcheck" "api" {
  count = var.environment == "production" ? 1 : 0

  zone_id     = data.cloudflare_zone.main.id
  name        = "${local.project}-api-health"
  description = "Shadow Atlas API health check"
  address     = "api.${var.zone_name}/v1/health"
  suspended   = false
  check_regions = [
    "WNAM", # Western North America
    "ENAM", # Eastern North America
    "WEU",  # Western Europe
    "EEU",  # Eastern Europe
    "SEAS", # Southeast Asia
  ]

  type     = "HTTPS"
  port     = 443
  method   = "GET"
  timeout  = 5
  interval = 60

  expected_codes = ["200"]
  expected_body  = "healthy"

  follow_redirects = false
  allow_insecure   = false

  header {
    header = "User-Agent"
    values = ["Cloudflare-Healthcheck"]
  }
}

# Notification policy for health check failures (production only)
resource "cloudflare_notification_policy" "api_health_alert" {
  count = var.environment == "production" ? 1 : 0

  account_id  = var.cloudflare_account_id
  name        = "${local.project}-api-health-alert"
  description = "Alert when Shadow Atlas API health check fails"
  enabled     = true
  alert_type  = "health_check_status_notification"

  filters {
    health_check_id = [cloudflare_healthcheck.api[0].id]
  }

  email_integration {
    id = var.notification_email
  }
}

# Rate limiting rule (DDoS protection)
resource "cloudflare_rate_limit" "api_protection" {
  count = var.environment == "production" ? 1 : 0

  zone_id     = data.cloudflare_zone.main.id
  threshold   = var.rate_limit_threshold
  period      = 60
  description = "Shadow Atlas API rate limiting"

  match {
    request {
      url_pattern = "api.${var.zone_name}/v1/*"
    }
  }

  action {
    mode    = "challenge"
    timeout = 86400 # 24 hours
  }

  correlate {
    by = "nat"
  }

  disabled = false
  bypass_url_patterns = [
    "api.${var.zone_name}/v1/health",
  ]
}

# Page Rule for caching (production only)
resource "cloudflare_page_rule" "api_cache" {
  count = var.environment == "production" ? 1 : 0

  zone_id  = data.cloudflare_zone.main.id
  target   = "api.${var.zone_name}/v1/snapshot"
  priority = 1
  status   = "active"

  actions {
    cache_level         = "cache_everything"
    edge_cache_ttl      = 3600 # 1 hour
    browser_cache_ttl   = 1800 # 30 minutes
    cache_on_cookie     = "none"
    disable_performance = false
  }
}
