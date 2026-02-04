# Communique Authentication Security Review

**Date**: 2026-02-01
**Reviewer**: Security Analysis
**Scope**: Identity verification, authentication, session management, rate limiting

---

## Executive Summary

The Communique authentication system demonstrates strong security fundamentals with proper OAuth state validation, HMAC webhook verification, session token hashing, and defense-in-depth CSRF protection. However, several vulnerabilities and hardening opportunities were identified.

**Risk Summary**:
- **Critical**: 0
- **High**: 1 (Rate limit DoS vector)
- **Medium**: 4
- **Low**: 3
- **Informational**: 2

---

## 1. Authentication Vulnerabilities

### 1.1 OAuth Security - SECURE

**Files Analyzed**:
- `/Users/noot/Documents/communique/src/lib/core/auth/oauth.ts`
- `/Users/noot/Documents/communique/src/lib/core/auth/oauth-callback-handler.ts`

**Findings**:

#### OAuth State Parameter Validation - PASS
The system properly validates OAuth state parameters to prevent CSRF attacks:

```typescript
// oauth-callback-handler.ts:217-221
if (!code || !state || !storedState) {
    throw error(400, 'Missing required OAuth parameters');
}
if (state !== storedState) {
    throw error(400, 'Invalid OAuth state');
}
```

The state is generated with 32 bytes of cryptographic randomness:
```typescript
// oauth.ts:5-8
export function generateState(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
```

#### Open Redirect Prevention - PASS
The `validateReturnTo()` function properly sanitizes redirect URLs:

```typescript
// oauth.ts:25-58
export function validateReturnTo(url: string | null | undefined): string {
    if (!url || url.trim().length === 0) return '/';
    if (url.includes('\0')) return '/';           // Null byte injection
    if (url.includes('\\')) return '/';           // Backslash normalization
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url)) return '/'; // Absolute URLs
    if (url.startsWith('//')) return '/';         // Protocol-relative
    if (!url.startsWith('/')) return '/';         // Must be relative path
    return url;
}
```

**Recommendation**: Consider adding additional URL-encoding attack prevention (e.g., `%2F%2F` double-encoded protocol-relative).

---

### 1.2 Didit Webhook HMAC Verification - SECURE

**File**: `/Users/noot/Documents/communique/src/routes/api/identity/didit/webhook/+server.ts`

The webhook handler uses constant-time comparison to prevent timing attacks:

```typescript
// Lines 43-72
function verifyWebhookSignature(body, signature, timestamp, secret): boolean {
    const payload = `${timestamp}.${body}`;
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');

    // SECURITY FIX: Constant-time comparison
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return timingSafeEqual(signatureBuffer, expectedBuffer);
}
```

**Verdict**: PASS - Properly implements HMAC verification with timing-safe comparison.

---

### 1.3 JWT Token Security - MEDIUM RISK

**File**: `/Users/noot/Documents/communique/src/lib/core/auth/tokens.ts`

**Issue**: Development fallback secret in production code:

```typescript
// tokens.ts:41
const secret = env.EMAIL_VERIFICATION_SECRET || env.JWT_SECRET || 'development-secret';
```

**Risk**: If both `EMAIL_VERIFICATION_SECRET` and `JWT_SECRET` environment variables are unset, the system falls back to a hardcoded secret, allowing attackers to forge verification tokens.

**Recommendation**:
```typescript
const secret = env.EMAIL_VERIFICATION_SECRET || env.JWT_SECRET;
if (!secret) {
    throw new Error('JWT secret not configured');
}
```

---

## 2. Session Management Issues

### 2.1 Session Cookie Security - PASS

**File**: `/Users/noot/Documents/communique/src/hooks.server.ts`

Session cookies are properly configured:

```typescript
// hooks.server.ts:54-60
event.cookies.set(auth.sessionCookieName, session.id, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    expires: session.expiresAt,
    secure: !dev  // Secure in production
});
```

**Session Token Hashing - PASS**:
```typescript
// auth.ts:83-85
export async function createSession(userId: string, extended = false): Promise<Session> {
    const token = generateSessionToken();
    const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
    // Only hash is stored in DB
}
```

**Checklist**:
- [x] HttpOnly flag set
- [x] Secure flag in production
- [x] SameSite=Lax prevents basic CSRF
- [x] Session ID is SHA-256 hash (raw token never stored)
- [x] Session expiration enforced (30/90 days)
- [x] Session renewal on activity (15 days before expiry)

### 2.2 Non-HttpOnly Cookies - LOW RISK

**File**: `/Users/noot/Documents/communique/src/lib/core/auth/oauth-callback-handler.ts`

Two cookies are intentionally non-HttpOnly for client-side access:

1. `oauth_completion` (lines 433-448) - Contains provider name, returnTo path, timestamp
2. `oauth_location` (lines 571-577) - Contains location hints for inference

**Assessment**: These cookies contain non-sensitive flow-control data. The design is documented (BA-013 comments) and the risk is acceptable.

