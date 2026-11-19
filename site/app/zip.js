(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventlineZip = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t.push(c >>> 0);
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function safeName(name) {
    var base = String(name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\.dsl$/i, '')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 100);
    return (base || 'untitled') + '.dsl';
  }

  // Case-insensitive unique names; -2, -3 ... go before .dsl.
  function exportFiles(models) {
    var used = {};
    return models.map(function (m) {
      var name = safeName(m.name);
      var stem = name.slice(0, -4);
      for (var n = 2; used[name.toLowerCase()]; n++) name = stem + '-' + n + '.dsl';
      used[name.toLowerCase()] = true;
      return { name: name, text: m.text };
    });
  }

  // Stored (method 0) zip; flag bit 11 marks names as UTF-8. No zip64: shortcut, fine below 4 GB.
  function zip(files, date) {
    var enc = new TextEncoder();
    var d = date || new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var entries = files.map(function (f) {
      var data = enc.encode(f.text);
      return { name: enc.encode(f.name), data: data, crc: crc32(data) };
    });
    var size = 22;
    entries.forEach(function (e) { size += 76 + 2 * e.name.length + e.data.length; });
    var out = new Uint8Array(size);
    var v = new DataView(out.buffer);
    var p = 0;
    function u16(x) { v.setUint16(p, x, true); p += 2; }
    function u32(x) { v.setUint32(p, x, true); p += 4; }
    function put(bytes) { out.set(bytes, p); p += bytes.length; }

    entries.forEach(function (e) {
      e.offset = p;
      u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
      u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
      put(e.name); put(e.data);
    });
    var cdStart = p;
    entries.forEach(function (e) {
      u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
      u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length);
      u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
      put(e.name);
    });
    var cdSize = p - cdStart;
    u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length);
    u32(cdSize); u32(cdStart); u16(0);
    return out;
  }

  return { exportFiles: exportFiles, zip: zip };
});
