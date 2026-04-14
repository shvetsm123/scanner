import { fetch as expoFetch } from 'expo/fetch';
import { Platform } from 'react-native';

import { getFallbackAiResult } from '../lib/getFallbackAiResult';
import { normalizeCanonicalAiPayload } from '../lib/resultStyleHelpers';
import type { AiResult, KidsAiInput } from '../types/ai';
import type { ResultStyle } from '../types/preferences';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const LOG_PREFIX = '[OpenAI]';

const SYSTEM_PROMPT = `You write scan results for ONE packaged food or drink for parents, childAge in the input. Output JSON ONLY. No markdown.

CORE ORDER
1) Facts from the listing first (ingredients_text, allergens, categories, nutriments, product_name, brand, barcode only—no guessing).
2) Short, practical child-age interpretation second. Never sound clinical or like a doctor. No lectures.

AUTHORITATIVE VERDICTS (non-negotiable)
- ruleBasedBaseVerdict is the app's hard outcome. Set baseVerdict to exactly the same string as ruleBasedBaseVerdict.
- finalVerdict: if avoidPreferences is empty or nothing matches, finalVerdict MUST equal ruleBasedBaseVerdict. If an avoid clearly matches product text, finalVerdict may be stricter than ruleBasedBaseVerdict but NEVER more lenient.
- summary, reasons, nutritionSnapshot, ingredientFlags, ingredientBreakdown, allergyNotes, and parentTakeaway MUST align with those verdicts.

AVOID PREFERENCES
- If avoidPreferences is missing or empty: preferenceMatches MUST be [].
- If non-empty: list preferenceMatches only when clearly supported by product text; otherwise [].

DATA HONESTY
- Never invent grams, allergens, caffeine, or sweeteners. If a number is missing from nutriments, do not state a gram value; say nutrition is missing or not on the listing if relevant.
- If added sugar is not explicitly confirmed, use cautious wording ("Sweetened product", "Sugar appears in the ingredient list")—do not claim a numeric "added sugar" unless the data supports it.
- Use nutriments keys when present (e.g. sugars_100g, salt_100g, sodium_100g, saturated-fat_100g, energy-kcal_100g). Prefer salt_100g; if only sodium_100g exists, you may phrase sodium in mg per 100 g (convert from g if needed).
- Detect sweeteners or caffeine only from clear ingredient/category/name signals, not assumptions.

AGE FRAMING (brief, official-style, not quoted)
- Under 2: treat added sugar / clearly sweetened products strictly in wording.
- 2–3: note that free sugar allowance is small, so sugar can use a noticeable share of the day when numbers exist.
- 4–6: still contextualize sugar and salt for snacks vs everyday foods.
- Never use vague praise like "nutrient-rich", "natural vegetable", "age-appropriate", "healthy option", "can be enjoyed in moderation" unless tightly justified by data (prefer not to use them at all).

PRODUCT TYPE
- Infer obvious type only when supported by categories/name/ingredients (yogurt, dessert, cookies, chips, candy, snack, drink, puree, cereal, pasta, plain food, etc.).

SUMMARY (one sentence)
- One short child-focused sentence (interpretation), different in tone from the factual bullets. Examples of tone (do not copy verbatim): "For this age, better sometimes than every day." / "For children under 2, this is not a good fit." / "For this age, the salt level makes this a weaker snack choice."

REASONS (array length depends on input.resultStyle — user message states exact counts)
- Factual bullets first: sugar per 100 g or ml; salt (or sodium); saturated fat; sweetening / added sugar signals; sweeteners; caffeine; allergens; snack or dessert style; ingredient list length—only with listing support.
- If a nutrient is missing, use a non-numeric factual line instead of inventing numbers.
- Each reason MUST add a fact not already stated in summary or preferenceMatches. Do not paraphrase the summary thesis or repeat an avoid-list match (e.g. if preferenceMatches cover added sugar, do not use another bullet that only says the product is sugary or has added sugar—use a different angle: salt, sat fat, product type, processing, syrup/fruit form, ingredient-list length, allergens, etc.).
- Do not restate the same nutrient thesis as nutritionSnapshot lines; bullets complement the snapshot rather than repeating the same per-100g point in different words.

nutritionSnapshot (array of strings, can be empty)
- One line per useful fact from nutriments or explicit listing text. Depth scales with resultStyle (user message).

ingredientFlags (array of strings, can be empty)
- Short flag lines grounded in ingredients, allergens, categories. More lines expected for advanced (user message).

ingredientBreakdown (2–4 strings)
- Readable paragraphs (composition): what the product mainly is; simple vs formulated; sugar/sweetened nature if grounded; additives only if in data; allergen relevance; say when data is limited. Advanced paragraphs should be clearly fuller than quick (user message).

allergyNotes (array)
- 0–3 short factual lines from allergensText / clear tokens; empty if none.

parentTakeaway (one line)
- One practical closing line aligned with verdict and age (e.g. "Better occasionally than daily for this age.").

CANONICAL OUTPUT (always include every key; arrays may be empty)
{
  "baseVerdict": "good"|"sometimes"|"avoid"|"unknown",
  "finalVerdict": "good"|"sometimes"|"avoid"|"unknown",
  "summary": string,
  "reasons": string[] (length per resultStyle; see user message),
  "preferenceMatches": string[],
  "nutritionSnapshot": string[],
  "ingredientFlags": string[],
  "ingredientBreakdown": string[],
  "allergyNotes": string[],
  "parentTakeaway": string
}

Never infer cow's milk / dairy from yogurt alone; mention milk/dairy only when explicit in text or allergens.`;