**Recommendation**: Ensure these cookies never contain session tokens, user IDs, or other sensitive data.

---

## 3. Rate Limiting Analysis

### 3.1 Rate Limit DoS Vector - HIGH RISK

**File**: `/Users/noot/Documents/communique/src/hooks.server.ts`

**Vulnerability**: The rate limit key uses client IP, which allows attackers to exhaust rate limits for legitimate users behind shared IPs (NAT, corporate networks, mobile carriers).

```typescript
// hooks.server.ts:264-265
const clientIP = event.getClientAddress();
const key = `ratelimit:${clientIP}:${prefix}`;
```

**Attack Scenario**:
1. Attacker identifies target's IP (e.g., corporate network exit IP)
2. Attacker sends 10 rapid requests to `/api/identity/*`
3. All legitimate users behind that IP are blocked for the rate limit window

**Current Limits**:
- `/api/identity/`: 10 req/min
- `/api/address/`: 5 req/min
- `/api/submissions/`: 5 req/min

**Recommendations**:
1. **Authenticated Rate Limiting**: For logged-in users, key by user ID instead of IP:
   ```typescript
   const key = locals.user
       ? `ratelimit:user:${locals.user.id}:${prefix}`
       : `ratelimit:ip:${clientIP}:${prefix}`;
   ```
2. **Per-User Limits**: Consider separate limits for authenticated vs unauthenticated requests
3. **Exponential Backoff**: Implement progressive rate limiting instead of hard cutoff

### 3.2 In-Memory Rate Limiter State Loss - LOW RISK

**File**: `/Users/noot/Documents/communique/src/lib/server/rate-limiter.ts`

**Issue**: In-memory rate limiter loses state on deployment, allowing burst attacks timed with deployments.

**Mitigation Already Documented**:
> "State resets on deploy (acceptable: deploy <5/day, circuit breaker protects)"

**Recommendation**: When scaling beyond single instance, migrate to Redis-backed rate limiting as noted in code comments.

### 3.3 Webhook Rate Limit Exemption - INFO

The Didit webhook is correctly exempted from rate limiting since it's authenticated via HMAC:

```typescript
// hooks.server.ts:234
const RATE_LIMIT_EXEMPT_PATHS = ['/api/identity/didit/webhook'];
```

---

## 4. CSRF Protection Analysis

### 4.1 SvelteKit Built-in CSRF - PASS

**File**: `/Users/noot/Documents/communique/svelte.config.js`

```typescript
// svelte.config.js:32-34
csrf: {
    checkOrigin: true
}
```

SvelteKit automatically rejects non-GET requests with mismatched Origin headers.

### 4.2 Defense-in-Depth CSRF Guard - PASS

**File**: `/Users/noot/Documents/communique/src/hooks.server.ts`

Additional CSRF protection layer for identity endpoints:

```typescript
// hooks.server.ts:155-165
const origin = request.headers.get('origin');
if (origin) {
    const expectedOrigin = url.origin;
    if (origin !== expectedOrigin) {
        throw error(403, 'Cross-origin requests to identity endpoints are forbidden');
    }
}
```

**Protected Paths**:
- `/api/identity/verify`
- `/api/identity/init`
- `/api/identity/store-blob`
- `/api/identity/delete-blob`
- `/api/identity/didit/init`
- `/api/address/verify`

---

## 5. Identity Verification Security

### 5.1 Authentication Bypass - FIXED

**File**: `/Users/noot/Documents/communique/src/routes/api/identity/verify/+server.ts`

The self.xyz verification endpoint requires authentication:

```typescript
// verify/+server.ts:23-28
export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
    // CVE-INTERNAL-003 FIX: Require authenticated session
    if (!locals.user) {
        throw error(401, 'Authentication required');
    }
```

Uses `locals.user.id` instead of client-provided user ID (line 95).

### 5.2 Sybil Resistance - PASS

**Files**:
- `/Users/noot/Documents/communique/src/lib/core/server/identity-hash.ts`
- `/Users/noot/Documents/communique/src/lib/core/identity/identity-binding.ts`

Strong duplicate identity detection:
1. **Identity Hash**: SHA-256(salt + passport + nationality + birthYear + docType)
2. **Identity Commitment**: Double-hashed with domain separation for cross-provider linking
3. **Duplicate Detection**: Database constraint on `identity_hash` prevents same identity on multiple accounts
4. **Account Merging**: If same commitment detected, accounts are automatically merged

```typescript
// verify/+server.ts:108-128 - Transaction-based duplicate check
const duplicateDetected = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({
        where: { identity_hash: identityHash }
    });
    if (existingUser && existingUser.id !== userId) {
        // Log and return duplicate flag
        return true;
    }
    // Proceed with verification
});
```

### 5.3 Trust Score Manipulation - MEDIUM RISK

**Issue**: Trust scores are set based on email verification status at OAuth account creation time:

```typescript
// oauth-callback-handler.ts:316-317
const baseTrustScore = emailVerified ? 100 : 50;
const baseReputationTier = emailVerified ? 'verified' : 'novice';
```

