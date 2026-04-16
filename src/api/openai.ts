import { fetch as expoFetch } from 'expo/fetch';
import * as Localization from 'expo-localization';
import { Platform } from 'react-native';

import { buildOfficialGuidanceContextLines } from '../lib/officialGuidanceContext';
import { localizeAiResultStrings } from '../lib/localizeScanText';
import { OUTPUT_LANGUAGE_NAMES } from '../lib/i18n';
import { getFallbackAiResult } from '../lib/getFallbackAiResult';
import { normalizeCanonicalAiPayload } from '../lib/resultStyleHelpers';
import type { AiResult, IngredientsAiInput, KidsAiInput } from '../types/ai';
import type { IngredientAiPanel } from '../types/scan';
import { parseIngredientAiPanelJson } from '../lib/ingredientAiPanel';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const LOG_PREFIX = '[OpenAI]';

const SYSTEM_PROMPT = `You write the GENERAL tab of a scan result for ONE packaged food or drink for parents; childAge is in the input. The app shows ingredients separately from Open Food Facts—do not try to list every ingredient in your JSON. Output JSON ONLY. No markdown.

OUTPUT LANGUAGE (mandatory)
- The user message includes OUTPUT_LANGUAGE. Every natural-language string in the JSON (summary, reasons, preferenceMatches, nutritionSnapshot, ingredientFlags, ingredientBreakdown, allergyNotes, whyThisMatters, parentTakeaway, guidanceContext) MUST be written entirely in that language.
- Do not mix languages. In non-English outputs, translate nutrition terms (sugar, salt, sodium, saturated fat, energy, kcal, kJ, etc.) into OUTPUT_LANGUAGE.
- Keep JSON keys in English. Copy product.productName, product.brand, product.barcode verbatim from input.

CORE ORDER
1) Facts from the listing only: ingredients_text, allergens, categories, nutriments, product fields—no guessing.
2) Short, direct child-age interpretation. Not clinical. No filler.

AUTHORITATIVE VERDICTS (non-negotiable)
- baseVerdict MUST equal ruleBasedBaseVerdict.
- finalVerdict: if avoidPreferences is empty or nothing matches, finalVerdict MUST equal ruleBasedBaseVerdict. If an avoid clearly matches product text, finalVerdict may be stricter but NEVER more lenient.
- All text fields MUST align with those verdicts.

AVOID PREFERENCES
- If avoidPreferences is missing or empty: preferenceMatches MUST be [].
- Otherwise list preferenceMatches only when clearly supported by product text.

DATA HONESTY
- Never invent grams, allergens, caffeine, or sweeteners. If a number is missing from nutriments, do not state a gram value.
- Use nutriments keys when present (sugars_100g, salt_100g, sodium_100g, saturated-fat_100g, energy-kcal_100g). Prefer salt_100g; if only sodium_100g, you may give sodium in mg per 100 g (convert from g).

AGE + PRODUCT TYPE
- Frame by childAge using listing support only (categories, name, ingredients, nutriments).
- Infer product type only when supported (yogurt, dessert, snack, drink, cereal, etc.).

BANNED PHRASING (do not use, even rephrased)
- "Can be enjoyed in moderation", "not ideal", "age-appropriate", "in moderation", "everything in balance" style hedging.

PREFERRED TONE (examples only—do not copy)
- "Too sugary for a strong everyday pick."
- "This is more candy than snack."
- "For this age, this is a weak choice."

SUMMARY (one sentence)
- One short, strong sentence—verdict-aligned, age-aware, not watery. Must sound different from every reasons bullet.

REASONS (factual bullets; exact count in user message)
- Direct factual lines from nutriments, allergens, categories, ingredient-derived signals, product type. Each bullet must add a new fact vs summary and vs preferenceMatches (no second sugar-only bullet if sugar is already the avoid story—use salt, sat fat, type, processing, list signals, allergens, etc.).
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

Never infer cow's milk / dairy from yogurt alone; mention milk/dairy only when explicit in text or allergens.`;

const GENERAL_DEPTH_INSTRUCTIONS = `REQUIRED COUNTS FOR THIS REQUEST:
- reasons: 4 to 6 strings, each 8–200 characters, all distinct factual points. Ground every line in nutriments, allergens, categories, or ingredient_text signals (product type, added sugar signals, sweeteners, palm oil, flavorings, caffeine, processing hints)—only with listing support.
- nutritionSnapshot: include useful per-100g lines from nutriments ONLY if those exact numbers are not already stated in reasons (avoid duplicate numbers).
- ingredientFlags: up to 12 distinct flags when the listing supports them; [] is fine if thin.
- ingredientBreakdown: MUST be [].
- guidanceContext: 0–3 short strings when supportable; otherwise []. Must not repeat summary or whyThisMatters.
- whyThisMatters: 12–320 characters, one paragraph, no numeric repeat of reasons.
- summary: one sentence, distinct from all bullets.`;

