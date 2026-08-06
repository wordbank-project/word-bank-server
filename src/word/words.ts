import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { WordMeta } from "./word-meta.js";
import { FeedWord } from "./feed-word.js";

// Open (or create) the database file.
const dbPath = process.env.DB_PATH ?? "./data/words.db";
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

// Enable Write-Ahead Logging (WAL) mode for better concurrency and performance.
db.exec("PRAGMA journal_mode = WAL");

// Make sure the "words" table exists. This only runs once, on startup.
// word: the saved word itself, and the primary key (one row per distinct word)
// count: how many times this word has been saved
// definition/part_of_speech/phonetic: optional public dictionary metadata (WordWall)
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    word TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    definition TEXT,
    part_of_speech TEXT,
    phonetic TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

// Migrate older DBs in place: add the metadata columns if they're missing.
// (CREATE TABLE above only adds them for fresh databases.)
const existingColumns = new Set(
  (db.prepare(`PRAGMA table_info(words)`).all() as { name: string }[]).map((c) => c.name)
);
for (const column of ["definition", "part_of_speech", "phonetic"]) {
  if (!existingColumns.has(column)) {
    db.exec(`ALTER TABLE words ADD COLUMN ${column} TEXT`);
  }
}

// On a brand new word, insert it with count = 1. On a repeat, increment count
// and refresh updated_at instead of inserting a second row for the same word.
// COALESCE means a new non-null metadata value overwrites, but a new null never
// erases a previously-stored one.
const upsertWordStatement = db.prepare(
  `INSERT INTO words (word, count, definition, part_of_speech, phonetic, created_at, updated_at)
   VALUES (@word, 1, @definition, @partOfSpeech, @phonetic, @now, @now)
   ON CONFLICT(word) DO UPDATE SET
     count = count + 1,
     definition = COALESCE(excluded.definition, definition),
     part_of_speech = COALESCE(excluded.part_of_speech, part_of_speech),
     phonetic = COALESCE(excluded.phonetic, phonetic),
     updated_at = excluded.updated_at`
);

// For the "recent" feed, get the most-recently-updated words first.
const getRecentWordStatement = db.prepare(
  `SELECT word, count, definition, part_of_speech AS partOfSpeech, phonetic
   FROM words ORDER BY updated_at DESC LIMIT ?`
);

// For the "top" feed, get the most-saved words first (and break ties by most-recently-updated).
const getTopWordStatement = db.prepare(
  `SELECT word, count, definition, part_of_speech AS partOfSpeech, phonetic
   FROM words ORDER BY count DESC, updated_at DESC LIMIT ?`
);

/**
 * Validates and normalizes a submitted word: trims, lowercases, 
 * and rejects empty, too-long, link-like content.
 *
 * @param {unknown} raw The raw `word` value from the request body.
 * @returns {string | null} The normalized word, or `null` if it fails validation.
 * 
 */
export function sanitizeWord(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const word = raw.trim().toLowerCase();
  if (word.length === 0) {
    return null;
  }
  if (word.length > 60) {
    return null;
  }
  if (word.includes("://") || word.includes("http") || word.includes("@")) {
    return null;
  }
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '-]*$/u.test(word)) {
    return null;
  }
  return word;
}

/**
 * Validates and cleans optional dictionary metadata: trims, collapses whitespace,
 * and rejects empty or link-like content.
 *
 * @param {unknown} raw The raw metadata value from the request body.
 * @param {number} max The maximum length to keep, in characters.
 * @returns {string | null} The cleaned text, or `null` if it fails validation.
 * 
 */
export function sanitizeText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const text = raw.replace(/\s+/g, " ").trim().slice(0, max);
  if (text.length === 0) {
    return null;
  }
  if (text.includes("://") || text.includes("http")) {
    return null;
  }
  return text;
}

/**
 * Inserts a new word or increments an existing one's count, 
 * along with optional dictionary metadata.
 *
 * @param {string} word The word to save
 * @param {WordMeta} [meta] Optional dictionary metadata
 * @returns {void} Returns nothing; writes the row to the `words` table.
 * 
 */
export function upsertWord(word: string, meta: WordMeta = {}): void {
  const now = Date.now();
  upsertWordStatement.run({
    word,
    definition: meta.definition ?? null,
    partOfSpeech: meta.partOfSpeech ?? null,
    phonetic: meta.phonetic ?? null,
    now,
  });
}

/**
 * Reads back saved words, most-recent or most-saved first.
 *
 * @param {number} limit The maximum number of words to return.
 * @param {"recent" | "top"} order `"recent"` for most-recently-updated first, `"top"` for most-saved first.
 * @returns {FeedWord[]} The matching words, in the requested order.
 *
 */
export function getWords(limit: number, order: "recent" | "top"): FeedWord[] {
  const wordsStatement = order === "top" ? getTopWordStatement : getRecentWordStatement;
  return wordsStatement.all(limit) as FeedWord[];
}

/**
 * Deletes one or more words from the database. Testing/dev convenience only
 * Used by `scripts/delete-word.ts` and `scripts/delete-test-words.ts`
 *
 * @param {string[]} words The word(s) to delete.
 * @returns {number} The number of rows deleted.
 *
 */
export function deleteWords(words: string[]): number {
  if (words.length === 0) {
    return 0;
  }

  const placeholders = words.map(() => "?").join(", ");
  const result = db.prepare(`DELETE FROM words WHERE word IN (${placeholders})`).run(...words);
  // node:sqlite types `changes` as `number | bigint` (better-sqlite3 was always `number`) —
  // a word-deletion count will never be remotely large enough to need bigint precision.
  return Number(result.changes);
}