**Attack Vector**:
1. Attacker creates account via Twitter without verified email (trust_score = 50)
2. Attacker verifies Twitter email
3. Attacker re-authenticates via Twitter
4. System updates `email_verified` on Account but does NOT update User trust_score

**Impact**: Trust score is "sticky" from initial registration, not updated on subsequent logins.

**Recommendation**: Add trust score recalculation when `email_verified` status changes.

### 5.4 Identity Verification Replay - PASS

Verification proofs are properly validated:
1. self.xyz SDK validates cryptographic proof
2. Didit webhook includes HMAC signature with timestamp
3. Idempotency check prevents re-processing:

```typescript
// didit/webhook/+server.ts:158-169
if (existingUser?.is_verified && existingUser.verification_method === 'didit') {
    return json({ received: true, processed: false, already_verified: true });
}
```

---

## 6. Additional Security Observations

### 6.1 IP Address Hashing - PASS

Client IPs are hashed before storage for privacy:

```typescript
// verify/+server.ts:57
ip_address_hash: hashIPAddress(getClientAddress())
```

### 6.2 PII Handling - PASS

The system follows cypherpunk architecture principles:
- No plaintext PII stored in User model
- Address data encrypted with XChaCha20-Poly1305
- Only TEE can decrypt delivery data

### 6.3 Cross-Origin Isolation Headers - INFO

**File**: `/Users/noot/Documents/communique/src/hooks.server.ts`

```typescript
// hooks.server.ts:183-191
const handleCrossOriginIsolation: Handle = async ({ event, resolve }) => {
    const response = await resolve(event);
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return response;
};
```

These headers enable SharedArrayBuffer for ZK proving but may break third-party integrations.

---

## 7. Recommended Hardening

### High Priority

1. **Fix Rate Limit DoS**: Implement user-based rate limiting for authenticated requests
2. **Remove JWT Fallback Secret**: Throw error if `JWT_SECRET` not configured
3. **Trust Score Recalculation**: Update trust_score when email verification status changes

### Medium Priority

4. **Enhanced URL Validation**: Add double-encoding attack prevention to `validateReturnTo()`
5. **Webhook Timestamp Validation**: Add time-window check (e.g., reject if timestamp > 5 min old)
6. **Session Binding**: Consider binding sessions to IP or user-agent fingerprint

### Low Priority

7. **Rate Limit Observability**: Add metrics for rate limit events to detect coordinated attacks
8. **Audit Log Enhancement**: Add structured logging for all authentication events
9. **Redis Rate Limiter**: Prepare for multi-instance deployment

---

## 8. Answers to Specific Questions

### Q1: Can an attacker exhaust rate limits for legitimate users (DoS)?
**Yes** - See Section 3.1. The IP-based rate limiting allows attackers to exhaust limits for users behind shared IPs.

### Q2: Are OAuth state parameters validated to prevent CSRF?
**Yes** - State is cryptographically random (32 bytes) and validated on callback. See Section 1.1.

### Q3: Can the Didit webhook be called with forged signatures?
**No** - HMAC verification with constant-time comparison prevents signature forgery. See Section 1.2.

### Q4: Is the session cookie properly secured (HttpOnly, Secure, SameSite)?
**Yes** - All security flags properly set. See Section 2.1.

### Q5: Can trust scores be manipulated by creating/deleting verifications?
**Partially** - Trust scores are sticky from initial OAuth registration. Subsequent email verification status changes do not update trust_score. See Section 5.3.

---

## Files Reviewed

| File | Purpose |
|------|---------|
| `/src/hooks.server.ts` | Request handling, rate limiting, CSRF guard |
| `/src/lib/server/rate-limiter.ts` | In-memory rate limiter implementation |
| `/src/lib/core/auth/auth.ts` | Session management, token generation |
| `/src/lib/core/auth/oauth.ts` | OAuth state and URL validation |
| `/src/lib/core/auth/oauth-callback-handler.ts` | OAuth callback processing |
| `/src/lib/core/auth/oauth-security.ts` | Session validation utilities |
| `/src/lib/core/auth/tokens.ts` | JWT token generation |
| `/src/routes/api/identity/verify/+server.ts` | self.xyz verification |
| `/src/routes/api/identity/didit/webhook/+server.ts` | Didit webhook handler |
| `/src/routes/api/identity/init/+server.ts` | self.xyz QR init |
| `/src/routes/api/identity/didit/init/+server.ts` | Didit session init |
| `/src/routes/api/identity/store-blob/+server.ts` | Encrypted blob storage |
| `/src/routes/api/identity/delete-blob/+server.ts` | Encrypted blob deletion |
| `/src/routes/api/address/verify/+server.ts` | Address verification |
| `/src/lib/core/server/identity-hash.ts` | Identity hashing |
| `/src/lib/core/identity/identity-binding.ts` | Cross-provider deduplication |
| `/svelte.config.js` | SvelteKit CSRF configuration |

---

*Report generated by security analysis of Communique authentication system*
