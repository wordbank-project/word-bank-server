/// <reference types="node" />

// Dev/test convenience: POSTs a batch of distinct words to a running server so
// you have something to look at in GET /words, GET /stats, and the site's
// FloatingWords/WordWall components without manually saving words from
// the app one at a time. Pairs with `npm run delete-test-words`, which removes
// exactly this same word list (see scripts/data/seed-data.ts) rather than
// wiping the entire table.
//
// Usage:
//   npm run seed-test-words            # sends all words below
//   npm run seed-test-words -- 10      # sends only the first 10

import { SEED_WORDS } from "./seed-data.js";

const BASE_API_URL = process.env.API_URL ?? "http://localhost:4000/v1";

/**
 * Sends an amount of words to the running server, logging each response.
 *
 * @param {number} count How many words to send (from the start of SEED_WORDS).
 * @returns {Promise<void>} Resolves when all requests have completed.
 *
 */
async function seedWords(count: number): Promise<void> {
  const amountOfWords = SEED_WORDS.slice(0, count);
  console.log(`Seeding ${amountOfWords.length} word(s) into ${BASE_API_URL} ...`);

  for (const entry of amountOfWords) {
    try {
      const res = await fetch(`${BASE_API_URL}/words`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
      });
      const body = await res.json();
      console.log(`${res.status} ${entry.word}`, body);
    } catch (err: string | Error | unknown) {
      console.error(`Failed to save "${entry.word}": is the server running at ${BASE_API_URL}?`, err);
      return;
    }
  }
}

const requestedCount: number = Number(process.argv[2]);
const actualSeedCount: number =
  Number.isFinite(requestedCount) && requestedCount > 0 ? Math.floor(requestedCount) : SEED_WORDS.length;

if (Number.isFinite(requestedCount) && requestedCount > SEED_WORDS.length) {
  console.warn(`Only ${SEED_WORDS.length} seed words available; sending all of them.`);
}

seedWords(actualSeedCount);