function enrichGuidanceContext(input: KidsAiInput, evaluation: AiResult): AiResult {
  const existing = evaluation.guidanceContext?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (existing.length > 0) {
    return { ...evaluation, guidanceContext: existing.slice(0, 3) };
  }
  const age = typeof input.childAge === 'number' && Number.isFinite(input.childAge) ? input.childAge : null;
  const filled = buildOfficialGuidanceContextLines(age, input.product.nutriments, {
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

export async function evaluateProductWithAi(input: KidsAiInput): Promise<AiResult> {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  const keyPresent = typeof apiKey === 'string' && !!apiKey.trim();
  console.warn(LOG_PREFIX, 'EXPO_PUBLIC_OPENAI_API_KEY present:', keyPresent);

  const ruleBase = input.ruleBasedBaseVerdict;

  if (!keyPresent) {
    console.warn(LOG_PREFIX, 'using fallback: missing API key');
    return getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage);
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
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `OUTPUT_LANGUAGE: ${input.outputLanguage} (${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]}). Write 100% of explanatory text in ${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]} only. All natural-language string values in the JSON (summary, reasons, preferenceMatches, nutritionSnapshot, ingredientFlags, ingredientBreakdown, allergyNotes, whyThisMatters, parentTakeaway, guidanceContext) MUST be in ${OUTPUT_LANGUAGE_NAMES[input.outputLanguage]}. Keep JSON keys in English. Keep verbatim from input: product.productName, product.brand, product.barcode. Verdict fields baseVerdict and finalVerdict must remain exactly one of: good, sometimes, avoid, unknown.

Evaluate this input. Reply with JSON only:
${JSON.stringify(input)}

${GENERAL_DEPTH_INSTRUCTIONS}`,
          },
        ],
      }),
    });

    console.warn(LOG_PREFIX, 'response status:', response.status);

    const rawText = await response.text();
    console.warn(LOG_PREFIX, 'raw response text:', rawText);

    if (!response.ok) {
      console.warn(LOG_PREFIX, 'using fallback: HTTP not OK, status', response.status);
      return getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage);
    }

    let data: { choices?: { message?: { content?: string } }[] };
    try {
      data = JSON.parse(rawText) as { choices?: { message?: { content?: string } }[] };
    } catch (parseBodyErr) {
      console.warn(LOG_PREFIX, 'using fallback: failed to parse response body as JSON:', parseBodyErr);
      return getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      console.warn(LOG_PREFIX, 'using fallback: missing or empty choices[0].message.content');
      return getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage);
    }

    const parsed = parseJson(content.trim());
    const evaluation = normalizeCanonicalAiPayload(parsed, ruleBase, 'advanced');
    if (!evaluation) {
      console.warn(LOG_PREFIX, 'using fallback: evaluation JSON failed validation', { parsed });
      return getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage);
    }
    const localizedEval = localizeAiResultStrings(evaluation, input.outputLanguage);
    const enriched = enrichGuidanceContext(input, localizedEval);
    const hadAvoidPrefs = Array.isArray(input.avoidPreferences) && input.avoidPreferences.length > 0;
    if (!hadAvoidPrefs) {
      return {
        ...enriched,
        preferenceMatches: [],
        verdict: enriched.baseVerdict,
      };
    }
    return enriched;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(LOG_PREFIX, 'caught error:', message, err);
    console.warn(LOG_PREFIX, 'using fallback after error');
    return getFallbackAiResult(ruleBase, 'advanced', input.outputLanguage);
  }
}

const ING_LOG = '[OpenAI][Ingredients]';

const INGREDIENTS_SYSTEM_PROMPT = `You are the Ingredients tab writer for parents. Input JSON includes:
- cleanedIngredientLines: ordered REAL ingredient tokens from Open Food Facts ONLY (already cleaned—no nutrition blocks, no importer lines). These may be in Bulgarian or other languages—they are SOURCE DATA ONLY.
- additivesTags, allergensDeclared, traceDeclared: context only—do not invent extra rows.
- avoidPreferenceIds, childAge, outputLanguage, localeHint (device locale when present).

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
  const deviceLocaleTag =
    input.localeHint ??
    (() => {
      try {
        return Localization.getLocales()?.[0]?.languageTag;
      } catch {
        return undefined;
      }
    })();
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
