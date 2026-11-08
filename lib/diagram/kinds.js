'use strict';

const KINDS = ['eventmodel', 'context', 'containers', 'dataflow', 'deployment', 'contextmap'];
const FORMATS = { svg: 'svg', mermaid: 'mmd', dot: 'dot' };
/* How a diagram is named to a person, in a link's tooltip. */
const NAMES = { eventmodel: 'event model', context: 'system context', containers: 'containers', dataflow: 'data flow', deployment: 'deployment', contextmap: 'context map' };

module.exports = { KINDS, FORMATS, NAMES };
