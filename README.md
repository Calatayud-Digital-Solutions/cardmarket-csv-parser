# cardmarket-csv-parser

Parse Magic: The Gathering collection CSV exports from Cardmarket, Moxfield, Manabox, and similar tools into normalized card rows.

The parser detects comma, semicolon, and tab separators, understands quoted fields (including separators, escaped quotes, and newlines inside a field), accepts Spanish and English header aliases, and strips a leading BOM.

`parseCardmarketCsv` keeps the raw card name and set code. Call `cleanCardName`, `normalizeSetCode`, and `normalizeCondition` when you want the same cleanup used before a Scryfall lookup.

## Install

```bash
npm install cardmarket-csv-parser
```

Requires Node.js 18 or newer. The package has no runtime dependencies.

## Usage

```ts
import {
  parseCardmarketCsv,
  parseCardmarketCsvDetailed,
  cleanCardName,
  normalizeSetCode,
  normalizeCondition,
} from 'cardmarket-csv-parser';

const csv = `Nombre;Cantidad;Edición;Precio;Foil
Sol Ring (V.1);2;Commander Masters;12,50;foil`;

const rows = parseCardmarketCsv(csv);
const ring = rows[0];

cleanCardName(ring.name); // "Sol Ring"
normalizeSetCode('XCMM'); // "cmm"
normalizeCondition('EX'); // "LP"

const detailed = parseCardmarketCsvDetailed(csv);
detailed.delimiter; // ";"
detailed.recordCount; // data rows, including rows later dropped for an empty name
```

## API

### `parseCardmarketCsv(text: string): CardmarketRow[]`

Parse a CSV string. Rows with an empty name are dropped. Throws `CsvFormatError` when the header has no name column.

### `parseCardmarketCsvDetailed(text: string): { rows, recordCount, delimiter }`

Same parse, plus the detected delimiter and the number of data records before empty names are dropped.

### `detectDelimiter(text: string): string`

Return `,`, `;`, or a tab. Counts separators outside quotes on the header line.

### `cleanCardName(name: string): string`

Remove a trailing Cardmarket version marker such as `(V.1)`.

### `firstFaceName(name: string): string`

Return the text before the first `//`.

### `scryfallName(name: string): string`

Replace `&` with `and` so Scryfall can match the card.

### `normalizeSetCode(code: string): string`

Lowercase the code and drop a leading `X` from four-letter extended-art codes. `XLN` stays `xln`.

### `normalizeCondition(condition: string): string`

Map marketplace condition codes (`MT`, `NM`, `EX`, `GD`, `LP`, `PL`, `MP`, `HP`, `PO`, `DMG`) to `NM`, `LP`, `MP`, `HP`, or `DMG`. Anything else becomes `NM`.

### `CsvFormatError`

Error thrown when the file has no recognizable name column.

### `CardmarketRow`

`cardmarketId`, `quantity`, `name`, `set`, `setCode`, `cn`, `condition`, `language`, `isFoil`, `price`, `rarity`.

Foil is true for `true`, `foil`, `yes`, `1`, and `X`. Prices may use a comma as the decimal separator.

Used in production by [ManaForge](https://manaforge.tools) — Built by [Calatayud Digital Solutions](https://calatayud-digital-solutions.es)
