// The LLM call, shared by every AI feature. One prompt in, the model's text
// reply out. Calls Google's Gemini API (generateContent) directly — no
// second provider/fallback; this is a full replacement of the old
// Groq+Cerebras setup, not an additional option alongside it. A 429 from
// Gemini surfaces as-is (see completeChat below).

import chalk from "chalk";
import { CompleteOptions, GeminiSchema } from "./complete-options.js";

import { HttpError } from "../utils/http-error.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || undefined;
// gemini-2.5-flash was the original default here, but confirmed live (Aug 2026) as
// "no longer available to new users" — Google's own 404 error names gemini-3.6-flash as
// the replacement, which is what's used below.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4000;

const GEMINI_BRAND_BLUE = "#4285F4";

if (GEMINI_API_KEY) {
    console.log(chalk.hex(GEMINI_BRAND_BLUE)(`API key is configured for LLM: gemini (${GEMINI_MODEL})`));
}

/**
 * True when an API key is configured, i.e. the AI features are enabled.
 *
 * @returns {boolean} `true` if `GEMINI_API_KEY` is set.
 *
 */
export function hasLlmKeyConfigured(): boolean {
    return Boolean(GEMINI_API_KEY);
}

/** The shape of a Gemini `generateContent` response, as far as this file reads it. */
type GeminiResponse = {
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
};

/**
 * Calls Gemini's `generateContent` endpoint with `prompt` as the only user message and
 * returns the model's raw text reply. May throw (HTTP error, timeout, bad JSON) — callers
 * treat any failure as "no data".
 *
 * Explicitly sets thinking to its lowest level (`thinkingLevel: "minimal"`): Gemini 3 models
 * think by default, and thinking tokens draw from the same `maxOutputTokens` budget as the
 * visible reply — left uncontrolled, it can silently exhaust the budget before any content
 * is produced, the same failure mode Groq's `reasoning_effort: "low"` used to guard against
 * here. Confirmed live: `thinkingBudget` (the Gemini 2.5-era control) is rejected outright
 * with a 400 on Gemini 3 models — `thinkingLevel` (`"minimal"`/`"low"`/`"medium"`/`"high"`)
 * is the Gemini 3 replacement, not just a rename.
 *
 * @param {string} prompt The full prompt to send as the user message.
 * @param {GeminiSchema} [schema] JSON Schema to constrain the reply to, if any.
 * @param {number} maxTokens Maximum tokens the model may generate in its reply.
 * @param {number} timeoutMs How long to wait before aborting the request.
 * @returns {Promise<string>} The model's text reply, or `""` if the response had no content.
 *
 */
async function callGemini(
    prompt: string,
    schema: GeminiSchema | undefined,
    maxTokens: number,
    timeoutMs: number,
): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY ?? "",
                },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: {
                        maxOutputTokens: maxTokens,
                        thinkingConfig: { thinkingLevel: "minimal" },
                        ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
                    },
                }),
                signal: controller.signal,
            },
        );
        if (!res.ok) {
            throw new HttpError(res.status, `Gemini returned HTTP ${res.status}`);
        }
        const data = (await res.json()) as GeminiResponse;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return typeof text === "string" ? text : "";
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Calls Gemini with `prompt` as the only user message and returns its raw text reply.
 * No fallback provider — a `429` (or any other failure) is thrown as-is for the caller to
 * handle (see `sendErrorResponse` in `utils/http-error.ts`).
 *
 * @param {string} prompt The full prompt to send as the user message.
 * @param {CompleteOptions} [options] Overrides for the response schema, max tokens, and the abort timeout.
 * @returns {Promise<string>} The model's text reply, or `""` if the response had no content.
 *
 */
export async function completeChat(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const { schema, maxTokens = DEFAULT_MAX_TOKENS, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    return callGemini(prompt, schema, maxTokens, timeoutMs);
}
