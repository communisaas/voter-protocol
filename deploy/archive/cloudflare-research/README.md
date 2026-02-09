# Cloudflare Workers Research Archive

This directory contains research documentation from a **Cloudflare Workers + R2 + KV** deployment evaluation that was conducted but never implemented.

## What's Here

- **DEPLOYMENT_CHECKLIST.md** - Cloudflare deployment verification checklist
- **DEPLOYMENT_GUIDE.md** - Cloudflare Workers deployment procedures
- **INFRASTRUCTURE_SPEC.md** - Edge deployment architecture specification

## Why Archive?

These documents describe a planned Phase 2 edge deployment architecture that was researched as an alternative to the current infrastructure. The evaluation concluded that:

1. The complexity of migrating to edge infrastructure outweighed the benefits
2. The current Kubernetes + Docker approach provides sufficient performance and flexibility
3. Edge deployment may be reconsidered in future phases if global distribution becomes critical

## Actual Infrastructure

Shadow Atlas is deployed using **Kubernetes + Docker**. See the main `deploy/README.md` and `deploy/kubernetes/` directory for current deployment documentation.

## Historical Context

**Created**: December 2025
**Status**: Research only - never deployed to production
**Reason**: Kubernetes chosen for better observability and operational simplicity
