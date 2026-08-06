// Dev/test convenience: deletes one or more arbitrary words directly from
// the database, by name. Unlike delete-test-words.ts (which only removes the
// fixed seed list), this takes any word(s) given on the command line. Talks to the
// database file directly (via words.ts's deleteWords), so it works even if
// the server isn't running. IRREVERSIBLE.
//
// Usage:
//   npm run delete-word -- badword anotherword

import { deleteWords } from "../src/word/words.js";

const words = process.argv.slice(2);
if (words.length === 0) {
  console.error("Usage: npm run delete-word -- <word> [word2] [word3] ...");
  process.exit(1);
}

const deleted = deleteWords(words);
console.log(`Deleted ${deleted} word(s) from the database.`);
