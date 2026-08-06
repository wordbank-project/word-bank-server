/** Optional public dictionary metadata attached to a saved word. 
 * Gets shown in the word wall for "Words users have currently saved":
*/

export type WordMeta = {
    /** The word's public dictionary definition, if known. */
    definition?: string | null;
    /** The word's part of speech, if known. */
    partOfSpeech?: string | null;
    /** The word's IPA phonetic spelling, if known. */
    phonetic?: string | null;
};