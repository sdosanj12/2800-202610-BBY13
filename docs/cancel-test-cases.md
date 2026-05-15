# Client Request Cancellation — Test Cases (Postman)

## Prerequisites
- Seed users: Jessica (admin), Maria (client), Bob (client)
- Maria has at least one pending FoodRequest
- Maria has at least one approved FoodRequest (approve via admin first)

---

## Test 1: Client cancels own pending request → 200

1. **Login as Maria (client)**
   - `POST /api/auth/login` with Maria's credentials
   - Save the token

2. **Create a pending request** (if needed)
   - `POST /api/requests` with valid body
   - Save the returned `_id`

3. **Cancel the pending request**
   - `PATCH /api/requests/:id/cancel`
   - No body required
   - Expected: 200, `request.status` = `"cancelled"`

4. **Verify response**
   - Response contains `{ "message": "Request cancelled", "request": { ... } }`
   - `request.status` is `"cancelled"`

---

## Test 2: Client tries to cancel another user's request → 403

1. **Login as Maria (client)**
   - `POST /api/auth/login` with Maria's credentials

2. **Login as Bob (client)** in a separate tab/session
   - `POST /api/auth/login` with Bob's credentials
   - Create a pending request as Bob, save the `_id`

3. **As Maria, try to cancel Bob's request**
   - `PATCH /api/requests/:bobRequestId/cancel`
   - Expected: 403, `{ "error": "You can only cancel your own requests" }`

---

## Test 3: Client tries to cancel already-approved request → 400

1. **Login as Maria (client)**
   - `POST /api/auth/login` with Maria's credentials

2. **Attempt to cancel the approved request**
   - `PATCH /api/requests/:approvedId/cancel`
   - Expected: 400, `{ "error": "Cannot cancel a request with status 'approved'. Only pending requests can be cancelled." }`

---

## Test 4: Client tries to cancel non-existent request → 404

1. **Login as Maria (client)**
   - `POST /api/auth/login` with Maria's credentials

2. **Cancel with a valid but non-existent ObjectId**
   - `PATCH /api/requests/aaaaaaaaaaaaaaaaaaaaaaaa/cancel`
   - Expected: 404, `{ "error": "Request not found" }`

---

## Test 5: Cancelled request appears in GET /api/requests/me

1. **Login as Maria (client)**
   - `POST /api/auth/login` with Maria's credentials

2. **Fetch request history**
   - `GET /api/requests/me`
   - Expected: 200, `requests` array includes the cancelled request with `status: "cancelled"`
   - Results sorted by `createdAt` descending
