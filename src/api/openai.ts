import { fetch as expoFetch } from 'expo/fetch';
import { Platform } from 'react-native';

import { buildOfficialGuidanceContextLines } from '../lib/officialGuidanceContext';
import { localizeAiResultStrings } from '../lib/localizeScanText';
import { OUTPUT_LANGUAGE_NAMES } from '../lib/i18n';
import { getFallbackAiResult } from '../lib/getFallbackAiResult';
import { mergePreferenceMatchIds } from '../lib/preferenceMatchInference';
import { normalizeCanonicalAiPayload } from '../lib/resultStyleHelpers';
import type { AiResult, IngredientsAiInput, KidsAiInput } from '../types/ai';
import type { IngredientAiPanel } from '../types/scan';
import { parseIngredientAiPanelJson } from '../lib/ingredientAiPanel';
import { applyDeterministicFormulaStageVerdictPatch } from '../lib/formulaStageRules';
import { clampFinalVerdictToBase } from '../lib/preferenceMatchers';
import {
  normalizeAiBarcodeLookupProductDetailed,
  type NormalizedProduct,
} from './openFoodFacts';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-4o-mini';
/** Model for Responses API + built-in web_search tool (barcode research step). */
const BARCODE_RESPONSES_MODEL = 'gpt-4o-mini';
const LOG_PREFIX = '[OpenAI]';
const ENGLISH_APP_LANGUAGE = 'en' as const;
const ENGLISH_APP_LOCALE = 'en-US';

const BARCODE_LOOKUP_SYSTEM_PROMPT = `Open Food Facts missed this barcode. You MUST call web_search before answering (no memory-only answers).

Return ONE tiny JSON object only—no markdown, no prose, no code fences. Prefer under ~800 characters total.

Either: {"product":null}

Or the ONLY accepted success shape (copy field names and nesting exactly):

{"product":{"barcode":"<same GTIN as input>","productName":"<short name>","brand":"<brand or null>","imageUrl":null,"ingredientsText":"<short text or null>","categories":["slug"],"allergensText":"<short text or null>","nutriments":null,"rawJson":{"source":"barcode_ai_fallback","confidence":"high","matchedSources":["https://..."]}}}

Use "confidence":"medium" when appropriate instead of "high". Never use "low" on a non-null product—return {"product":null} instead.

CRITICAL — rawJson.source (validator is strict)
- rawJson.source MUST be EXACTLY the string: barcode_ai_fallback (one literal, no spaces, no variants).
- NEVER set rawJson.source to "web", "internet", "search", "openai", "tool", or any other value. Those will fail validation.
- Web search is only how you gather evidence; it is NOT the value of source.

rawJson MUST contain ONLY these three keys: source, confidence, matchedSources. No notes, no extra keys.

SIZE RULES (long replies get cut off mid-JSON)
- Keep productName, brand, ingredientsText, categories, matchedSources very short.
- imageUrl: null unless you have a short https URL from a page you used.
- nutriments: null in almost all cases.

Never invent data. No verdicts or parenting text.`;

