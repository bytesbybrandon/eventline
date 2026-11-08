'use strict';

/* Public API: parse a model, check it, draw it. Pure functions, no I/O, safe to bundle for a browser. */
const { parse, ParseError } = require('./parser');
const { check, RULES } = require('./rules');
const { render, KINDS } = require('./diagram');
const { linkMap } = require('./diagram/links');

module.exports = { parse, ParseError, check, RULES, render, linkMap, KINDS };
