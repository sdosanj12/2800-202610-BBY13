# AI Prompt Development — Iteration Log

## Goal

Extract structured food request data from a client's natural-language description of their household. The AI must return:
- **householdSize** (integer) — total people in the household
- **dietaryNeeds** (array) — specific dietary restrictions or allergies
- **clientNotes** (string) — client's own words/context for staff (formerly `notes`)
- **staffNotes** (string) — AI-generated professional intake summary for staff
- **confidence** (enum) — how certain the AI is about the parse
- **warnings** (array) — flags for staff attention (crisis language, non-food items, etc.)

---

## Initial Prompt (v1)

```
Parse this food bank request into JSON with householdSize, dietaryNeeds, and notes fields.
```

### Problems Observed
- AI wrapped output in markdown code fences (```json ... ```), breaking JSON.parse()
- AI hallucinated details not in the description (e.g., assumed ages, added dietary needs)
- No confidence indicator — staff couldn't tell if the parse was reliable
- No warning system — crisis language and non-food requests passed through silently
- AI sometimes returned extra fields not in our schema
- Vague descriptions produced wildly inconsistent householdSize guesses

---

## Revised Prompt (v2)

```
You are a food bank intake assistant. Parse the client's description into JSON.
Return ONLY valid JSON with these fields: householdSize (integer), dietaryNeeds (array of strings), notes (string).
Do not add markdown formatting. Do not invent details.
```

### Problems Observed
- Markdown fences still appeared intermittently
- Still no confidence or warnings — couldn't flag vague inputs or crisis situations
- "Do not invent details" helped but AI still sometimes inferred too aggressively
- No handling for non-English input
- householdSize defaulting behavior was inconsistent (sometimes 0, sometimes omitted)

---

## Final Prompt (v3 — Production)

```
You are a food bank intake assistant. Your job is to parse a client's natural-language description of their household into structured data for a food request.

Rules:
- Output ONLY valid JSON matching this exact schema: { "householdSize": integer 1-20, "dietaryNeeds": array of strings, "notes": string, "confidence": "high"|"medium"|"low", "warnings": array of strings }
- Do NOT output any markdown, prose, or explanation — ONLY the JSON object.
- householdSize: count every person in the household including the speaker. If unclear, default to 1 and add a warning "Household size unclear, defaulted to 1".
- dietaryNeeds: specific, lowercase, short phrases like "diabetic", "halal", "no pork", "gluten-free", "peanut allergy", "vegetarian". Maximum 10 items, each max 50 characters.
- notes: only context that staff needs to know that is NOT already captured in householdSize or dietaryNeeds. Do not repeat household size or dietary info here. Max 500 characters. Leave empty string if nothing relevant.
- confidence: set to "high" if the description is clear and specific. Set to "medium" if some ambiguity exists but a reasonable interpretation is possible. Set to "low" if the description is vague, very short, or largely ambiguous.
- warnings: add warnings for any of: medical claims that need staff attention, requests for non-food items (diapers, clothes, etc — note that baby formula IS food), urgent/crisis language suggesting immediate danger, anything outside normal food bank scope. Each warning should be a short, clear sentence.
- NEVER invent details not present in or clearly implied by the description.
- If the description is in a language other than English, do your best to parse it and add a warning noting the language.
```

---

## What Changed and Why

