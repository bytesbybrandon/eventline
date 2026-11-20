'use strict';

class Formatter {
  constructor(format = 'toon') {
    this.format = format;
  }

  /**
   * Rows as TOON text.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(R·F) where R = rows, F = fields (derived by reading the code)
   * - Cyclomatic Complexity (CC): 5 measured; target <= 12
   * - Branch Coverage: 60% measured; target >= 80%
   * - CRAP Score: 6.6 measured; threshold <= 15
   * - Caching: none
   */
  toon(header, rows, fields) {
    if (!rows || rows.length === 0) {
      return `${header}: 0 results\n`;
    }
    const cols = fields || Object.keys(rows[0]);
    let out = `${header}[${rows.length}]{${cols.join(',')}}:\n`;
    for (const row of rows) {
      out += '  ' + cols.map(c => this._cell(row[c])).join(',') + '\n';
    }
    return out;
  }

  /**
   * Data as indented JSON.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(z) where z = size of the data (derived by reading the code)
   * - Cyclomatic Complexity (CC): 1 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 1.0 measured; threshold <= 15
   * - Caching: none
   */
  json(data) {
    return JSON.stringify(data, null, 2) + '\n';
  }

  /**
   * Rows as plain text.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(R·F) where R = rows, F = fields (derived by reading the code)
   * - Cyclomatic Complexity (CC): 5 measured; target <= 12
   * - Branch Coverage: 60% measured; target >= 80%
   * - CRAP Score: 6.6 measured; threshold <= 15
   * - Caching: none
   */
  text(header, rows, fields) {
    if (!rows || rows.length === 0) return `${header}: (empty)\n`;
    const cols = fields || Object.keys(rows[0]);
    let out = `${header}:\n`;
    for (const row of rows) {
      out += cols.map(c => `${c}: ${row[c]}`).join(', ') + '\n';
    }
    return out;
  }

  _cell(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  /**
   * Rows in the chosen format.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(R·F) where R = rows, F = fields (derived by reading the code)
   * - Cyclomatic Complexity (CC): 3 measured; target <= 12
   * - Branch Coverage: 100% measured; target >= 80%
   * - CRAP Score: 3.0 measured; threshold <= 15
   * - Caching: none
   */
  formatOutput(header, rows, fields) {
    switch (this.format) {
      case 'json': return this.json(rows);
      case 'text': return this.text(header, rows, fields);
      default: return this.toon(header, rows, fields);
    }
  }

  /**
   * One object in the chosen format.
   *
   * # Performance & Risk Budget
   * - Tier: P1 (< 300 ms)
   * - Complexity: O(K) where K = keys (derived by reading the code)
   * - Cyclomatic Complexity (CC): 4 measured; target <= 12
   * - Branch Coverage: 50% measured; target >= 80%
   * - CRAP Score: 6.0 measured; threshold <= 15
   * - Caching: none
   */
  formatObject(header, data) {
    if (this.format === 'json') return this.json(data);
    if (this.format === 'text') return this.text(header, [data]);
    const lines = [`${header}:`];
    for (const [k, v] of Object.entries(data)) {
      lines.push(`  ${k}: ${v}`);
    }
    return lines.join('\n') + '\n';
  }
}

module.exports = Formatter;
