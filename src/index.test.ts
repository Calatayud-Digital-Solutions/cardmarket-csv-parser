import { describe, expect, it } from 'vitest';
import {
  CsvFormatError,
  cleanCardName,
  detectDelimiter,
  firstFaceName,
  normalizeCondition,
  normalizeSetCode,
  parseCardmarketCsv,
  parseCardmarketCsvDetailed,
  scryfallName,
} from './index';

describe('parseCardmarketCsv delimiters', () => {
  it('parses comma-separated Cardmarket rows', () => {
    const text = [
      'Name,Quantity,Set,Set Code,Collector Number,Condition,Language,Foil,Price,Rarity,Cardmarket Id',
      'Lightning Bolt,4,Limited Edition Alpha,LEA,161,NM,EN,false,0.50,uncommon,123',
    ].join('\n');

    const detailed = parseCardmarketCsvDetailed(text);

    expect(detailed.delimiter).toBe(',');
    expect(detectDelimiter(text)).toBe(',');
    expect(detailed.recordCount).toBe(1);
    expect(detailed.rows).toEqual([
      {
        cardmarketId: '123',
        quantity: 4,
        name: 'Lightning Bolt',
        set: 'Limited Edition Alpha',
        setCode: 'lea',
        cn: '161',
        condition: 'NM',
        language: 'EN',
        isFoil: false,
        price: 0.5,
        rarity: 'uncommon',
      },
    ]);
  });

  it('parses semicolon-separated European exports', () => {
    const text = 'Name;Quantity;Set\nCounterspell;2;Limited Edition Alpha';
    const detailed = parseCardmarketCsvDetailed(text);

    expect(detailed.delimiter).toBe(';');
    expect(detailed.rows[0]).toMatchObject({ name: 'Counterspell', quantity: 2, set: 'Limited Edition Alpha' });
  });

  it('parses tab-separated exports', () => {
    const text = 'Name\tQuantity\tSet\nBirds of Paradise\t1\tLimited Edition Alpha';
    const detailed = parseCardmarketCsvDetailed(text);

    expect(detailed.delimiter).toBe('\t');
    expect(detailed.rows[0]).toMatchObject({ name: 'Birds of Paradise', quantity: 1 });
  });
});

describe('quoted fields', () => {
  it('keeps a separator that appears inside quotes', () => {
    const rows = parseCardmarketCsv('Name,Quantity\n"Lightning Bolt, reprinted",3');
    expect(rows[0]).toMatchObject({ name: 'Lightning Bolt, reprinted', quantity: 3 });
  });

  it('unescapes doubled quotes', () => {
    const rows = parseCardmarketCsv('Name,Quantity\n"Say ""Bolt""",2');
    expect(rows[0]).toMatchObject({ name: 'Say "Bolt"', quantity: 2 });
  });

  it('keeps newlines that appear inside a quoted field', () => {
    const rows = parseCardmarketCsv('Name,Quantity\n"Alpha\nBeta",7');
    expect(rows[0]).toMatchObject({ name: 'Alpha\nBeta', quantity: 7 });
  });
});

describe('headers and name cleanup', () => {
  it('parses a file that starts with a BOM', () => {
    const rows = parseCardmarketCsv('\uFEFFName,Quantity\nLightning Bolt,2');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Lightning Bolt', quantity: 2 });
  });

  it('accepts Spanish header aliases and a comma decimal price', () => {
    const text = [
      'Nombre;Cantidad;Edición;Estado;Idioma;Rareza;Precio;Foil',
      'Relámpago;2;Dominaria;EX;ES;rare;12,50;foil',
    ].join('\n');
    const rows = parseCardmarketCsv(text);

    expect(rows[0]).toMatchObject({
      name: 'Relámpago',
      quantity: 2,
      set: 'Dominaria',
      condition: 'EX',
      language: 'ES',
      rarity: 'rare',
      price: 12.5,
      isFoil: true,
    });
  });

  it('strips a trailing Cardmarket version marker such as (V.1)', () => {
    expect(cleanCardName('Sol Ring (V.1)')).toBe('Sol Ring');
    expect(cleanCardName('Sol Ring (v.12)')).toBe('Sol Ring');
    expect(cleanCardName('Sol Ring (V.1) ')).toBe('Sol Ring');
    expect(cleanCardName('Name (V.1) extra')).toBe('Name (V.1) extra');

    const rows = parseCardmarketCsv('Name,Quantity\nSol Ring (V.1),1');
    expect(cleanCardName(rows[0]?.name ?? '')).toBe('Sol Ring');
  });
});

describe('set codes, foil, and condition helpers', () => {
  it('drops an extended-art X prefix and keeps XLN', () => {
    expect(normalizeSetCode('XBRO')).toBe('bro');
    expect(normalizeSetCode('xm21')).toBe('m21');
    expect(normalizeSetCode('xln')).toBe('xln');
    expect(normalizeSetCode('XLN')).toBe('xln');
    expect(normalizeSetCode('DOM')).toBe('dom');
  });

  it('treats true, foil, yes, 1, and X as foil', () => {
    const text = [
      'Name,Foil',
      'True Card,true',
      'Foil Card,foil',
      'Yes Card,yes',
      'One Card,1',
      'X Card,X',
      'No Card,no',
    ].join('\n');
    const flags = Object.fromEntries(parseCardmarketCsv(text).map(row => [row.name, row.isFoil]));

    expect(flags).toEqual({
      'True Card': true,
      'Foil Card': true,
      'Yes Card': true,
      'One Card': true,
      'X Card': true,
      'No Card': false,
    });
  });

  it('maps marketplace condition codes', () => {
    expect(normalizeCondition('EX')).toBe('LP');
    expect(normalizeCondition('PO')).toBe('DMG');
    expect(normalizeCondition('NM')).toBe('NM');
    expect(normalizeCondition('mint')).toBe('NM');
  });

  it('normalizes double-faced names and ampersands', () => {
    expect(firstFaceName('Fire // Ice')).toBe('Fire');
    expect(scryfallName('Tokka & Rahzar')).toBe('Tokka and Rahzar');
  });
});

describe('rejected and empty input', () => {
  it('throws CsvFormatError when the name column is missing', () => {
    const parse = () => parseCardmarketCsv('Quantity,Set\n1,LEA');
    expect(parse).toThrow(CsvFormatError);
    expect(parse).toThrow(/name and quantity/i);
  });

  it('returns no rows for an empty file', () => {
    expect(parseCardmarketCsv('')).toEqual([]);
    expect(parseCardmarketCsv('\n\n')).toEqual([]);
    expect(parseCardmarketCsv('Name,Quantity\n')).toEqual([]);
    expect(parseCardmarketCsvDetailed('').recordCount).toBe(0);
  });

  it('drops data rows that have no card name and still counts them', () => {
    const detailed = parseCardmarketCsvDetailed('Name,Quantity\nBolt,2\n,5\n   ,3\nIsland,1');

    expect(detailed.recordCount).toBe(4);
    expect(detailed.rows.map(row => row.name)).toEqual(['Bolt', 'Island']);
    expect(parseCardmarketCsv('Name,Quantity\nBolt,2\n,5\nIsland,1').map(row => row.name)).toEqual(['Bolt', 'Island']);
  });
});