- **Added JSON-only rule with explicit schema**: Eliminated markdown fences and extra fields. Telling the AI the exact shape of the output removed ambiguity.
- **Added confidence field**: Lets the frontend display a color-coded badge (green/yellow/red) so users know when to double-check the AI's work. Low confidence signals vague input.
- **Added warnings array**: Critical for flagging crisis language (so staff can prioritize), non-food items (so clients know what's in scope), and medical claims (liability protection).
- **Explicit householdSize default**: "If unclear, default to 1 and add a warning" — prevents the AI from guessing wildly on vague descriptions. The user can always edit the number.
- **dietaryNeeds formatting rules**: "specific, lowercase, short phrases" with examples — produces consistent, clean data instead of free-form sentences.
- **Notes scoping rule**: "Do not repeat household size or dietary info" — prevents redundant data that clutters the staff view.
- **Anti-hallucination rule**: "NEVER invent details" — prevents the AI from adding dietary needs or household members not mentioned.
- **Multi-language handling**: "Do your best to parse it and add a warning" — accommodates non-English speakers (key for food bank accessibility) while flagging potential translation issues.
- **Baby formula exception**: Explicitly noted as food to prevent false warnings on a common food bank item.
- **Added `responseMimeType: 'application/json'`** in Gemini config to force JSON output at the API level, with markdown fence stripping as a fallback safety net.
- **Joi validation as a guardrail**: Even if the AI returns valid JSON, we validate it against a strict Joi schema server-side. This catches any schema drift, out-of-range values, or unexpected field types.

---

## How AI Was Used in Development

This feature was developed iteratively using Claude Code as a pair-programming assistant. The process involved:

1. Starting with a minimal prompt and testing it against various input descriptions
2. Identifying failure modes (markdown fences, hallucinated details, missing confidence signals)
3. Refining the prompt with explicit rules for each failure mode
4. Adding a Joi validation layer as a server-side guardrail independent of the prompt
5. Testing edge cases (vague input, non-English, crisis language, non-food requests) and adjusting prompt rules to handle them
6. Using Claude Code to generate the endpoint, frontend, and documentation while reviewing each piece for correctness and alignment with the existing codebase patterns

The AI was a development tool, not a replacement for human review. Every AI-generated output goes through Joi validation server-side, and the user always reviews and edits the parsed data before submitting.

---

## Staff Intake Notes Prompt (v4)

Split the single `notes` field into two distinct concepts:

```
- clientNotes: things the client explicitly said that staff should know, NOT repeating householdSize or dietaryNeeds. Max 500 characters.

STAFF NOTES (intake summary): You are also acting as an experienced intake coordinator. Write "staffNotes" as a brief, professional summary that helps staff prepare for this client. Include:
1. One-line summary of household composition and key dietary considerations
2. Any priority flags (urgent need, first-time visitor cues, mentions of food insecurity duration)
3. Operational considerations (cultural/religious dietary requirements, medical conditions affecting food choices, accessibility needs, language)
4. Non-food asks the client mentioned that staff should address through referrals (note these as "Referral needed: ...")
5. Anything ambiguous staff should clarify in person
Format as 2-5 short sentences or bullet points. Be neutral and professional.
If the input language is not English, note that at the start: "Client communicates in [language]."
Max 1000 characters for staffNotes.
```

Three few-shot examples were added to the prompt to demonstrate expected output quality.

### What Changed and Why

- **`notes` split into `clientNotes` + `staffNotes`**: The single `notes` field mixed client voice with AI interpretation. Splitting them gives staff a structured, actionable intake summary (`staffNotes`) while preserving the client's own words separately (`clientNotes`).
- **Intake coordinator persona**: Adding "you are also acting as an experienced intake coordinator" improved output quality — the AI generates summaries that read like a real intake form rather than a generic description.
- **Priority flags**: Instructions to flag urgent/crisis cases with "PRIORITY:" at the start of staffNotes so staff can triage at a glance.
- **Referral flags**: "Referral needed: ..." pattern for non-food requests gives staff clear actionable items instead of vague warnings.
- **Language identification**: "Client communicates in [language]" at the start of staffNotes helps staff prepare for language accommodation.
- **Few-shot examples**: Three examples (family with pork restriction, crisis case, Spanish-speaking client with non-food request) dramatically improved consistency and formatting.
- **Max length increase**: `staffNotes` allows 1000 characters (vs 500 for `clientNotes`) since the intake summary needs more space for structured content.
- **Backward compatibility**: The `POST /api/requests` endpoint still accepts the legacy `notes` field and maps it to `clientNotes`, so existing API consumers are not broken.
