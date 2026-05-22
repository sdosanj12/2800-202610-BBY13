# Inventory Decrement Test Cases

Covers the allocate + pickup flow: `PATCH /api/requests/:id/allocate` and `PATCH /api/requests/:id/pickup`.

## Prerequisites

- Admin user (e.g., Jessica) logged in with valid JWT
- Client user (e.g., Maria) logged in with valid JWT
- At least one inventory item created
- At least one food request in `approved` status

---

## Test 1: Allocate items to an approved request — success

**Steps:**
1. Login as admin (Jessica)
2. POST `/api/inventory` — create "Canned Beans", quantity: 10, category: "canned", unit: "cans"
3. Login as client (Maria), POST `/api/requests` with householdSize: 3
4. Login as admin, PATCH `/api/requests/:id/approve` with pickupDate + pickupTime
5. PATCH `/api/requests/:id/allocate` with body:
   ```json
   { "items": [{ "itemId": "<beans-id>", "quantity": 7 }] }
   ```

**Expected:**
- 200 response with `message: "Items allocated"`
- Response includes `request.itemsAllocated` array with the item populated
- Inventory quantity is still 10 (NOT decremented yet)

---

## Test 2: Allocate more than available — 400 with item name

**Steps:**
1. Inventory item "Rice Bags" exists with quantity: 3
2. Request is in `approved` status
3. PATCH `/api/requests/:id/allocate` with body:
   ```json
   { "items": [{ "itemId": "<rice-id>", "quantity": 5 }] }
   ```

**Expected:**
- 400 response
- Error message includes the item name: `"Insufficient quantity for 'Rice Bags'. Available: 3, requested: 5"`

---

## Test 3: Allocate to pending/denied request — 400

**Steps:**
1. Create a food request (status defaults to `pending`)
2. PATCH `/api/requests/:id/allocate` with any valid items

**Expected:**
- 400 response
- Error message: `"Cannot allocate items to a request with status 'pending'. Request must be approved."`

**Repeat with:**
- A `denied` request — same 400 expected
- A `picked-up` request — same 400 expected
- A `cancelled` request — same 400 expected

---

## Test 4: Pickup with no allocated items — 400

**Steps:**
1. Approve a request (PATCH `/api/requests/:id/approve`)
2. Do NOT allocate any items
3. PATCH `/api/requests/:id/pickup`

**Expected:**
- 400 response
- Error message: `"Allocate items before confirming pickup."`

---

## Test 5: Pickup decrements inventory, fires low-stock notification when crossing threshold

**Steps:**
1. POST `/api/inventory` — create "Pasta Boxes", quantity: 8, category: "dry", unit: "boxes"
2. Create and approve a food request
3. PATCH `/api/requests/:id/allocate` with `{ "items": [{ "itemId": "<pasta-id>", "quantity": 5 }] }`
4. PATCH `/api/requests/:id/pickup`
5. GET `/api/inventory` — check "Pasta Boxes"
6. Login as admin, GET `/api/notifications`

**Expected:**
- Pickup returns 200 with `message: "Pickup confirmed"`
- Request status is now `picked-up`
- "Pasta Boxes" quantity is now 3 (8 - 5)
- "Pasta Boxes" status is `low-stock` (quantity < 5)
- Admin notifications include a `low-stock` notification: `"Pasta Boxes is running low (3 boxes remaining)."`
- Client (Maria) notifications include a `pickup-confirmed` notification: `"Your food request pickup has been confirmed. Thank you!"`

---

## Test 6: Pickup decrements inventory to 0, fires out-of-stock notification + status updates

**Steps:**
1. POST `/api/inventory` — create "Baby Formula", quantity: 2, category: "baby", unit: "units"
2. Create and approve a food request
3. PATCH `/api/requests/:id/allocate` with `{ "items": [{ "itemId": "<formula-id>", "quantity": 2 }] }`
4. PATCH `/api/requests/:id/pickup`
5. GET `/api/inventory` — check "Baby Formula"
6. Login as admin, GET `/api/notifications`

**Expected:**
- Pickup returns 200 with `message: "Pickup confirmed"`
- "Baby Formula" quantity is now 0
- "Baby Formula" status is `out-of-stock`
- Admin notifications include a `low-stock` type notification: `"Baby Formula is out of stock (0 units remaining)."`
- Client receives `pickup-confirmed` notification

---

## Postman End-to-End Verification

1. Login as Jessica (admin) — POST `/api/auth/login`
2. POST `/api/inventory` — create "Canned Beans" quantity 10, category "canned", unit "cans"
3. Login as Maria (client) — POST `/api/auth/login`, then POST `/api/requests` with householdSize: 3
4. Login as Jessica, PATCH `/api/requests/:id/approve` with pickupDate + pickupTime
5. PATCH `/api/requests/:id/allocate` with `{ "items": [{ "itemId": "<beans-id>", "quantity": 7 }] }`
6. GET `/api/inventory?includeAllocated=true` — beans should show quantity: 10, allocatedQuantity: 7
7. PATCH `/api/requests/:id/pickup`
8. GET `/api/inventory` — beans quantity: 3, status: "low-stock"
9. GET `/api/notifications` (as Jessica) — should see low-stock alert for Canned Beans
10. Login as Maria, GET `/api/notifications` — should see pickup-confirmed notification
