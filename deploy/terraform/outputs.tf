# Shadow Atlas Terraform Outputs

output "r2_bucket_name" {
  description = "R2 bucket name for district data"
  value       = cloudflare_r2_bucket.districts.name
}

output "worker_script_name" {
  description = "Cloudflare Worker script name"
  value       = cloudflare_worker_script.shadow_atlas_api.name
}

output "api_url" {
  description = "API endpoint URL"
  value = var.environment == "production" ? "https://api.${var.zone_name}" : "https://${cloudflare_worker_script.shadow_atlas_api.name}.workers.dev"
}

output "rate_limit_kv_id" {
  description = "Workers KV namespace ID for rate limiting"
  value       = cloudflare_workers_kv_namespace.rate_limit.id
}

output "cache_kv_id" {
  description = "Workers KV namespace ID for caching"
  value       = cloudflare_workers_kv_namespace.cache.id
}

output "healthcheck_id" {
  description = "Health check ID (production only)"
  value       = var.environment == "production" ? cloudflare_healthcheck.api[0].id : null
}

# Cost estimate
output "estimated_monthly_cost_usd" {
  description = "Estimated monthly cost in USD (approximate)"
  value = {
    workers_requests     = max(0, (var.estimated_monthly_requests - 10000000) * 0.50 / 1000000)
    workers_cpu          = max(0, (var.estimated_monthly_requests * 10 - 30000000) * 0.02 / 1000000)
    r2_storage           = max(0, (var.r2_storage_gb - 10) * 0.015)
    r2_reads             = max(0, (var.estimated_monthly_requests * 0.1 - 10000000) * 0.36 / 1000000)
    kv_reads             = max(0, (var.estimated_monthly_requests - 100000) * 0.50 / 10000000)
    workers_base         = 5.00
    total                = (
      5.00 +
      max(0, (var.estimated_monthly_requests - 10000000) * 0.50 / 1000000) +
      max(0, (var.estimated_monthly_requests * 10 - 30000000) * 0.02 / 1000000) +
      max(0, (var.r2_storage_gb - 10) * 0.015) +
      max(0, (var.estimated_monthly_requests * 0.1 - 10000000) * 0.36 / 1000000) +
      max(0, (var.estimated_monthly_requests - 100000) * 0.50 / 10000000)
    )
  }
}

output "deployment_info" {
  description = "Deployment information"
  value = {
    environment = var.environment
    api_version = var.api_version
    zone_name   = var.zone_name
    timestamp   = timestamp()
  }
}
