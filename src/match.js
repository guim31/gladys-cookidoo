// -----------------------------------------------------------------------------
// Finding an item of the shopping list by its name, as a scene or a voice
// command says it: "Lait", "lait", "du lait", "Œufs" for "oeufs"…
//
// Names are compared without case, accents nor a leading article (en, fr,
// de, es), whitespace collapsed. The exact name wins; otherwise a single
// item whose name starts with, then contains, the asked words.
// -----------------------------------------------------------------------------

const ARTICLES = [
  // Longest first: "de la" before "de", "l'" before "la".
  "de l'",
  'de la',
  'some',
  'the',
  'an',
  'a',
  "l'",
  'les',
  'le',
  'la',
  'du',
  'des',
  'une',
  'un',
  'der',
  'die',
  'das',
  'eine',
  'ein',
  'los',
  'las',
  'el',
  'unos',
  'unas',
  'una',
];

/**
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  let value = String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  for (const article of ARTICLES) {
    const withSpace = article.endsWith("'") ? article : `${article} `;
    if (value.startsWith(withSpace) && value.length > withSpace.length) {
      value = value.slice(withSpace.length).trim();
      break;
    }
  }
  return value;
}

/**
 * The item a name designates, or null.
 * @template {{ name: string, checked: boolean }} T
 * @param {T[]} items
 * @param {string} name
 * @param {{ checked?: boolean }} [prefer] look among the items in this state first
 * @returns {T | null}
 */
export function findItem(items, name, prefer = {}) {
  const wanted = normalizeName(name);
  if (!wanted) {
    return null;
  }
  const pools =
    prefer.checked === undefined
      ? [items]
      : [items.filter((item) => item.checked === prefer.checked), items];
  const tests = [
    (candidate) => candidate === wanted,
    (candidate) => candidate.startsWith(`${wanted} `) || candidate.startsWith(wanted),
    (candidate) => ` ${candidate} `.includes(` ${wanted} `),
  ];
  for (const pool of pools) {
    for (const test of tests) {
      const found = pool.filter((item) => test(normalizeName(item.name)));
      // An ambiguous partial match is no match: checking the wrong item is
      // worse than saying "not found".
      if (found.length === 1 || (found.length > 1 && test === tests[0])) {
        return found[0];
      }
    }
  }
  return null;
}
