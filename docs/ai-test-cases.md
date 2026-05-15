# AI Smart Food Request Assistant — Test Cases

These test cases cover the `POST /api/ai/parse-request` endpoint and the `/client/ai-request` UI flow.

**Prerequisites:** Log in as `maria_client` / `clientpass123` and use the JWT token for Postman tests, or test via browser at `/client/ai-request`.

---

## 1. Clear description, high confidence

**Input:**
```
I have 4 kids ages 3 to 10 and my husband and I. We're vegetarian and one of my kids has a peanut allergy.
```

**Expected behavior:**
- `householdSize`: 6 (4 kids + husband + speaker)
- `dietaryNeeds`: includes "vegetarian" and "peanut allergy"
- `confidence`: "high"
- `warnings`: empty or none
- `clientNotes`: empty or minimal
- `staffNotes`: mentions household of 6 (2 adults, 4 children), vegetarian accommodation, peanut allergy precaution — no priority flags

**How to verify:**
- POST to `/api/ai/parse-request` with `{ "description": "..." }`
- Check `parsed.householdSize === 6`
- Check `parsed.dietaryNeeds` contains "vegetarian" and "peanut allergy" (or equivalent)
- Check `parsed.confidence === "high"`
- Check `parsed.warnings` is empty array
- Check `parsed.staffNotes` is a professional summary mentioning the household composition and dietary accommodations
- Check `parsed.clientNotes` is empty or minimal

---

## 2. Vague description, low confidence

**Input:**
```
We need food please my family is hungry
```

**Expected behavior:**
- `householdSize`: 1 (default, since size is unclear)
- `confidence`: "low"
- `warnings`: includes a message about unclear household size
- `staffNotes`: notes that household size is unclear and should be confirmed in person

**How to verify:**
- POST to `/api/ai/parse-request`
- Check `parsed.householdSize === 1`
- Check `parsed.confidence === "low"`
- Check `parsed.warnings` contains a warning about household size being unclear or defaulted
- Check `parsed.staffNotes` mentions confirming household size

---

## 3. Non-food request flagged

**Input:**
```
I have 3 kids and we need diapers, baby formula, and clothes for winter
```

**Expected behavior:**
- `householdSize`: 4 (3 kids + speaker)
- `confidence`: "medium" or "high"
- `warnings`: flags diapers and clothes as non-food items
- Baby formula should NOT be flagged (it is a food item)
- `staffNotes`: includes "Referral needed:" for diapers and/or clothes, mentions partner agency for non-food supplies

**How to verify:**
- POST to `/api/ai/parse-request`
- Check `parsed.householdSize === 4`
- Check `parsed.warnings` mentions diapers and/or clothes as non-food items
- Verify baby formula is not flagged as non-food
- Check `parsed.staffNotes` contains referral language for non-food items

---

## 4. Crisis language flagged

**Input:**
```
Please help me my kids haven't eaten in 3 days I'm desperate
```

**Expected behavior:**
- `warnings`: includes a warning flagging urgent/crisis language for staff review
- `confidence`: "low" or "medium"
- `householdSize`: 1 (default) or inferred from "kids"
- `staffNotes`: starts with or includes "PRIORITY:" flag, recommends connecting with crisis services

**How to verify:**
- POST to `/api/ai/parse-request`
- Check `parsed.warnings` contains a warning about crisis/urgent language
- Confirm `parsed.staffNotes` includes priority flag and crisis services recommendation
- Confirm warnings suggest staff should prioritize or follow up

---

## 5. Multi-language handled (Chinese)

**Input:**
```
我有三个孩子和一个丈夫。我们都是素食主义者。
```
(Translation: "I have 3 kids and my husband. We're vegetarian.")

**Expected behavior:**
- `householdSize`: 5 (3 kids + husband + speaker)
- `dietaryNeeds`: includes "vegetarian"
- `confidence`: "medium" (some ambiguity due to language)
- `warnings`: may include a note about non-English input
- `staffNotes`: starts with "Client communicates in Chinese." or similar language note

**How to verify:**
- POST to `/api/ai/parse-request`
- Check `parsed.householdSize === 5`
- Check `parsed.dietaryNeeds` includes "vegetarian"
- Check `parsed.confidence` is "medium" or "high"
- Check `parsed.staffNotes` contains language identification note
- Optionally check warnings for language note