const SYSTEM_PROMPT = `You write the GENERAL tab of a scan result for ONE packaged food or drink for parents. The input includes childAge (whole completed years), childAgeProfile (date-of-birth–derived: ageInMonths, ageInYears, ageDisplayLabel like "8 months" or "1 year 4 months", ageBucket, isUnder24Months), and listing fields. Prefer childAgeProfile.ageDisplayLabel and month context when isUnder24Months is true—month-level differences matter for babies. The app shows ingredients separately from Open Food Facts—do not try to list every ingredient in your JSON. Output JSON ONLY. No markdown.

OUTPUT LANGUAGE (mandatory)
- The user message includes OUTPUT_LANGUAGE. Every natural-language string in the JSON (summary, reasons, nutritionSnapshot, ingredientFlags, ingredientBreakdown, allergyNotes, whyThisMatters, parentTakeaway, guidanceContext) MUST be written entirely in that language.
- Do not mix languages. In non-English outputs, translate nutrition terms (sugar, salt, sodium, saturated fat, energy, kcal, kJ, etc.) into OUTPUT_LANGUAGE.
- Keep JSON keys in English. Copy product.productName, product.brand, product.barcode verbatim from input.

CORE ORDER
1) Facts from the listing only: ingredients_text, allergens, categories, nutriments, product fields—no guessing.
2) Short, direct child-age interpretation. Not clinical. No filler.

AUTHORITATIVE VERDICTS (non-negotiable)
- baseVerdict: your product- and age-only judgment before the parent's avoid list. It MUST NOT be more lenient than ruleBasedBaseVerdict (at least that strict).
- finalVerdict: must not be more lenient than ruleBasedBaseVerdict. If avoidPreferences is empty or preferenceMatches is empty, finalVerdict should match baseVerdict unless listing facts require a stricter call. If an avoid clearly matches product text, finalVerdict may be stricter but NEVER more lenient than the rule floor.
- The app forces the user-facing verdict to "avoid" whenever preferenceMatches is non-empty; keep summary and bullets coherent with that outcome when avoids hit.
- All text fields MUST align with those verdicts.

AVOID PREFERENCES
- If avoidPreferences is missing or empty: preferenceMatches MUST be [].
- Otherwise preferenceMatches MUST be an array of strings, each string EXACTLY equal to one id from avoidPreferences in the user JSON (same snake_case token, e.g. added_sugar, soy, high_salt). Only include ids clearly supported by product text (ingredients, allergens, categories, nutriments, name). Never use prose or translated text in preferenceMatches—machine ids only.

DATA HONESTY
- Never invent grams, allergens, caffeine, or sweeteners. If a number is missing from nutriments, do not state a gram value.
- Use nutriments keys when present (sugars_100g, salt_100g, sodium_100g, saturated-fat_100g, energy-kcal_100g). Prefer salt_100g; if only sodium_100g, you may give sodium in mg per 100 g (convert from g).

AGE + PRODUCT TYPE
- Frame by the child's age using childAgeProfile (especially ageDisplayLabel, ageInMonths, isUnder24Months) plus childAge when helpful, using listing support only (categories, name, ingredients, nutriments).
- Infer product type only when supported (yogurt, dessert, snack, drink, cereal, infant/follow-on formula, growing-up milk, etc.).

FORMULA / FOLLOW-ON / STAGE MILK (critical framing — read when listing looks like infant or follow-on nutrition)
DETECT from productName, brand, categories, ingredients_text (any language) when the product reads as:
- infant formula, follow-on / continuation formula, growing-up milk, toddler milk drink, "stage" or "step" 1/2/3/4, "PRE", "HA", "Premium+ 1/2/3", "NAN", "Nutrilon", "Aptamil", "Hipp", "Friso", "Similac", "Enfamil", "SMA", "Bebelac", "Kabrita", "milk-based nutrition" for babies, folgemilch / anfangsmilch / lait infantile / fórmula infantil / детско мляко / адаптирано мляко / etc.

CLASSIFY SKU STAGE (listing only; infer conservatively from name + categories + on-pack style wording)
- Rough buckets: (A) first / starting / infant / PRE / stage 1 / 0–6 month positioning; (B) follow-on / continuation / stage 2 / "Premium+ 2" style / 6–12 month positioning; (C) growing-up / toddler / stage 3+ / 12+ month positioning. A digit in the product name often marks stage—treat as evidence, not proof, unless categories/text support it.

LACTOSE / MILK BASE (formula)
- Lactose naturally present in milk-based formula is NOT "added sugar" and must not be described as a sweetened or sugary product on that basis alone.
- Skim milk powder, whey, milk protein: expected carriers in this category—secondary context unless avoidPreferences implicate dairy/soy or the listing shows a distinct allergy story.

THREE-WAY AGE-STAGE RELATION (pick one; it must drive summary order and verdict tone; use childAgeProfile.ageInMonths as primary for babies)
1) WRONG STAGE (too advanced for baby): Listing is follow-on / stage-2 / 6–12 month style BUT childAgeProfile.ageInMonths is under 6 (0–5 inclusive). Verdict: clearly negative age-fit (baseVerdict at least as strict as ruleBasedBaseVerdict—typically avoid or sometimes with unmistakable wrong-stage wording, never "good" as a routine choice). Lead with wrong feeding stage / product band is ahead of this month age—not milk/soy unless avoids require.
2) STAGE-ALIGNED: Same follow-on / stage-2 style AND ageInMonths is 6–12 inclusive. Lead with stage/month band fit: this is intended for the follow-on window and is broadly aligned with that stage—use direct, confident wording (e.g. fits the usual follow-on age band; intended for babies around this stage). Do NOT open with milk/soy/lactose as a problem. Do NOT imply unsuitability from allergens alone when avoidPreferences is empty. Do NOT use weak "may not be suitable" tied only to dairy/soy presence.
3) OLDER THAN TARGET STAGE: Follow-on / stage-2 (or younger-band SKU) while child is 12+ completed months OR clearly past the label's month band on a normal varied diet. PRIMARY story: not necessary as an everyday default / designed for an earlier feeding phase—still not "dangerous" and not a milk/soy headline when avoidPreferences is empty. Same ordering as before: stage + necessity before routine dairy/soy.

WHEN formula-like pattern matches AND case (3) applies (healthy older toddler or child past label band):
- PRIMARY story: feeding STAGE vs child's age, everyday appropriateness, whether parents still need this as a default drink—not milk/soy as a worry headline.
- Redundancy vs family foods—not dairy protein as automatic danger without allergy context.
- Do NOT frame as "concerning because it contains milk/soy" with empty avoids.

ALLERGEN / MILK / SOY depth when avoidPreferences is missing or empty (or no matching dairy/soy avoid): keep milk/soy/lactose brief and secondary everywhere; stage-fit and necessity first.
When avoidPreferences includes dairy/soy (or preferenceMatches will): those topics may rank higher; stay coherent with verdict rules.
allergyNotes: for formula-like + empty avoids, prefer [] unless allergen text adds something beyond ordinary milk protein for this type (rare).
ingredientFlags: prefer stage/type/real added sugars or processing flags over generic "contains milk" when avoids are empty.

BANNED PHRASING (do not use, even rephrased)
- "Can be enjoyed in moderation", "not ideal", "in moderation", "everything in balance" style empty hedging.
- Weak modal hedges as a substitute for a clear fact: "may pose a risk", "may not provide", "might not provide", "might not be ideal"—replace with listing-based wording.
- Do not use vague "age-appropriate" as filler for unrelated snacks; for case (2) stage-aligned formula you SHOULD use concrete stage-fit language (allowed examples: intended for the follow-on month range; fits the usual stage for this age)—not generic hedging.
- Exception for case (3): clear wording like "designed for an earlier feeding stage", "not the usual everyday choice at this age", "redundant vs varied family foods" is encouraged—still avoid empty "may not be suitable" with no stage fact.

PREFERRED TONE (examples only—do not copy)
- "Too sugary for a strong everyday pick."
- "This is more candy than snack."
- "For this age, this is a weak choice."

SUMMARY (one sentence)
- One short, strong sentence—verdict-aligned, age-aware, not watery. Must sound different from every reasons bullet.

REASONS (factual bullets; exact count in user message)
- Direct factual lines from nutriments, allergens, categories, ingredient-derived signals, product type. Each bullet must add a new fact vs summary and vs preferenceMatches (no second sugar-only bullet if sugar is already the avoid story—use salt, sat fat, type, processing, list signals, etc.).
- When the product matches the FORMULA / FOLLOW-ON section: order bullets by the three-way relation—wrong stage (too early baby on follow-on) vs stage-aligned vs older than target stage—before routine milk/soy lines unless avoidPreferences forces dairy/soy to the front.
- NO repeated numbers rule: each numeric fact (same value + same unit context, e.g. the same sugar g/100 g line) appears at most once across summary, reasons, whyThisMatters, and parentTakeaway. If you state sugar as 12 g/100 g in one bullet, do not repeat that number in whyThisMatters or parentTakeaway or summary.

whyThisMatters (one short paragraph, 12–320 characters)
- One tight paragraph: why the verdict matters for this child age, using listing-backed logic—not a repeat of the summary sentence and not a numeric restatement of bullets.
- No bullet list; no ingredient dump.

parentTakeaway (one line, 8–220 characters)
- One decisive closing line for parents; must not recycle numeric facts already given in reasons.

nutritionSnapshot (array; can be empty)
- Optional per-100g lines from nutriments (user message depth). Same numeric honesty as reasons; avoid duplicating numbers already used in reasons.

ingredientFlags (array; can be empty)
- Short grounded flags from ingredients/allergens/categories when useful.

ingredientBreakdown
- MUST be [] (empty array). Ingredient copy is handled by the app from Open Food Facts.

allergyNotes (array)
- 0–3 short factual lines from allergens text when useful; else [].

guidanceContext
- 0–3 short lines only when defensible from nutriments/listing; else []. No URLs.

CANONICAL OUTPUT (always include every key; arrays may be empty)
{
  "baseVerdict": "good"|"sometimes"|"avoid"|"unknown",
  "finalVerdict": "good"|"sometimes"|"avoid"|"unknown",
  "summary": string,
  "reasons": string[],
  "preferenceMatches": string[],
  "nutritionSnapshot": string[],
  "ingredientFlags": string[],
  "ingredientBreakdown": string[],
  "allergyNotes": string[],
  "whyThisMatters": string,
  "parentTakeaway": string,
  "guidanceContext": string[]
}

Never infer cow's milk / dairy from yogurt alone; mention milk/dairy only when explicit in text or allergens.
- Exception: named infant/follow-on formula products list milk protein by design—that is expected category context; do not use it as the primary scare angle for an older healthy toddler when avoidPreferences is empty.`;

