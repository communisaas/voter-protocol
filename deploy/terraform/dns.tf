# DNS configuration for Shadow Atlas API

# CNAME record for API subdomain (production only)
resource "cloudflare_record" "api" {
  count = var.environment == "production" ? 1 : 0

  zone_id = data.cloudflare_zone.main.id
  name    = "api"
  value   = cloudflare_worker_script.shadow_atlas_api.name
  type    = "CNAME"
  proxied = true
  ttl     = 1 # Auto (Cloudflare managed)

  comment = "Shadow Atlas API endpoint"
}

# CNAME record for staging subdomain (staging only)
resource "cloudflare_record" "staging" {
  count = var.environment == "staging" ? 1 : 0

  zone_id = data.cloudflare_zone.main.id
  name    = "staging"
  value   = cloudflare_worker_script.shadow_atlas_api.name
  type    = "CNAME"
  proxied = true
  ttl     = 1

  comment = "Shadow Atlas staging API endpoint"
}

# TXT record for SPF (email verification, optional)
resource "cloudflare_record" "spf" {
  count = var.environment == "production" ? 1 : 0

  zone_id = data.cloudflare_zone.main.id
  name    = "@"
  value   = "v=spf1 include:_spf.cloudflare.com ~all"
  type    = "TXT"
  ttl     = 3600

  comment = "SPF record for email verification"
}

# CAA records for certificate authority authorization
resource "cloudflare_record" "caa" {
  count = var.environment == "production" ? 1 : 0

  zone_id = data.cloudflare_zone.main.id
  name    = "@"
  type    = "CAA"
  ttl     = 3600

  data {
    flags = "0"
    tag   = "issue"
    value = "letsencrypt.org"
  }

  comment = "CAA record restricting certificate issuance to Let's Encrypt"
}
