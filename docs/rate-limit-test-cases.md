# Rate Limiting & Security Headers — Test Cases

## 1. Auth rate limiting (login)

| # | Steps | Expected |
|---|-------|----------|
| 1 | POST `/login` with wrong password 5 times in a row | All 5 return 401 (invalid credentials) |
| 2 | POST `/login` a 6th time within 15 minutes | Returns **429** with `{ "error": "Too many login attempts. Please try again in 15 minutes." }` |
| 3 | Wait 15 minutes, then POST `/login` with correct password | Returns 200 / redirect — rate limit window has reset |

Same behaviour applies to `/api/auth/login` and `/submitUser`.

## 2. AI endpoint rate limiting

| # | Steps | Expected |
|---|-------|----------|
| 1 | As a logged-in client, POST `/api/ai/parse-request` 10 times | All 10 return a normal AI response |
| 2 | POST an 11th request within the same hour | Returns **429** with `{ "error": "AI assistant temporarily unavailable due to high usage. Please try again later or fill out the form manually." }` |
| 3 | Wait 1 hour (or restart the server to reset the in-memory store) | AI endpoint accepts requests again |

Rate limit key is the authenticated `userId` when logged in, falling back to IP.

## 3. Helmet security headers

Verify with:

```bash
curl -I http://localhost:3000/
```

| Header | Expected value |
|--------|---------------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-DNS-Prefetch-Control` | `off` |
| `Strict-Transport-Security` | present (max-age) |
| `X-Download-Options` | `noopen` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `Content-Security-Policy` | **not present** (disabled for Tailwind CDN / inline scripts) |

## 4. Non-rate-limited endpoints (sanity check)

| Endpoint | Should NOT be rate-limited |
|----------|---------------------------|
| `GET /api/requests/me` | UI polls this — must stay open |
| `GET /api/notifications/*` | UI polls this — must stay open |
| `GET /dashboard` | Page loads should not be throttled |