const GENERAL_DEPTH_INSTRUCTIONS = `REQUIRED COUNTS FOR THIS REQUEST:
- reasons: 4 to 6 strings, each 8–200 characters, all distinct factual points. Ground every line in nutriments, allergens, categories, or ingredient_text signals (product type, added sugar signals, sweeteners, palm oil, flavorings, caffeine, processing hints)—only with listing support. For formula-like products, first bullets must reflect the three-way stage relation (wrong stage vs aligned vs older than target); never open with milk/soy/lactose-as-sugar when avoids are empty; if the child is past the SKU's target band, at least the first one or two bullets must name stage/age/necessity (not milk/soy as the opener) unless avoidPreferences requires dairy/soy first.
- nutritionSnapshot: include useful per-100g lines from nutriments ONLY if those exact numbers are not already stated in reasons (avoid duplicate numbers).
- ingredientFlags: up to 12 distinct flags when the listing supports them; [] is fine if thin.
- ingredientBreakdown: MUST be [].
- guidanceContext: 0–3 short strings when supportable; otherwise []. Must not repeat summary or whyThisMatters.
- whyThisMatters: 12–320 characters, one paragraph, no numeric repeat of reasons.
- summary: one sentence, distinct from all bullets.`;

/** Appended to SYSTEM_PROMPT when `childAgeProfile.ageInMonths` is 0–11 (all text still in OUTPUT_LANGUAGE). */
const INFANT_UNDER12_SYSTEM_SUPPLEMENT = `

YOUNG BABY MODE (childAgeProfile.ageInMonths is 0–11 inclusive)
- This is a baby under 12 months—not a toddler. Be noticeably firmer, clearer, and more decisive than for 12–23 month children, while staying 100% grounded in the listing.
- Age bands within this mode: 0–5 completed months are the strictest (earliest milk/complementary feeding context). 6–11 completed months are still very conservative: sweetened flavored processed products, dessert-style yogurts, sodas/juice-drink positioning, and obvious snack/candy/bakery framing are especially poor fits unless the listing clearly reads as a simple, appropriate early food.
- FORMULA / FOLLOW-ON OVERRIDE (always check before snack/sugar heuristics): If the listing is formula-like (see main FORMULA section), age-stage fit overrides generic “processed” worry.
  • 0–5 months + follow-on / stage-2 / 6–12 month style SKU: WRONG STAGE—verdict and first bullets must center on too advanced a feeding stage for this month age; do not pivot the main story to milk/soy/lactose or treat lactose as added sugar.
  • 6–11 months + same follow-on / stage-2 style SKU: STAGE-ALIGNED—open with band/stage fit (broadly appropriate for the follow-on window). Do not use weak “may not be suitable” because of milk ingredients. Do not treat lactose or milk powder as a sugar problem by itself. Keep allergens minimal unless avoidPreferences hit.
  • First / stage-1 style SKU for 6–11 months: may be “earlier-stage” vs month age—explain with stage fit, not milk-as-threat unless avoids require.
- REASON ORDER (non-formula or after formula stage relation is set): Put the strongest listing-backed concerns first in \`reasons\`. Typical priority (skip what does not apply; never invent):
  (A1) Added sugar / clearly sweetened listing / sweetened flavored processed profile.
  (A2) Dessert, sweet treat, soda/juice-drink style, snack/candy/biscuit/chocolate positioning, or a clear mismatch with “simple infant-stage food” from name/categories/ingredients.
  (A3) Heavily engineered profile when the text supports it (e.g. several emulsifiers/stabilizers/preservatives/flavorings named—count only what appears).
  (B) If the listing is stage-specific formula and the override above did not already fix order: stage vs childAgeProfile.ageInMonths (too early / too late for this SKU) before generic milk/soy worry when avoids are empty.
  (B) Allergen or soy/dairy complexity only when clearly in the listing and relevant (or when parent avoids hit).
  (B) Category or product-type mismatch for this age.
  Weaker points last.
- FORMULA: For babies inside the labelled stage window for that SKU, judge from listing + age; do not open with "contains milk" when avoidPreferences is empty—milk base is normal for this product class.
- BANNED vague hedging for this baby age: do not use (even translated equivalents of) phrases like “may not be suitable”, “may pose a risk”, “may not provide”, “might not provide”, “might not be ideal”, “not the best option” as a substitute for a clear judgment. Say what the listing shows in direct language parents can act on.
- Exception: for stage-aligned follow-on (6–11 months) per FORMULA OVERRIDE, prefer firm factual stage-fit lines (“intended for the follow-on month range”, “matches this stage”) over empty modals—those positive stage lines are not “vague hedging.”
- FORBIDDEN unsupported claims: do not say the product “does not provide necessary nutrients” or similar broad deficiency claims unless the listing makes that gap obvious (e.g. clearly a confection with no meaningful staples). Prefer safer, still-strong lines like “This reads as a flavored processed product, not a simple first-food option” when name/categories/ingredients support that.
- SUMMARY: One sentence that states the MAIN issue (sugar / wrong product type / sweetened processed yogurt or drink / snack vs infant food / wrong formula stage vs month age when applicable)—decisive, not watery, and different from every reasons bullet.
- whyThisMatters: One short paragraph on the practical issue for babies this young (simpler foods; early palate; unnecessary sweets; wrong product category)—no numeric repeat of reasons, no invented nutrition gaps.
- Tone examples (translate fully to OUTPUT_LANGUAGE; do not copy verbatim): “Added sugar alone is enough to pass on this for a baby this young.” / “This is too early for a product like this.” / “This is a processed flavored product, not a simple infant food.” / “For a baby this age, this is a weak and unnecessary choice.” Stay factual—do not use “poison”/“toxic” unless the listing justifies extreme language (rare).
- Still obey verdict rules vs ruleBasedBaseVerdict and avoid-list behavior unchanged.`;

