// The LLM call, shared by every AI feature. One prompt in, the model's text
// reply out, via Groq's free tier on its OpenAI-compatible chat-completions

import chalk from "chalk";
import { CompleteOptions } from "./complete-options.js";

import { HttpError } from "../utils/http-error.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || undefined;
const MODEL = process.env.SUGGESTIONS_MODEL || "llama-3.3-70b-versatile";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4000;

const QROQ_BRAND_RED = "#F43E01";

if (GROQ_API_KEY) {
    console.log(chalk.hex(QROQ_BRAND_RED)(`API key is configured for LLM: groq (${MODEL})`));
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
 * Calls Groq's chat-completions endpoint with `prompt` as the sole user message
 * and returns the model's raw text reply. May throw (HTTP error, timeout, bad
 * JSON) — callers treat any failure as "no data".
 *
 * @param {string} prompt The full prompt to send as the user message.
 * @param {CompleteOptions} [options] Overrides for JSON mode, max tokens, and the abort timeout.
 * @returns {Promise<string>} The model's text reply, or `""` if the response had no content.
 * 
 */
export async function completeChat(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const { json = false, maxTokens = DEFAULT_MAX_TOKENS, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: maxTokens,
                messages: [{ role: "user", content: prompt }],
                ...(json ? { response_format: { type: "json_object" } } : {}),
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new HttpError(res.status, `Groq returned HTTP ${res.status}`);
        }
        const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
        const text = data?.choices?.[0]?.message?.content;
        return typeof text === "string" ? text : "";
    } finally {
        clearTimeout(timeout);
    }
}
