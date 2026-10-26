export interface CardmarketRow {
  cardmarketId: string;
  quantity: number;
  name: string;
  set: string;
  setCode: string;
  cn: string;
  condition: string;
  language: string;
  isFoil: boolean;
  price: number;
  rarity: string;
}

export interface CardmarketCsvParseResult {
  rows: CardmarketRow[];
  recordCount: number;
  delimiter: string;
}

const CONDITION_MAP: Record<string, string> = {
  MT: 'NM', NM: 'NM', EX: 'LP', GD: 'LP', LP: 'LP',
  PL: 'MP', MP: 'MP', HP: 'HP', PO: 'DMG', DMG: 'DMG',
};

const UNRECOGNIZED_FORMAT_MESSAGE =
  'Unrecognized file format. Make sure it includes name and quantity columns, or export it directly from Moxfield, Manabox, Cardmarket, or MTG Arena.';

/** Strip Cardmarket version markers like (V.1) from card names. */
export function cleanCardName(name: string): string {
  return name.replace(/\s*\(V\.\d+\)\s*$/i, '').trim();
}

/** Get the first face name for double-faced cards. */
export function firstFaceName(name: string): string {
  return name.split('//')[0].trim();
}

/** Scryfall does not match names that contain `&` (for example "Tokka & Rahzar"); normalize them to `and`. */
export function scryfallName(name: string): string {
  return name.replace(/\s*&\s*/g, ' and ');
}

/**
 * Cardmarket sometimes prefixes extended-art set codes with X.
 * Real four-letter codes that start with X, such as XLN (Ixalan), are kept.
 */
export function normalizeSetCode(code: string): string {
  const realXSets = new Set(['xln']);
  const lower = code.toLowerCase();
  if (lower.startsWith('x') && lower.length === 4 && !realXSets.has(lower)) {
    return lower.slice(1);
  }
  return lower;
}

/** Map a marketplace condition code onto NM, LP, MP, HP, or DMG. Unknown codes become NM. */
export function normalizeCondition(condition: string): string {
  return CONDITION_MAP[condition] || 'NM';
}

/**
 * Detect the field separator by counting occurrences (outside quotes) in the
 * header line. Moxfield and Cardmarket use ',', many European exports use ';',
 * and some tools export tab-separated files.
 */
export function detectDelimiter(text: string): string {
  const firstLines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '').slice(0, 2);
  const header = firstLines[0] || '';
  const countOutsideQuotes = (line: string, ch: string) => {
    let inQuotes = false;
    let count = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && c === ch) count++;
    }
    return count;
  };
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const delimiter of candidates) {
    const count = countOutsideQuotes(header, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC 4180 CSV tokenizer over the whole file: quoted fields may contain
 * the separator, escaped quotes ("") and newlines.
 */
function parseCsvRecords(text: string, delimiter = ','): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;
  let started = false;

  const pushField = () => {
    row.push(current);
    current = '';
    started = true;
  };
  const pushRow = () => {
    pushField();
    if (row.some(field => field.trim() !== '')) records.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      pushRow();
      continue;
    }
    current += ch;
  }
  if (current !== '' || row.length > 0 || started) pushRow();
  return records;
}

/** Accepted header aliases per field, across Cardmarket, Moxfield, Manabox, and Spanish exports. */
const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'card name', 'card_name', 'cardname', 'nombre', 'nombre carta', 'nombre de carta', 'card', 'english name', 'card name en', 'simple name', 'carta'],
  quantity: ['quantity', 'amount', 'qty', 'count', 'cantidad', 'copies', 'have', 'tradelist count', 'total qty', 'num', 'number of copies'],
  set: ['set', 'set name', 'expansion', 'expansion name', 'edicion', 'edición'],
  setCode: ['setcode', 'set_code', 'set code', 'set id', 'setid', 'edition', 'edition code', 'expansion code'],
  cn: ['cn', 'collector number', 'collector_number', 'card number', 'number'],
  condition: ['condition', 'cond', 'estado'],
  language: ['language', 'lang', 'idioma'],
  isFoil: ['isfoil', 'is_foil', 'foil', 'printing', 'finish'],
  price: ['price', 'purchase price', 'precio'],
  rarity: ['rarity', 'rareza'],
  cardmarketId: ['cardmarketid', 'cardmarket_id', 'cardmarket id'],
};

/**
 * Header keys are compared with punctuation and spacing removed, so
 * "Card Name", "card_name", and "cardName" all resolve to the same field.
 */
const normalizeHeaderKey = (raw: string) =>
  raw
    .replace(/^\uFEFF/, '')
    .replace(/"/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ]+/g, '');

export class CsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvFormatError';
  }
}

function foilValue(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === 'foil' || value === 'yes' || value === '1' || raw.trim() === 'X';
}

export function parseCardmarketCsvDetailed(text: string): CardmarketCsvParseResult {
  const delimiter = detectDelimiter(text);
  const records = parseCsvRecords(text, delimiter);
  if (records.length < 2) {
    return { rows: [], recordCount: 0, delimiter };
  }

  const headers = records[0].map(normalizeHeaderKey);
  const idx = (field: string) => {
    const aliases = HEADER_ALIASES[field] || [field];
    for (const alias of aliases) {
      const index = headers.indexOf(normalizeHeaderKey(alias));
      if (index >= 0) return index;
    }
    return -1;
  };
  const iQty = idx('quantity');
  const iName = idx('name');
  const iSet = idx('set');
  const iSetCode = idx('setCode');
  const iCn = idx('cn');
  const iCond = idx('condition');
  const iLang = idx('language');
  const iFoil = idx('isFoil');
  const iPrice = idx('price');
  const iRarity = idx('rarity');
  const iCmId = idx('cardmarketId');

  if (iName < 0) {
    throw new CsvFormatError(UNRECOGNIZED_FORMAT_MESSAGE);
  }

  const dataRecords = records.slice(1);
  const rows = dataRecords.map((cols): CardmarketRow => ({
    cardmarketId: cols[iCmId] || '',
    quantity: parseInt(cols[iQty] ?? '', 10) || 1,
    name: (cols[iName] || '').trim(),
    set: cols[iSet] || '',
    setCode: (cols[iSetCode] || '').toLowerCase(),
    cn: cols[iCn] || '',
    condition: cols[iCond] || 'NM',
    language: cols[iLang] || '',
    isFoil: foilValue(cols[iFoil] || ''),
    price: parseFloat(String(cols[iPrice] || '').replace(',', '.')) || 0,
    rarity: (cols[iRarity] || 'common').toLowerCase(),
  })).filter(row => row.name.length > 0);

  return { rows, recordCount: dataRecords.length, delimiter };
}

export function parseCardmarketCsv(text: string): CardmarketRow[] {
  return parseCardmarketCsvDetailed(text).rows;
}
