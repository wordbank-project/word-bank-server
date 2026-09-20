import { LRUCache } from "lru-cache";

import { completeChat, hasLlmKeyConfigured } from "./llm.js";

// AI-generated interpretation of a reader's own notes about a book — not a summary of the
// book itself, but an explanation of the meaning/themes behind what the reader wrote down
// happened, in plain language. Same shape as sentences.ts's sentence explanation, but scoped
// to a longer, free-form block of notes.
//
// Cached in memory, keyed by (language, notes) — a hit needs both to match exactly. No TTL,
// same reasoning as sentences.ts: an interpretation of a fixed block of notes never goes
// stale. Repeats are less likely here than sentences.ts's sentence cache (notes are personal,
// free-form text, not drawn from a shared suggested list), but the cache is cheap and guards
// against a user re-submitting the same notes (e.g. a retried request) for free.
//
// Without GEMINI_API_KEY the feature is off and callers get null.
const MAX_CACHE_ENTRIES = Number(process.env.BOOK_NOTES_CACHE_MAX_ENTRIES) || 500;

const cache = new LRUCache<string, string>({ max: MAX_CACHE_ENTRIES });

/**
 * Builds the cache key for a (language, notes) pair.
 *
 * @param {string} language The ISO 639 language code the explanation is in.
 * @param {string} notes The reader's notes being interpreted.
 * @returns {string} The cache key. Safe to join with a colon — language is already
 * regex-validated to `^[a-z]{2,3}$` before reaching this function, so it can never contain one.
 *
 */
function createCacheKey(language: string, notes: string): string {
  return `${language}:${notes}`;
}

/**
 * Checks whether an interpretation for this (language, notes) pair is already cached,
 * without triggering a live call if it isn't. Used by index.ts to set the `X-Cache`
 * response header.
 *
 * @param {string} notes The reader's notes being interpreted.
 * @param {string} language The ISO 639 language code the explanation is in.
 * @returns {boolean} `true` if a cached interpretation exists for this exact pair.
 *
 */
export function isBookNotesCached(notes: string, language: string): boolean {
  return cache.has(createCacheKey(language, notes));
}

/**
 * Builds the prompt asking the model to interpret a reader's notes about a book.
 *
 * @param {string} notes The reader's own notes about what happens in the book.
 * @param {string} language The ISO 639 language code to respond in.
 * @returns {string} The full prompt text.
 *
 */
function bookNotesPrompt(notes: string, language: string): string {
  return [
    "A reader wrote the following notes while reading a book, describing what happens in it.",
    "Explain, in plain language, the meaning behind what these notes describe — the themes,",
    "significance, or interpretation of the events, not just a restatement of them.",
    `Respond in the language with ISO 639 code "${language}".`,
    "Respond with ONLY the explanation — no preamble, no quotes.",
    `Notes: "${notes}"`,
  ].join(" ");
}

/**
 * Asks the model to explain the meaning behind a reader's notes about a book, serving a
 * cached explanation for the same (language, notes) pair when one exists, otherwise
 * calling the model normally.
 *
 * @param {string} notes The reader's own notes about what happens in the book.
 * @param {string} language The ISO 639 language code to respond in.
 * @returns {Promise<string | null>} The explanation, or `null` if the LLM is disabled or the reply was empty.
 *
 */
export async function analyzeBookNotes(notes: string, language: string): Promise<string | null> {
  const key = createCacheKey(language, notes);

  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  if (!hasLlmKeyConfigured()) {
    return null;
  }

  const reply = await completeChat(bookNotesPrompt(notes, language));
  const meaning = reply.trim();

  // Never cache a failed/empty generation.
  if (meaning.length === 0) {
    return null;
  }

  cache.set(key, meaning);

  return meaning;
}
