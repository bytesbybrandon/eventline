'use strict';

/* Public API: parse a model, check it, draw it. Pure functions, no I/O, safe to bundle for a browser. */
const { parse, ParseError } = require('./parser');
const { check } = require('./commands/validate');
const { render, KINDS } = require('./diagram');

module.exports = { parse, ParseError, check, render, KINDS };
