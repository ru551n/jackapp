/** Piper input: ^ _ (phoneme _)* $ with ids from the model's phoneme_id_map; unknown phonemes are dropped. */
export function phonemesToIds(phonemes: string[], map: Record<string, number[]>): number[] {
  const ids = [...map['^']!, ...map['_']!]
  for (const p of phonemes) if (map[p]) ids.push(...map[p], ...map['_']!)
  return [...ids, ...map['$']!]
}