function childAgeMonthsIsUnder12(profile: KidsAiInput['childAgeProfile']): boolean {
  const m = profile.ageInMonths;
  return typeof m === 'number' && Number.isFinite(m) && m >= 0 && m < 12;
}

function buildGeneralSystemPrompt(input: KidsAiInput): string {
  if (childAgeMonthsIsUnder12(input.childAgeProfile)) {
    return `${SYSTEM_PROMPT}${INFANT_UNDER12_SYSTEM_SUPPLEMENT}`;
  }
  return SYSTEM_PROMPT;
}

function buildGeneralDepthInstructions(input: KidsAiInput): string {
  if (childAgeMonthsIsUnder12(input.childAgeProfile)) {
    return `REQUIRED COUNTS FOR THIS REQUEST (young baby under 12 months — use strict priority ordering):
- reasons: 5 to 6 strings, each 8–200 characters, all distinct factual points. Order bullets by strength: first the clearest stop signals the listing supports (for formula-like: wrong stage too early before anything else; for follow-on on a 6–11 month baby, stage-alignment before sugar heuristics; added sugar / sweetened processed / dessert or snack positioning / wrong product type for this age / older-than-stage necessity when applicable / visible additive stack when real), then allergen/category points only when they add distinct value, then milder points last. No second bullet that only repeats the same sugar story. For stage-labelled formula with empty avoids, do not lead with milk/soy or lactose as sugar; milk/soy presence alone is never the opener.
- nutritionSnapshot: include useful per-100g lines from nutriments ONLY if those exact numbers are not already stated in reasons (avoid duplicate numbers).
- ingredientFlags: up to 12 distinct flags when the listing supports them; [] is fine if thin.
- ingredientBreakdown: MUST be [].
- guidanceContext: 0–3 short strings when supportable; otherwise []. Must not repeat summary or whyThisMatters.
- whyThisMatters: 12–320 characters, one paragraph, practical and direct for a baby under 12 months—no numeric repeat of reasons, no vague “may” hedging, no unsupported “necessary nutrients” deficiency claims.
- summary: one sentence, dominant issue first, decisive and parent-clear, distinct from all bullets.`;
  }
  return GENERAL_DEPTH_INSTRUCTIONS;
}

function enrichGuidanceContext(input: KidsAiInput, evaluation: AiResult): AiResult {
  const existing = evaluation.guidanceContext?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (existing.length > 0) {
    return { ...evaluation, guidanceContext: existing.slice(0, 3) };
  }
  const filled = buildOfficialGuidanceContextLines(input.childAgeProfile, input.product.nutriments, {
    productName: input.product.productName,
    brand: input.product.brand,
    ingredientsText: input.product.ingredientsText,
    categories: input.product.categories,
  }, input.outputLanguage);
  return { ...evaluation, guidanceContext: filled.slice(0, 3) };
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (parseErr) {
    console.warn(LOG_PREFIX, 'JSON.parse assistant content failed:', parseErr);
    return null;
  }
}

function getOpenAiChatUrl(): string {
  if (Platform.OS === 'web' && typeof __DEV__ !== 'undefined' && __DEV__) {
    return '/__openai/v1/chat/completions';
  }
  return OPENAI_CHAT_URL;
}

function getOpenAiResponsesUrl(): string {
  if (Platform.OS === 'web' && typeof __DEV__ !== 'undefined' && __DEV__) {
    return '/__openai/v1/responses';
  }
  return OPENAI_RESPONSES_URL;
}