function depthInstructionsForResultStyle(resultStyle: ResultStyle): string {
  if (resultStyle === 'advanced') {
    return `REQUIRED COUNTS FOR THIS REQUEST (input.resultStyle is "advanced"):
- reasons: 5 to 8 strings, each 8–180 characters, all distinct factual points (no filler). Prefer sugar, salt or sodium, saturated fat, sweetening, sweeteners, caffeine, allergens, product-type, ingredient-list complexity when evidence exists—each line must be non-redundant with summary, preferenceMatches, and nutritionSnapshot.
- nutritionSnapshot: include every useful per-100g line supported by nutriments; if partly missing, one honest line is fine—never invent grams.
- ingredientFlags: aim for 5–14 distinct flags when the listing supports them; fewer is fine if evidence is thin.
- ingredientBreakdown: 3 or 4 paragraphs preferred (minimum 2). Each paragraph at least 40 characters, calmer than the bullet list, mini-article feel, still mobile-friendly.
- summary stays one sentence and must not duplicate bullet wording.`;
  }
  return `REQUIRED COUNTS FOR THIS REQUEST (input.resultStyle is "quick"):
- reasons: 3 to 5 strings, each 8–160 characters, factual and compact; each must differ from summary and preferenceMatches (no second sugar line if sugar is already the main story there).
- nutritionSnapshot and ingredientFlags: keep sparse or empty unless a few lines add clear value.
- ingredientBreakdown: 2 or 3 tighter paragraphs (minimum 2), each at least 22 characters; keep composition-focused but shorter than advanced.`;
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
    return getFallbackAiResult(ruleBase, input.resultStyle);
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
            content: `Evaluate this input. Reply with JSON only:\n${JSON.stringify(input)}\n\n${depthInstructionsForResultStyle(input.resultStyle)}`,
          },
        ],
      }),
    });

    console.warn(LOG_PREFIX, 'response status:', response.status);

    const rawText = await response.text();
    console.warn(LOG_PREFIX, 'raw response text:', rawText);

    if (!response.ok) {
      console.warn(LOG_PREFIX, 'using fallback: HTTP not OK, status', response.status);
      return getFallbackAiResult(ruleBase, input.resultStyle);
    }

    let data: { choices?: { message?: { content?: string } }[] };
    try {
      data = JSON.parse(rawText) as { choices?: { message?: { content?: string } }[] };
    } catch (parseBodyErr) {
      console.warn(LOG_PREFIX, 'using fallback: failed to parse response body as JSON:', parseBodyErr);
      return getFallbackAiResult(ruleBase, input.resultStyle);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      console.warn(LOG_PREFIX, 'using fallback: missing or empty choices[0].message.content');
      return getFallbackAiResult(ruleBase, input.resultStyle);
    }

    const parsed = parseJson(content.trim());
    const evaluation = normalizeCanonicalAiPayload(parsed, ruleBase, input.resultStyle);
    if (!evaluation) {
      console.warn(LOG_PREFIX, 'using fallback: evaluation JSON failed validation', { parsed });
      return getFallbackAiResult(ruleBase, input.resultStyle);
    }
    const hadAvoidPrefs = Array.isArray(input.avoidPreferences) && input.avoidPreferences.length > 0;
    if (!hadAvoidPrefs) {
      return {
        ...evaluation,
        preferenceMatches: [],
        verdict: evaluation.baseVerdict,
      };
    }
    return evaluation;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(LOG_PREFIX, 'caught error:', message, err);
    console.warn(LOG_PREFIX, 'using fallback after error');
    return getFallbackAiResult(ruleBase, input.resultStyle);
  }
}
