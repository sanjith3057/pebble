/**
 * Lightweight, dependency-free text embedder ("feature hashing").
 *
 * Turns text into a fixed-size vector from its words, word pairs and
 * 3-letter chunks, so texts that share words or word parts score as similar
 * ("drink water" ~ "drinking more water"). It does NOT understand meaning
 * ("car" vs "automobile"); swap in a neural embedder later through the same
 * `embed(text) => number[]` interface without changing the vector store.
 */

const DIMENSIONS = 512;

const STOPWORDS = new Set(
  'a an the and or but if then of to in on at for with by from is are was were be been am i me my you your we our it its this that these those as do does did so not no yes can will just'.split(' '),
);

/** 32-bit FNV-1a hash. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Very small stemmer: "reminders" -> "reminder", "drinking" -> "drink". */
function stem(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);
}

function embed(text, dimensions = DIMENSIONS) {
  const vector = new Array(dimensions).fill(0);
  const add = (feature, weight) => {
    const hash = fnv1a(feature);
    // The top bit picks the sign, which keeps hash collisions from always adding up.
    vector[hash % dimensions] += hash & 0x80000000 ? -weight : weight;
  };

  const words = tokenize(text);
  words.forEach((word, i) => {
    add(`w:${word}`, 1);
    if (i > 0) add(`b:${words[i - 1]}_${word}`, 0.5);
    const padded = `^${word}$`;
    for (let j = 0; j + 3 <= padded.length; j++) add(`c:${padded.slice(j, j + 3)}`, 0.3);
  });

  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

/** Cosine similarity of two normalized vectors. */
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

module.exports = { DIMENSIONS, embed, cosine, tokenize };