function applyAvoidPreferenceMatchesToAiResult(result: AiResult, input: KidsAiInput): AiResult {
  const hadAvoidPrefs = Array.isArray(input.avoidPreferences) && input.avoidPreferences.length > 0;
  if (!hadAvoidPrefs) {
    console.warn(LOG_PREFIX, '[prefs] no avoids — clearing preferenceMatches');
    return {
      ...result,
      preferenceMatches: [],
      verdict: result.baseVerdict,
    };
  }
  const merged = mergePreferenceMatchIds(result.preferenceMatches, input.product, input.avoidPreferences);
  console.warn(LOG_PREFIX, '[prefs] preferenceMatches after merge+inference', merged);
  if (merged.length > 0) {
    return {
      ...result,
      preferenceMatches: merged,
      verdict: clampFinalVerdictToBase(result.baseVerdict, 'avoid'),
    };
  }
  return { ...result, preferenceMatches: merged };
}

function finalizeKidsEvaluationWithPreferences(result: AiResult, input: KidsAiInput): AiResult {
  const merged = applyAvoidPreferenceMatchesToAiResult(result, input);
  return applyDeterministicFormulaStageVerdictPatch(
    input.childAgeProfile.ageInMonths,
    input.childAgeProfile.ageBucket,
    input.product,
    merged,
  );
}

export async function evaluateProductWithAi(rawInput: KidsAiInput): Promise<AiResult> {
  const input: KidsAiInput = { ...rawInput, outputLanguage: ENGLISH_APP_LANGUAGE };
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  const keyPresent = typeof apiKey === 'string' && !!apiKey.trim();
  console.warn(LOG_PREFIX, 'EXPO_PUBLIC_OPENAI_API_KEY present:', keyPresent);
  console.warn(LOG_PREFIX, '[prefs] avoid list for analysis', input.avoidPreferences ?? []);

  const ruleBase = input.ruleBasedBaseVerdict;

  if (!keyPresent) {
    console.warn(LOG_PREFIX, 'using fallback: missing API key');
    return finalizeKidsEvaluationWithPreferences(getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage), input);
  }

  const requestUrl = getOpenAiChatUrl();
  console.warn(LOG_PREFIX, 'request URL:', requestUrl);

  try {
    const response = await expoFetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildGeneralSystemPrompt(input) },
          {
            role: 'user',
            content: `OUTPUT_LANGUAGE: ${input.outputLanguage} (${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]}). Write 100% of explanatory text in ${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]} only. All natural-language string values in the JSON (summary, reasons, nutritionSnapshot, ingredientFlags, ingredientBreakdown, allergyNotes, whyThisMatters, parentTakeaway, guidanceContext) MUST be in ${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]}. The preferenceMatches array is the ONLY exception: it must contain ONLY exact snake_case ids copied from avoidPreferences (no translated text). Keep JSON keys in English. Keep verbatim from input: product.productName, product.brand, product.barcode. Verdict fields baseVerdict and finalVerdict must remain exactly one of: good, sometimes, avoid, unknown.

Evaluate this input. Reply with JSON only:
${JSON.stringify(input)}

${buildGeneralDepthInstructions(input)}`,
          },
        ],
      }),
    });

    console.warn(LOG_PREFIX, 'response status:', response.status);

    const rawText = await response.text();
    console.warn(LOG_PREFIX, 'raw response text:', rawText);

    if (!response.ok) {
      console.warn(LOG_PREFIX, 'using fallback: HTTP not OK, status', response.status);
      return finalizeKidsEvaluationWithPreferences(getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage), input);
    }

    let data: { choices?: { message?: { content?: string } }[] };
    try {
      data = JSON.parse(rawText) as { choices?: { message?: { content?: string } }[] };
    } catch (parseBodyErr) {
      console.warn(LOG_PREFIX, 'using fallback: failed to parse response body as JSON:', parseBodyErr);
      return finalizeKidsEvaluationWithPreferences(getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage), input);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      console.warn(LOG_PREFIX, 'using fallback: missing or empty choices[0].message.content');
      return finalizeKidsEvaluationWithPreferences(getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage), input);
    }

    const parsed = parseJson(content.trim());
    const evaluation = normalizeCanonicalAiPayload(parsed, ruleBase, 'advanced');
    if (!evaluation) {
      console.warn(LOG_PREFIX, 'using fallback: evaluation JSON failed validation', { parsed });
      return finalizeKidsEvaluationWithPreferences(getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage), input);
    }
    console.warn(LOG_PREFIX, '[prefs] preferenceMatches from model (post-parse)', evaluation.preferenceMatches);
    const localizedEval = localizeAiResultStrings(evaluation, input.outputLanguage);
    const enriched = enrichGuidanceContext(input, localizedEval);
    return finalizeKidsEvaluationWithPreferences(enriched, input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(LOG_PREFIX, 'caught error:', message, err);
    console.warn(LOG_PREFIX, 'using fallback after error');
    return finalizeKidsEvaluationWithPreferences(getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage), input);
  }
}

type BarcodeLookupExtract =
  | { kind: 'miss' }
  | { kind: 'invalid' }
  | { kind: 'payload'; value: unknown };

function extractBarcodeLookupProduct(parsed: unknown): BarcodeLookupExtract {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'invalid' };
  }
  if (!('product' in parsed)) {
    return { kind: 'invalid' };
  }
  const p = (parsed as { product: unknown }).product;
  if (p === null) {
    return { kind: 'miss' };
  }
  return { kind: 'payload', value: p };
}

function stripAssistantJsonFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return t;
}

function stripTrailingCommasJsonish(s: string): string {
  let out = s;
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(/,(\s*[}\]])/g, '$1');
  }
  return out;
}

/** Rough brace depth ignoring braces inside JSON strings (best-effort for truncated outputs). */
function balanceUnclosedBraces(s: string): string {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === '\\') {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  if (depth <= 0) {
    return s;
  }
  return s + '}'.repeat(depth);
}

/**
 * If assistant JSON is truncated/malformed, try minimal safe repairs before parse.
 */
