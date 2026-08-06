// Dev/test convenience: removes exactly the words scripts/seed-test-words.ts
// adds (see scripts/data/seed-data.ts) — not every saved word — so this is
// safe to run even if the database also has real words saved from the app.
// Talks to the database file directly (via words.ts's deleteWords), so it
// works even if the server isn't running. Irreversible for the seeded words.
//
// Usage:
//   npm run delete-test-words

import { deleteWords } from "../src/word/words.js";
import { SEED_WORDS } from "./seed-data.js";

const words = [...new Set(SEED_WORDS.map((entry: { word: string }) => entry.word))];
const deleted = deleteWords(words);
console.log(`Deleted ${deleted} word(s) from the database.`);
