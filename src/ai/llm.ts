// The LLM call, shared by every AI feature. One prompt in, the model's text
// reply out. Groq's free tier is primary; if Groq returns a 429 on /v1/suggestions or /v1/analyze,
// and CEREBRAS_API_KEY is configured, one retry goes to Cerebras's free tier.
// Both are OpenAI-compatible chat-completions endpoints.

import chalk from "chalk";
import { CompleteOptions } from "./complete-options.js";

import { HttpError } from "../utils/http-error.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || undefined;
const MODEL = process.env.SUGGESTIONS_MODEL || "openai/gpt-oss-120b";

// Optional key. Used as fallback model for now.
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY?.trim() || undefined;
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "gpt-oss-120b";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4000;

const QROQ_BRAND_RED = "#F55036";
const CEREBRAS_BRAND_ORANGE = "#FF6B00";

if (GROQ_API_KEY) {
    console.log(chalk.hex(QROQ_BRAND_RED)(`API key is configured for LLM: groq (${MODEL})`));
}
// Fallback Cerebras API key is also configured
if (GROQ_API_KEY && CEREBRAS_API_KEY) {
    console.log(chalk.hex(CEREBRAS_BRAND_ORANGE)(`Cerebras fallback API key is configured for 429 rate limits: cerebras (${CEREBRAS_MODEL})`));
}

/**
 * True when an API key is configured, i.e. the AI features are enabled.
 *
 * @returns {boolean} `true` if `GROQ_API_KEY` is set.
 *
 */
export function hasLlmKeyConfigured(): boolean {
    return Boolean(GROQ_API_KEY);
}

/**
 * Calls one OpenAI-compatible chat-completions endpoint with `prompt` 
 * as the only user message and returns the model's raw text reply. 
 * May throw (HTTP error, timeout, bad JSON) — callers treat any failure as "no data".
 *
 * @param {string} baseUrl The provider's chat-completions endpoint URL.
 * @param {string} apiKey The bearer token for that provider.
 * @param {string} modelName The model name to request.
 * @param {string} providerLabel Human-readable provider name, used only in the thrown error message.
 * @param {string} prompt The full prompt to send as the user message.
 * @param {boolean} json Whether to ask for JSON-object mode.
 * @param {number} maxTokens Maximum tokens the model may generate in its reply.
 * @param {number} timeoutMs How long to wait before aborting the request.
 * @returns {Promise<string>} The model's text reply, or `""` if the response had no content.
 *
 */
async function callModelprovider(
    baseUrl: string,
    apiKey: string,
    modelName: string,
    providerNameLabel: string,
    prompt: string,
    json: boolean,
    maxTokens: number,
    timeoutMs: number,
): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(baseUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelName,
                max_tokens: maxTokens,
                messages: [{ role: "user", content: prompt }],
                ...(json ? { response_format: { type: "json_object" } } : {}),
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new HttpError(res.status, `${providerNameLabel} returned HTTP ${res.status}`);
        }
        const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
        const text = data?.choices?.[0]?.message?.content;
        return typeof text === "string" ? text : "";
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Calls the Groq AI service first; 
 * if Groq specifically returns a 429 and CEREBRAS_API_KEY is configured, 
 * retries once via the Cerebras AI service instead. 
 * Any other errors get thrown as-is.
 *
 * @param {string} prompt The full prompt to send as the user message.
 * @param {CompleteOptions} [options] Overrides for JSON mode, max tokens, and the abort timeout.
 * @returns {Promise<string>} The model's text reply, or `""` if the response had no content.
 *
 */
export async function completeChat(prompt: string, options: CompleteOptions = {}): Promise<string> {
    // Defaults json to false: analyze.ts wants human senteces (its prompt never says "json", 
    // which JSON mode requires), and suggestions.ts wants a top-level JSON array, not the json object
    const { json = false, maxTokens = DEFAULT_MAX_TOKENS, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    try {
        return await callModelprovider(
            "https://api.groq.com/openai/v1/chat/completions",
            GROQ_API_KEY ?? "",
            MODEL,
            "Groq",
            prompt,
            json,
            maxTokens,
            timeoutMs,
        );
    } catch (err: unknown) {
        if (CEREBRAS_API_KEY && err instanceof HttpError && err.status === 429) {
            return callModelprovider(
                "https://api.cerebras.ai/v1/chat/completions",
                CEREBRAS_API_KEY,
                CEREBRAS_MODEL,
                "Cerebras",
                prompt,
                json,
                maxTokens,
                timeoutMs,
            );
        }
        // Any other errors
        throw err;
    }
}
