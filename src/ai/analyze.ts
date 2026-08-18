import { LRUCache } from "lru-cache";

import { completeChat, hasLlmKeyConfigured } from "./llm.js";

// AI-generated plain-language sentence explanations for the app's "Analyze a sentence"
//
// Cached in memory, keyed by (language, sentence) — a hit needs both to match exactly.
// Repeats are common: the app's "TRY ONE SENTENCE" picker draws from /v1/suggestions'
// cached-per-language sentence list (see suggestions.ts), so many users end up analyzing
// the same handful of sentences.
//
// No TTL, unlike suggestions.ts — an explanation never goes stale, so it's reused.
// Without GROQ_API_KEY the feature is off and callers get null.
const MAX_CACHE_ENTRIES = Number(process.env.ANALYZE_CACHE_MAX_ENTRIES) || 500;

const cache = new LRUCache<string, string>({ max: MAX_CACHE_ENTRIES });

/**
 * Builds the cache key for a (language, sentence) pair.
 *
 * @param {string} language The ISO 639 language code the explanation is in.
 * @param {string} sentence The sentence being explained.
 * @returns {string} The cache key. Safe to join with a colon — language 
 * is already regex-validated to `^[a-z]{2,3}$` before reaching this function, so it can never contain one.
 *
 */
function createLanguageSentenceCacheKey(language: string, sentence: string): string {
  return `${language}:${sentence}`;
}

/**
 * Checks whether an explanation for this (language, sentence) pair is already cached,
 * without triggering a live call if it isn't. Used by index.ts to set the `X-Cache`
 * response header.
 *
 * @param {string} sentence The sentence being explained.
 * @param {string} language The ISO 639 language code the explanation is in.
 * @returns {boolean} `true` if a cached explanation exists for this exact pair.
 *
 */
export function isAnalysisCached(sentence: string, language: string): boolean {
  return cache.has(createLanguageSentenceCacheKey(language, sentence));
}

/**
 * Builds the prompt asking the model to explain a sentence in plain language.
 *
 * @param {string} sentence The sentence to explain.
 * @param {string} language The ISO 639 language code to respond in.
 * @returns {string} The full prompt text.
 *
 */
function analysisPrompt(sentence: string, language: string): string {
  return [
    "Explain, in plain language, what the following sentence means.",
    `Respond in the language with ISO 639 code "${language}".`,
    "Respond with ONLY the explanation — no preamble, no quotes.",
    `Sentence: "${sentence}"`,
  ].join(" ");
}

/**
 * Asks the model to explain a sentence in plain language, serving a cached explanation for
 * the same (language, sentence) pair when one exists, otherwise calling the model normally.
 *
 * @param {string} sentence The sentence to explain.
 * @param {string} language The ISO 639 language code to respond in.
 * @returns {Promise<string | null>} The explanation, or `null` if the LLM is disabled or the reply was empty.
 *
 */
export async function analyzeSentence(sentence: string, language: string): Promise<string | null> {
  const key = createLanguageSentenceCacheKey(language, sentence);

  // Check if there is a saved sentence already with the language key.
  // If we there is, return it.
  const cachedSentenceWithLanguage = cache.get(key);
  if (cachedSentenceWithLanguage !== undefined) {
    return cachedSentenceWithLanguage;
  }

  if (!hasLlmKeyConfigured()) {
    return null;
  }

  const reply = await completeChat(analysisPrompt(sentence, language));
  const sentenceMeaning = reply.trim();

  // Never cache a failed/empty generation.
  if (sentenceMeaning.length === 0) {
    return null;
  }

  cache.set(key, sentenceMeaning);

  return sentenceMeaning;
}