function prepareBarcodeAssistantJsonForParse(raw: string): { text: string; repairAttempted: boolean } {
  let text = stripAssistantJsonFences(raw.trim());
  const tryParse = (t: string): unknown | null => {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  };
  if (tryParse(text) !== null) {
    return { text, repairAttempted: false };
  }

  const i0 = text.indexOf('{');
  const i1 = text.lastIndexOf('}');
  if (i0 !== -1 && i1 > i0) {
    text = text.slice(i0, i1 + 1);
  }
  text = stripTrailingCommasJsonish(text);
  if (tryParse(text) !== null) {
    return { text, repairAttempted: true };
  }

  const balanced = stripTrailingCommasJsonish(balanceUnclosedBraces(text));
  if (tryParse(balanced) !== null) {
    return { text: balanced, repairAttempted: true };
  }

  return { text: balanced, repairAttempted: true };
}

function isResponsesApiCompleted(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const d = data as Record<string, unknown>;
  if (d.status !== 'completed') {
    return false;
  }
  if (d.error != null) {
    return false;
  }
  return true;
}

function responseOutputHasRefusal(data: unknown): boolean {
  const out = (data as Record<string, unknown>)?.output;
  if (!Array.isArray(out)) {
    return false;
  }
  for (const item of out) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if ((item as Record<string, unknown>).type !== 'message') {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'refusal') {
        return true;
      }
    }
  }
  return false;
}

function extractResponsesOutputJsonText(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const d = data as Record<string, unknown>;
  if (typeof d.output_text === 'string' && d.output_text.trim()) {
    return stripAssistantJsonFences(d.output_text);
  }
  const out = d.output;
  if (!Array.isArray(out)) {
    return null;
  }
  const chunks: string[] = [];
  for (const item of out) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if ((item as Record<string, unknown>).type !== 'message') {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const p = part as Record<string, unknown>;
      if (p.type === 'refusal') {
        return null;
      }
      if (p.type === 'output_text' && typeof p.text === 'string' && p.text.trim()) {
        chunks.push(p.text.trim());
      }
    }
  }
  if (chunks.length === 0) {
    return null;
  }
  return stripAssistantJsonFences(chunks.join('\n'));
}

function collectUrlCitationStrings(data: unknown): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (u: unknown) => {
    if (typeof u !== 'string' || !u.trim()) {
      return;
    }
    const t = u.trim();
    if (seen.has(t)) {
      return;
    }
    seen.add(t);
    urls.push(t);
  };

  const out = (data as Record<string, unknown>)?.output;
  if (!Array.isArray(out)) {
    return urls;
  }
  for (const item of out) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if ((item as Record<string, unknown>).type !== 'message') {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const p = part as Record<string, unknown>;
      if (p.type !== 'output_text' || !Array.isArray(p.annotations)) {
        continue;
      }
      for (const ann of p.annotations) {
        if (!ann || typeof ann !== 'object') {
          continue;
        }
        const a = ann as Record<string, unknown>;
        if (a.type === 'url_citation' && typeof a.url === 'string') {
          push(a.url);
        }
      }
    }
  }
  return urls;
}

function mergeCitationUrlsIntoProductPayload(productPayload: unknown, citationUrls: string[]): unknown {
  if (!productPayload || typeof productPayload !== 'object' || Array.isArray(productPayload)) {
    return productPayload;
  }
  const o = { ...(productPayload as Record<string, unknown>) };
  const rj = o.rawJson;
  if (!rj || typeof rj !== 'object' || Array.isArray(rj)) {
    return o;
  }
  const meta = { ...(rj as Record<string, unknown>) };
  const existing = Array.isArray(meta.matchedSources)
    ? meta.matchedSources.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : [];
  if (existing.length === 0 && citationUrls.length > 0) {
    meta.matchedSources = citationUrls.slice(0, 25);
    return { ...o, rawJson: meta };
  }
  return o;
}

/**
 * OFF miss only: OpenAI Responses API with web_search tool → raw `NormalizedProduct` or null.
 * Does not run `evaluateProductWithAi` — caller uses `buildAiInput` + `evaluateProductWithAi` after success.
 */
