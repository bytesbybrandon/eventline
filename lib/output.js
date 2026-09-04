'use strict';

class Formatter {
  constructor(format = 'toon') {
    this.format = format;
  }

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

  json(data) {
    return JSON.stringify(data, null, 2) + '\n';
  }

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

  formatOutput(header, rows, fields) {
    switch (this.format) {
      case 'json': return this.json(rows);
      case 'text': return this.text(header, rows, fields);
      default: return this.toon(header, rows, fields);
    }
  }

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