---

## 6. Empty/too short input — 400 error

**Input:**
```
hi
```

**Expected behavior:**
- HTTP 400 response
- Error message about minimum length (10 characters required)
- AI is never called

**How to verify:**
- POST to `/api/ai/parse-request` with `{ "description": "hi" }`
- Check response status is 400
- Check response body contains `error` field mentioning length requirement
- In browser: character counter stays grey, but client-side validation also prevents submission

---

## 7. Wall of text — 400 error

**Input:**
```
(3000+ characters of lorem ipsum or repeated text)
```

**Expected behavior:**
- HTTP 400 response
- Error message about maximum length (2000 characters)
- AI is never called

**How to verify:**
- POST to `/api/ai/parse-request` with a description exceeding 2000 characters
- Check response status is 400
- Check response body `error` mentions length limit
- In browser: character counter turns red, textarea has maxlength="2000" as additional guard

---

## 8. Returning user personalization

**Setup:**
User (`maria_client`) must have at least 1-2 previous food requests in the database with specific `householdSize` and `dietaryNeeds` values (e.g., householdSize=4, dietaryNeeds=["halal"]).

**Input:**
```
Same as usual please
```

**Expected behavior:**
- AI infers from previous request history (e.g., `householdSize`: 4, `dietaryNeeds`: ["halal"])
- `confidence`: "medium" (relying on context, not explicit description)
- `warnings`: may include a note explaining that previous request data was used
- `meta.usedPreviousRequests`: true
- `staffNotes`: references previous request patterns and notes that context was used to infer preferences

**How to verify:**
- First, create a request via `POST /api/requests` with known values (householdSize=4, dietaryNeeds=["halal"])
- Then POST to `/api/ai/parse-request` with `{ "description": "Same as usual please" }`
- Check `parsed.householdSize` matches or is close to previous requests
- Check `parsed.dietaryNeeds` includes items from previous requests
- Check `meta.usedPreviousRequests === true`
- Check `parsed.staffNotes` provides a summary based on inferred context
- If no previous requests exist, AI should default to householdSize=1 with low confidence

---

## 9. AI generates meaningful staff notes

**Input:**
```
I'm a single mom with 3 kids, my oldest has type 1 diabetes and we need to avoid sugar. We're new to this food bank.
```

**Expected behavior:**
- `householdSize`: 4 (single mom + 3 kids)
- `dietaryNeeds`: includes "diabetic" or "low sugar" or similar
- `confidence`: "high"
- `staffNotes`: mentions single-parent household of 4, diabetic dietary accommodation (low-sugar/sugar-free options), flags first-time visitor cue, may recommend diabetes-friendly food package
- `clientNotes`: may note "new to this food bank" or similar

**How to verify:**
- POST to `/api/ai/parse-request`
- Check `parsed.householdSize === 4`
- Check `parsed.staffNotes` mentions: single-parent household, diabetic/low-sugar accommodation, and first-time visitor flag
- Verify staffNotes is professional and actionable (2-5 sentences)

---

## 10. Staff notes include referral flags

**Input:**
```
I have 2 kids and we need food but also winter clothes and bus tickets
```

**Expected behavior:**
- `householdSize`: 3 (speaker + 2 kids)
- `warnings`: flags winter clothes and bus tickets as non-food items
- `staffNotes`: includes "Referral needed:" for winter clothes and transit assistance — connects to partner agencies
- `clientNotes`: may note the non-food requests

**How to verify:**
- POST to `/api/ai/parse-request`
- Check `parsed.householdSize === 3`
- Check `parsed.staffNotes` contains referral language for both winter clothes and transit/bus tickets
- Check `parsed.warnings` mentions non-food items

---

## 11. Staff notes flag priority cases

**Input:**
```
We haven't eaten in two days, my kids are crying
```

**Expected behavior:**
- `confidence`: "low" or "medium"
- `warnings`: flags crisis/urgent language
- `staffNotes`: includes "PRIORITY:" flag, recommends urgent processing and connecting with crisis services
- `householdSize`: 1 (default) or inferred from "kids"

**How to verify:**
- POST to `/api/ai/parse-request`
- Check `parsed.staffNotes` contains "PRIORITY" or equivalent urgent flag
- Check `parsed.staffNotes` recommends crisis services
- Check `parsed.warnings` flags urgent language
