# Shadow Atlas Infrastructure as Code
# Terraform configuration for Cloudflare Workers + R2 deployment
#
# Usage:
#   terraform init
#   terraform plan -var-file="environments/production.tfvars"
#   terraform apply -var-file="environments/production.tfvars"

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.20"
    }
  }

  # Backend configuration (S3-compatible)
  backend "s3" {
    bucket = "shadow-atlas-terraform-state"
    key    = "production/terraform.tfstate"
    region = "us-east-1"

    # Use Cloudflare R2 as backend (S3-compatible)
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}

# Provider configuration
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Local variables
locals {
  environment = var.environment
  project     = "shadow-atlas"
  common_tags = {
    Project     = local.project
    Environment = local.environment
    ManagedBy   = "terraform"
    Repository  = "voter-protocol"
  }
}

# Data sources
data "cloudflare_zone" "main" {
  name = var.zone_name
}