export async function fetchNormalizedProductByBarcodeWithAi(barcode: string): Promise<NormalizedProduct | null> {
  const code = barcode.trim();
  if (!code) {
    return null;
  }

  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    console.warn(LOG_PREFIX, '[barcodeLookup] skip: missing API key');
    return null;
  }

  const requestUrl = getOpenAiResponsesUrl();
  const userContent = `BARCODE:${code}

One line JSON only. Key "product" only.`;

  let rawText: string;
  try {
    const response = await expoFetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: BARCODE_RESPONSES_MODEL,
        instructions: BARCODE_LOOKUP_SYSTEM_PROMPT,
        input: userContent,
        tools: [{ type: 'web_search' }],
        tool_choice: 'required',
        temperature: 0.1,
        max_output_tokens: 8192,
      }),
    });
    rawText = await response.text();
    if (!response.ok) {
      console.warn(LOG_PREFIX, '[barcodeLookup] Responses HTTP not OK', response.status, rawText.slice(0, 800));
      return null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(LOG_PREFIX, '[barcodeLookup] network error', message);
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText) as unknown;
  } catch (e) {
    console.warn(LOG_PREFIX, '[barcodeLookup] response body is not JSON', e);
    return null;
  }

  if (!isResponsesApiCompleted(data)) {
    console.warn(LOG_PREFIX, '[barcodeLookup] response not completed', data);
    return null;
  }
  if (responseOutputHasRefusal(data)) {
    console.warn(LOG_PREFIX, '[barcodeLookup] model refusal in output');
    return null;
  }

  const jsonText = extractResponsesOutputJsonText(data);
  if (!jsonText) {
    console.warn(LOG_PREFIX, '[barcodeLookup] no assistant output_text');
    return null;
  }

  const rawPreviewMax = 12000;
  console.warn(
    LOG_PREFIX,
    '[barcodeLookup] raw assistant text (before JSON.parse)',
    jsonText.length > rawPreviewMax
      ? `${jsonText.slice(0, rawPreviewMax)}… [truncated, totalLen=${jsonText.length}]`
      : jsonText,
  );

  const prepared = prepareBarcodeAssistantJsonForParse(jsonText);
  if (prepared.repairAttempted) {
    const pMax = 12000;
    console.warn(
      LOG_PREFIX,
      '[barcodeLookup] repaired assistant text (before final JSON.parse)',
      prepared.text.length > pMax ? `${prepared.text.slice(0, pMax)}… [truncated, totalLen=${prepared.text.length}]` : prepared.text,
    );
  }

  const parsed = parseJson(prepared.text);
  if (parsed === null) {
    console.warn(LOG_PREFIX, '[barcodeLookup] parsed JSON: parse failed after repair (invalid JSON)');
    return null;
  }
  try {
    console.warn(LOG_PREFIX, '[barcodeLookup] parsed JSON object', JSON.stringify(parsed));
  } catch (e) {
    console.warn(LOG_PREFIX, '[barcodeLookup] parsed JSON object (stringify failed)', parsed, e);
  }

  const extracted = extractBarcodeLookupProduct(parsed);
  if (extracted.kind === 'miss') {
    console.warn(LOG_PREFIX, '[barcodeLookup] explicit product null');
    return null;
  }
  if (extracted.kind === 'invalid') {
    console.warn(LOG_PREFIX, '[barcodeLookup] invalid product wrapper (missing or non-object "product" key)', {
      parsed,
      topLevelKeys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed as object) : [],
    });
    return null;
  }

  const citationUrls = collectUrlCitationStrings(data);
  const mergedPayload = mergeCitationUrlsIntoProductPayload(extracted.value, citationUrls);
  try {
    console.warn(
      LOG_PREFIX,
      '[barcodeLookup] normalized candidate object (merged payload, before validation)',
      JSON.stringify(mergedPayload),
    );
  } catch (e) {
    console.warn(LOG_PREFIX, '[barcodeLookup] normalized candidate object (stringify failed)', mergedPayload, e);
  }

  const normResult = normalizeAiBarcodeLookupProductDetailed(code, mergedPayload);
  if (!normResult.ok) {
    console.warn(LOG_PREFIX, '[barcodeLookup] validation rejected payload — reasons:', normResult.reasons);
    return null;
  }
  const normalized = normResult.product;
  try {
    console.warn(LOG_PREFIX, '[barcodeLookup] validated NormalizedProduct (post-validation)', JSON.stringify(normalized));
  } catch (e) {
    console.warn(LOG_PREFIX, '[barcodeLookup] validated NormalizedProduct (stringify failed)', normalized, e);
  }
  console.warn(LOG_PREFIX, '[barcodeLookup] resolved', normalized.productName);
  return normalized;
}

const ING_LOG = '[OpenAI][Ingredients]';

const INGREDIENTS_SYSTEM_PROMPT = `You are the Ingredients tab writer for parents. Input JSON includes:
- cleanedIngredientLines: ordered REAL ingredient tokens from Open Food Facts ONLY (already cleaned—no nutrition blocks, no importer lines). These may be in Bulgarian or other languages—they are SOURCE DATA ONLY.
- additivesTags, allergensDeclared, traceDeclared: context only—do not invent extra rows.
- avoidPreferenceIds, childAge, childAgeMonths, ageDisplayLabel, ageBucket, outputLanguage, localeHint (device locale when present).

Output EXACTLY this JSON shape (keys spelled exactly: good, neutral, redFlags):
{
  "good": [ { "name": "string", "note": "string" } ],
  "neutral": [ { "name": "string", "note": "string" } ],
  "redFlags": [ { "name": "string", "note": "string" } ]
}

LANGUAGE LOCK (mandatory — highest priority)
- outputLanguage defines the ONLY language allowed in every "name" and every "note" in good, neutral, and redFlags. One language end-to-end. No mixing.
- When outputLanguage is "ru": write standard Russian ONLY in all name and note fields. No Bulgarian, no English, no Ukrainian, no Latin marketing snippets in the output strings.
- When outputLanguage is "uk": write standard Ukrainian ONLY. No Russian, no Bulgarian, no English mixed in.
- When outputLanguage is "en": English ONLY in all name and note fields.
- For de, fr, es, it, pl, pt, nl: write ONLY that target language in name and note—no English, no Bulgarian, no other language mixed in.
- You MUST translate or adapt every ingredient name from cleanedIngredientLines into the target language. Do NOT copy source-language (e.g. Bulgarian) tokens into "name" or "note" when outputLanguage is Russian, Ukrainian, etc.
- Notes must also be written entirely in the target language—never leave notes in English or Bulgarian when the target is Russian or Ukrainian.

STRICT RULES
1) Cover cleanedIngredientLines: each token must be reflected in your output (translate or merge obvious duplicate/split fragments of the same substance). Prefer one row per token; if you merge duplicates, total rows may be slightly less than the array length—then every remaining row must still map clearly to those tokens.
2) name and note: 100% in outputLanguage only. Natural ingredient names in that language—not raw OFF copy-paste in another script.
3) note: about 6–22 words. Tone: direct, emotional, clear, not euphemistic—still grounded in what the token is. Vary wording across rows; never one boilerplate note for all.
4) SUGARS (critical): do NOT default sugar to neutral. Added / free sugars (sugar, sucrose, glucose-fructose syrup, glucose syrup, invert sugar, HFCS, malt extract, molasses, dextrose, fructose syrup, icing sugar, caramel, sweetened condensed milk as a sugar carrier, etc.) belong in redFlags when they are clearly sweetening / bulk sugar—not in neutral “by default”.
5) Other redFlags when the token supports it: glucose syrup, molasses, heavy syrup sweeteners, palm oil (cheap processed fat), hydrogenated / partially hydrogenated fats, artificial flavourings / flavourings that read industrial, intense sweeteners, obvious junk fats, heavy preservatives, caffeine in kid-relevant products, etc.
6) good: simple, wholesome bases when the token supports it (water, whole fruit, veg, plain oats, pulses, plain dairy when clearly unprocessed, etc.).
7) neutral: ordinary recipe ingredients that are not sugar bombs and not industrial red-flag material (flour, starch, salt in normal use, citric acid, lecithin, vanilla as a real spice, etc.).
8) Soy, milk, eggs, gluten/wheat, nuts: default neutral with a factual note UNLESS avoidPreferenceIds or allergensDeclared / traceDeclared clearly calls for a sharper warning—then redFlags with a specific, contextual note (allergen / avoid list), not “automatically bad”. When avoidPreferenceIds is relevant to an ingredient, you may briefly say so in that row’s note (still in outputLanguage only).
9) additivesTags: hints for E-numbers only—still one row per cleaned line, no extra ingredients.
10) Never output i18n keys or snake_case ids in name or note.

BANNED soft filler (do not use): “consume in moderation”, “in moderation”, “common sweetener”, “not ideal”, “everything in balance”, vague “may contain” speculation.

NOTE STYLE EXAMPLES (rewrite fully in outputLanguage only; do not copy English examples into non-English outputs): added sugar as a worst offender for a child; glucose syrup as fast sugar with almost no value; molasses as another dense sugar source; palm oil as cheap processed fat; flavouring as making the product feel artificial; lecithin as a common emulsifier, minor by itself; citric acid as a normal acid regulator; peanuts as a real ingredient but a serious allergen.`;

