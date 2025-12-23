# Shadow Atlas Terraform Variables

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Workers, R2, and DNS permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "zone_name" {
  description = "Cloudflare zone name (e.g., shadow-atlas.org)"
  type        = string
}

variable "environment" {
  description = "Deployment environment (development, staging, production)"
  type        = string
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be development, staging, or production"
  }
}

variable "api_version" {
  description = "API version (e.g., v1)"
  type        = string
  default     = "v1"
}

variable "enable_logging" {
  description = "Enable Logpush for worker logs"
  type        = bool
  default     = false
}

variable "notification_email" {
  description = "Email address for health check alerts"
  type        = string
  default     = ""
}

variable "rate_limit_threshold" {
  description = "Rate limit threshold (requests per minute)"
  type        = number
  default     = 1000
}

# Cost configuration
variable "estimated_monthly_requests" {
  description = "Estimated monthly request volume (for cost projection)"
  type        = number
  default     = 1000000
}

variable "r2_storage_gb" {
  description = "Estimated R2 storage size in GB"
  type        = number
  default     = 50
}
