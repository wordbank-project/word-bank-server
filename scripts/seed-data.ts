// Shared word list for scripts/seed-test-words.ts and scripts/delete-test-words.ts,

export type SeedWord = {
  word: string;
  definition?: string;
  partOfSpeech?: string;
  phonetic?: string;
};

// A mix of words with full dictionary metadata
// (so WordWall — which only renders rows that have a definition — has something to show)
// and words with no metadata (so the FloatingWords component has something to show)
export const SEED_WORDS: SeedWord[] = [
  { word: "ephemeral", definition: "Lasting for a very short time.", partOfSpeech: "adjective", phonetic: "/ɪˈfɛm(ə)rəl/" },
  { word: "serendipity", definition: "The occurrence of events by chance in a happy way.", partOfSpeech: "noun", phonetic: "/ˌsɛrənˈdɪpɪti/" },
  { word: "luminous", definition: "Full of or shedding light; bright.", partOfSpeech: "adjective", phonetic: "/ˈluːmɪnəs/" },
  { word: "wander", definition: "To walk without a fixed purpose or direction.", partOfSpeech: "verb", phonetic: "/ˈwɒndər/" },
  { word: "solitude", definition: "The state of being alone.", partOfSpeech: "noun", phonetic: "/ˈsɒlɪtjuːd/" },
  { word: "gently", definition: "In a mild, kind, or tender manner.", partOfSpeech: "adverb", phonetic: "/ˈdʒɛntli/" },
  { word: "mosaic", definition: "A picture made from small pieces of colored material.", partOfSpeech: "noun", phonetic: "/məˈzeɪɪk/" },
  { word: "whisper", definition: "To speak very softly.", partOfSpeech: "verb", phonetic: "/ˈwɪspər/" },
  { word: "horizon", definition: "The line at which the earth's surface and the sky appear to meet.", partOfSpeech: "noun", phonetic: "/həˈraɪzən/" },
  { word: "resilient", definition: "Able to recover quickly from difficulties.", partOfSpeech: "adjective", phonetic: "/rɪˈzɪliənt/" },
  { word: "orbit" },
  { word: "quiet" },
  { word: "meadow" },
  { word: "velvet" },
  { word: "amber" },
  { word: "drift" },
  { word: "linger" },
  { word: "hollow" },
  { word: "ember" },
  { word: "murmur" },
  { word: "cascade" },
  { word: "tender" },
  { word: "flicker" },
  { word: "distant" },
  { word: "harbor" },
  { word: "wisdom" },
  { word: "bloom" },
  { word: "shelter" },
  { word: "glimpse" },
  { word: "wander" }, // add the same word, to demonstrate count incrementing
];