export async function evaluateIngredientsWithAi(input: IngredientsAiInput): Promise<IngredientAiPanel | null> {
  input = { ...input, outputLanguage: ENGLISH_APP_LANGUAGE, localeHint: ENGLISH_APP_LOCALE };
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    console.warn(ING_LOG, 'skip: no API key');
    return null;
  }
  const expected = input.cleanedIngredientLines.length;
  if (expected === 0) {
    console.warn(ING_LOG, 'skip: empty cleanedIngredientLines');
    return null;
  }
  const deviceLocaleTag = ENGLISH_APP_LOCALE;
  console.warn(ING_LOG, 'detected app language sent to Ingredients AI pass', {
    outputLanguage: input.outputLanguage,
    outputLanguageName: OUTPUT_LANGUAGE_NAMES[input.outputLanguage],
    localeHint: deviceLocaleTag ?? input.outputLanguage,
  });
  console.warn(ING_LOG, 'cleanedIngredientLines before request', { count: expected, lines: input.cleanedIngredientLines });
  const requestUrl = getOpenAiChatUrl();
  try {
    const response = await expoFetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.35,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: INGREDIENTS_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `TARGET_APP_LANGUAGE_CODE: ${input.outputLanguage}
TARGET_APP_LANGUAGE_NAME: ${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]}
DEVICE_LOCALE_BCP47: ${deviceLocaleTag ?? input.outputLanguage}

All "name" and "note" strings in good, neutral, and redFlags MUST be written ONLY in ${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]} — single language, no mixing. Translate every ingredient name from the source tokens; do not leave Bulgarian, English, or other languages in the output when the target is ${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]}.

Reply with JSON only:
${JSON.stringify({
              ...input,
              outputLanguageName: OUTPUT_LANGUAGE_NAMES[input.outputLanguage],
              localeHint: deviceLocaleTag ?? input.outputLanguage,
            })}`,
          },
        ],
      }),
    });
    const rawText = await response.text();
    console.warn(ING_LOG, 'raw HTTP response (first 1200 chars)', rawText.slice(0, 1200));
    if (!response.ok) {
      console.warn(ING_LOG, 'HTTP not OK', response.status);
      return null;
    }
    let data: { choices?: { message?: { content?: string } }[] };
    try {
      data = JSON.parse(rawText) as { choices?: { message?: { content?: string } }[] };
    } catch (e) {
      console.warn(ING_LOG, 'failed to parse outer response JSON', e);
      return null;
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      console.warn(ING_LOG, 'empty assistant content');
      return null;
    }
    const trimmed = content.trim();
    console.warn(ING_LOG, 'raw assistant content (first 1500 chars)', trimmed.slice(0, 1500));
    const parsed = parseJson(trimmed);
    console.warn(ING_LOG, 'parsed assistant JSON typeof', typeof parsed, parsed && typeof parsed === 'object' ? Object.keys(parsed as object) : []);
    const panel = parseIngredientAiPanelJson(parsed);
    if (!panel) {
      console.warn(ING_LOG, 'structured panel validation failed (see [IngredientsPanel][validate] logs)');
      return null;
    }
    const aiClassified = panel.good.length + panel.neutral.length + panel.redFlags.length;
    const allRows = [...panel.good, ...panel.neutral, ...panel.redFlags];
    console.warn(ING_LOG, 'validation OK; using structured panel', {
      good: panel.good.length,
      neutral: panel.neutral.length,
      redFlags: panel.redFlags.length,
    });
    console.warn(ING_LOG, 'final structured ingredient names preview', allRows.map((e) => e.name).slice(0, 14));
    console.warn(
      ING_LOG,
      'final structured ingredient notes preview',
      allRows.map((e) => (e.note.length > 140 ? `${e.note.slice(0, 140)}…` : e.note)).slice(0, 14),
    );
    console.warn(ING_LOG, 'counts summary', {
      cleanedCandidateCount: expected,
      finalAiClassifiedCount: aiClassified,
    });
    return panel;
  } catch (err) {
    console.warn(ING_LOG, 'caught error', err);
    return null;
  }
}
