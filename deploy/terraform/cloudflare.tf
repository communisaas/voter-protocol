# Cloudflare Workers, R2, and KV resources

# R2 Bucket for district GeoJSON data
resource "cloudflare_r2_bucket" "districts" {
  account_id = var.cloudflare_account_id
  name       = "${local.project}-districts-${local.environment}"
  location   = "WNAM" # Western North America

  lifecycle {
    prevent_destroy = true
  }
}

# Workers KV Namespace for rate limiting
resource "cloudflare_workers_kv_namespace" "rate_limit" {
  account_id = var.cloudflare_account_id
  title      = "${local.project}-rate-limit-${local.environment}"
}

# Workers KV Namespace for caching
resource "cloudflare_workers_kv_namespace" "cache" {
  account_id = var.cloudflare_account_id
  title      = "${local.project}-cache-${local.environment}"
}

# Workers Script deployment
resource "cloudflare_worker_script" "shadow_atlas_api" {
  account_id = var.cloudflare_account_id
  name       = "${local.project}-api-${local.environment}"
  content    = file("${path.module}/../cloudflare/dist/worker.js")

  # R2 bucket bindings
  r2_bucket_binding {
    name        = "DISTRICTS_BUCKET"
    bucket_name = cloudflare_r2_bucket.districts.name
  }

  # KV namespace bindings
  kv_namespace_binding {
    name         = "RATE_LIMIT_KV"
    namespace_id = cloudflare_workers_kv_namespace.rate_limit.id
  }

  kv_namespace_binding {
    name         = "CACHE_KV"
    namespace_id = cloudflare_workers_kv_namespace.cache.id
  }

  # Environment variables
  plain_text_binding {
    name = "ENVIRONMENT"
    text = local.environment
  }

  plain_text_binding {
    name = "API_VERSION"
    text = var.api_version
  }
}

# Workers Route (production only)
resource "cloudflare_worker_route" "shadow_atlas_api" {
  count = var.environment == "production" ? 1 : 0

  zone_id     = data.cloudflare_zone.main.id
  pattern     = "api.${var.zone_name}/*"
  script_name = cloudflare_worker_script.shadow_atlas_api.name
}

# Workers Domain (production only)
resource "cloudflare_worker_domain" "shadow_atlas_api" {
  count = var.environment == "production" ? 1 : 0

  account_id  = var.cloudflare_account_id
  hostname    = "api.${var.zone_name}"
  service     = cloudflare_worker_script.shadow_atlas_api.name
  environment = "production"
}

# Logpush job for observability
resource "cloudflare_logpush_job" "worker_logs" {
  count = var.enable_logging ? 1 : 0

  account_id         = var.cloudflare_account_id
  name               = "${local.project}-worker-logs-${local.environment}"
  dataset            = "workers_trace_events"
  destination_conf   = "r2://${cloudflare_r2_bucket.logs[0].name}/worker-logs/{DATE}"
  enabled            = true
  frequency          = "high"
  max_upload_records = 1000

  output_options {
    field_names = [
      "EventTimestampMs",
      "Outcome",
      "ScriptName",
      "DispatchNamespace",
      "Logs",
    ]
  }
}

# R2 Bucket for logs (if logging enabled)
resource "cloudflare_r2_bucket" "logs" {
  count = var.enable_logging ? 1 : 0

  account_id = var.cloudflare_account_id
  name       = "${local.project}-logs-${local.environment}"
  location   = "WNAM"
}
