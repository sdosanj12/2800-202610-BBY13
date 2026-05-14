# Notifications API — Test Cases (Postman)

## Prerequisites
- Seed users: Jessica (admin), Maria (client)
- Maria has at least one pending FoodRequest
- An inventory item with quantity >= 5 (in-stock)

---

## Test 1: Approval triggers notification

1. **Login as Jessica (admin)**
   - `POST /api/auth/login` with Jessica's credentials
   - Save the token

2. **Approve Maria's pending request**
   - `PATCH /api/requests/:id/approve`
   - Body: `{ "pickupDate": "<future date>", "pickupTime": "10:00" }`
   - Expected: 200, request status = "approved"

3. **Login as Maria (client)**
   - `POST /api/auth/login` with Maria's credentials

4. **Fetch notifications**
   - `GET /api/notifications`
   - Expected: 200, `notifications` array contains one item with `type: "request-approved"`, `unreadCount: 1`

5. **Check unread count**
   - `GET /api/notifications/unread-count`
   - Expected: 200, `{ count: 1 }`

6. **Mark notification as read**
   - `PATCH /api/notifications/:notifId/read`
   - Expected: 200, `notification.read === true`

7. **Verify unread count is now 0**
   - `GET /api/notifications/unread-count`
   - Expected: 200, `{ count: 0 }`

---

## Test 2: Denial triggers notification

1. **Login as Jessica**, create or find another pending request from Maria
2. **Deny the request**
   - `PATCH /api/requests/:id/deny`
   - Body: `{ "denialReason": "Insufficient inventory" }`
   - Expected: 200

3. **Login as Maria**
4. **Fetch notifications**
   - `GET /api/notifications`
   - Expected: notification with `type: "request-denied"`, message contains "Insufficient inventory"

---

## Test 3: Low-stock triggers notification for admin

1. **Login as Jessica (admin)**
2. **Update inventory item to quantity = 3**
   - `PATCH /api/inventory/:itemId`
   - Body: `{ "quantity": 3 }`
   - Expected: 200, item status auto-set to "low-stock"

3. **Fetch Jessica's notifications**
   - `GET /api/notifications`
   - Expected: notification with `type: "low-stock"`, message contains item name and "running low"

---

## Test 4: No duplicate low-stock notification on re-edit

1. **Login as Jessica**
2. **Update the same item to quantity = 2** (already low-stock)
   - `PATCH /api/inventory/:itemId`
   - Body: `{ "quantity": 2 }`
3. **Fetch notifications**
   - Expected: still only 1 low-stock notification for that item (no new one created because status didn't transition)

---

## Test 5: Out-of-stock notification

1. **Login as Jessica**
2. **Update an in-stock item to quantity = 0**
   - `PATCH /api/inventory/:itemId`
   - Body: `{ "quantity": 0 }`
3. **Fetch notifications**
   - Expected: notification with `type: "low-stock"`, message contains "out of stock"

---

## Test 6: Read-all endpoint

1. **Login as Maria** (ensure she has multiple unread notifications from earlier tests)
2. **Mark all as read**
   - `PATCH /api/notifications/read-all`
   - Expected: 200, `{ updated: N }` where N > 0
3. **Verify**
   - `GET /api/notifications/unread-count`
   - Expected: `{ count: 0 }`

---

## Test 7: Delete notification

1. **Login as Maria**
2. **Delete a notification**
   - `DELETE /api/notifications/:notifId`
   - Expected: 204
3. **Verify it's gone**
   - `GET /api/notifications`
   - Expected: deleted notification no longer in list

---

## Test 8: Ownership check (403)

1. **Login as Jessica**
2. **Try to mark Maria's notification as read**
   - `PATCH /api/notifications/:mariaNotifId/read`
   - Expected: 403 Forbidden

3. **Try to delete Maria's notification**
   - `DELETE /api/notifications/:mariaNotifId`
   - Expected: 403 Forbidden

---

## Test 9: Query params

1. **Login as Maria**
2. **Fetch unread only**
   - `GET /api/notifications?unreadOnly=true`
   - Expected: only notifications with `read: false`

3. **Fetch with limit**
   - `GET /api/notifications?limit=1`
   - Expected: at most 1 notification returned
