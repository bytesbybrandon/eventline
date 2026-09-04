'use strict';

const Model = require('./model');

class ParseError extends Error {
  constructor(msg, line) {
    super(`${msg} (line ${line})`);
    this.line = line;
  }
}

function isDSLLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) return false;
  if (/^[-*]/.test(trimmed)) {
    if (/^--\[/.test(trimmed)) return true;
    if (/^->/.test(trimmed)) return true;
    if (/^-\s/.test(trimmed)) return false;
    return false;
  }
  if (/^>\s/.test(trimmed)) return false;
  if (/^[-]{3,}$/.test(trimmed)) return false;
  if (/^[│┌└┬├─═]/.test(trimmed)) return false;
  if (/^\s*\|?\s*[-]{3,}\s*\|/.test(trimmed)) return false;
  if (/^\s*\|/.test(trimmed)) {
    const inner = trimmed.replace(/\|/g, '').trim();
    if (inner.length < 3) return false;
  }
  if (/^#{1,6}\s/.test(trimmed)) return false;
  return true;
}

function parseBlock(lines, startIdx) {
  const content = [];
  let depth = 0;
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    content.push(line);
    if (depth === 0) {
      return { content, endIndex: i + 1 };
    }
    i++;
  }
  throw new ParseError('Unclosed block', startIdx + 1);
}

function parseSystemBlock(blockLines, model) {
  const text = blockLines.join('\n');
  const nameMatch = text.match(/system\s+(\w+)/);
  if (!nameMatch) throw new ParseError('Missing system name', 1);
  model.system = { name: nameMatch[1], externals: [], slo: null, region: null, dataClassification: null };

  const extMatch = text.match(/external:\s*(.+?)(?:\n|$)/);
  if (extMatch) {
    model.system.externals = extMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  }
  const sloMatch = text.match(/slo:\s*(.+?)(?:\n|$)/);
  if (sloMatch) model.system.slo = sloMatch[1].trim();
  const regionMatch = text.match(/region:\s*(.+?)(?:\n|$)/);
  if (regionMatch) model.system.region = regionMatch[1].trim();
  const dcMatch = text.match(/data-classification:\s*(.+?)(?:\n|$)/);
  if (dcMatch) model.system.dataClassification = dcMatch[1].trim();
}

function parseActorLine(line, model) {
  const match = line.match(/^actor\s+(\w+)\s*\{([^}]*)\}/);
  if (!match) return;
  const actor = { name: match[1], attributes: {} };
  const attrText = match[2].trim();
  if (attrText) {
    for (const part of attrText.split(',')) {
      const [k, ...v] = part.trim().split(/[:\s]+/);
      if (k) actor.attributes[k] = v.join(':').trim();
    }
  }
  model.actors.push(actor);
}

function parseBoundaryLine(line, model) {
  const match = line.match(/^boundary\s+(\w+)\(([^)]*)\)/);
  if (!match) return;
  const boundary = {
    name: match[1],
    params: match[2].split(',').map(s => s.trim()).filter(Boolean),
    annotations: {}
  };
  model.boundaries.push(boundary);
}

function parseViewBlock(blockLines, model) {
  const text = blockLines.join(' ');
  const match = text.match(/^view\s+(\w+)\(([^)]*)\)\s*=\s*\[([^\]]*)\]\s*=>\s*\{([^}]*)\}(.*)/);
  if (!match) return;
  const view = {
    name: match[1],
    params: match[2].split(',').map(s => s.trim()).filter(Boolean),
    sources: splitRespectingParens(match[3]),
    shape: match[4].trim(),
    annotations: {},
    raw: blockLines.join('\n')
  };
  const annMatch = match[5].trim();
  if (annMatch) {
    view.annotations.raw = annMatch;
  }
  model.views.push(view);
}

function splitRespectingParens(text) {
  const sources = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      sources.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) sources.push(current.trim());
  return sources.filter(Boolean);
}

function parseCommandBlock(blockLines, model) {
  const firstLine = blockLines[0].trim();
  const headerMatch = firstLine.match(/^(\w+)\s*->\s*(\w+)\(([^)]*)\)/);
  if (!headerMatch) return;

  const command = {
    actor: headerMatch[1],
    name: headerMatch[2],
    params: headerMatch[3].split(',').map(s => s.trim()).filter(Boolean),
    on: [],
    from: [],
    guards: [],
    raw: blockLines.join('\n')
  };

  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i].trim();
    if (line.startsWith('on [')) {
      const inner = line.slice(3).replace(/^\[|\]$/g, '').trim();
      if (inner) command.on.push(...parseFactList(inner));
      continue;
    }
    if (line.startsWith('from [')) {
      const inner = line.slice(5).replace(/^\[|\]$/g, '').trim();
      if (inner) command.from.push(...parseFactList(inner));
      continue;
    }
    if (line.startsWith('--[')) {
      const guardMatch = line.match(/--\[([^\]]+)\]-->\s*\[([^\]]*)\]/);
      if (guardMatch) {
        command.guards.push({
          condition: guardMatch[1].trim(),
          events: guardMatch[2].split(',').map(s => s.trim()).filter(Boolean)
        });
      }
      continue;
    }
  }

  model.commands.push(command);
  model.collectEvents(command.on.map(e => typeof e === 'string' ? e : e.name));
  command.guards.forEach(g => model.collectEvents(g.events));
}

function parseFactList(text) {
  const facts = [];
  const parts = text.split(/,(?![^()]*\))/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const starMatch = trimmed.match(/^(\w+)\*\(([^)]*)\)/);
    if (starMatch) {
      facts.push({ name: starMatch[1], params: starMatch[2], wildcard: true });
    } else {
      const simpleMatch = trimmed.match(/^([\w-]+)\(([^)]*)\)/);
      if (simpleMatch) {
        facts.push({ name: simpleMatch[1], params: simpleMatch[2] });
      } else {
        facts.push(trimmed);
      }
    }
  }
  return facts;
}

function parsePolicyBlock(blockLines, model) {
  const text = blockLines.join(' ');
  const eventMatch = text.match(/^(\S+)\s*\{([^}]*)\}(.*)/);
  if (!eventMatch) return;

  const policy = {
    event: eventMatch[1],
    payload: eventMatch[2].trim(),
    annotations: {},
    guard: null,
    worker: null,
    target: null,
    raw: blockLines.join('\n')
  };

  const remaining = eventMatch[3];
  if (remaining.includes('--[')) {
    const guardMatch = remaining.match(/--\[([^\]]+)\]/);
    if (guardMatch) policy.guard = guardMatch[1].trim();
  }
  const workerMatch = remaining.match(/-->\s*(\S+)\s*->\s*(?:\[([^\]]+)\]|(\w+)\s*\(([^)]*)\))/) ||
                     remaining.match(/->\s*(\S+)\s*->\s*(?:\[([^\]]+)\]|(\w+)\s*\(([^)]*)\))/);
  if (workerMatch) {
    policy.worker = workerMatch[1];
    if (workerMatch[2]) {
      const targetStr = workerMatch[2].trim();
      const targetName = targetStr.split(/\s*\{/)[0].trim();
      policy.target = { name: targetName, params: '' };
    } else if (workerMatch[3]) {
      policy.target = { name: workerMatch[3], params: workerMatch[4] };
    }
  }

  model.policies.push(policy);
  model.addEvent(policy.event);
}

function parse(content) {
  const model = new Model();
  let dslContent = content;

  if (content.includes('```text') || content.includes('```')) {
    const blocks = [];
    const regex = /```(?:text|dsl)?\n?([\s\S]*?)```/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      blocks.push(m[1]);
    }
    if (blocks.length > 0) {
      dslContent = blocks.join('\n');
    }
  }

  const rawLines = dslContent.split('\n');
  const lines = rawLines.filter(isDSLLine);

  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith('system ')) {
      const block = parseBlock(lines, i);
      parseSystemBlock(block.content, model);
      i = block.endIndex;
      continue;
    }

    if (line.startsWith('actor ')) {
      parseActorLine(line, model);
      i++;
      continue;
    }

    if (line.startsWith('boundary ')) {
      parseBoundaryLine(line, model);
      i++;
      continue;
    }

    if (line.startsWith('view ')) {
      const blockLines = [line];
      let j = i + 1;
      while (j < lines.length) {
        const cl = lines[j].trim();
        blockLines.push(cl);
        if (cl.startsWith('view ') || cl.startsWith('boundary ') || cl.startsWith('actor ') || cl.startsWith('system ') || /^\w+\s*->/.test(cl)) {
          break;
        }
        j++;
      }
      parseViewBlock(blockLines, model);
      i = j;
      continue;
    }

    if (line.includes('->') && !line.startsWith('//')) {
      const nextLine = (lines[i + 1] || '').trim();
      if (nextLine.startsWith('on [') || nextLine.startsWith('from [')) {
        const blockLines = [line];
        let j = i + 1;
        while (j < lines.length) {
          const cl = lines[j].trim();
          blockLines.push(cl);
          if (cl.includes('--[') && cl.includes('-->')) {
            j++;
            break;
          }
          if (cl === '' || cl.startsWith('//')) {
            j++;
            continue;
          }
          if (cl.startsWith('view ') || cl.startsWith('boundary ') || cl.startsWith('actor ') || cl.startsWith('system ') || /^\w+\s*->/.test(cl)) {
            break;
          }
          j++;
        }
        parseCommandBlock(blockLines, model);
        i = j;
        continue;
      }
    }

    if (line.includes('{') && !line.includes('->') && !line.startsWith('view') && !line.startsWith('boundary') && !line.startsWith('actor') && !line.startsWith('system')) {
      const nextLine = (lines[i + 1] || '').trim();
      if (nextLine.includes('-->') || nextLine.includes('->')) {
        const blockLines = [line];
        let j = i + 1;
        while (j < lines.length) {
          const cl = lines[j].trim();
          blockLines.push(cl);
          const clNext = (lines[j + 1] || '').trim();
          if (clNext.startsWith('view ') || clNext.startsWith('boundary ') || clNext.startsWith('actor ') || clNext.startsWith('system ') || /^\w+\s*->/.test(clNext) || /^->/.test(clNext)) {
            j++;
            break;
          }
          if (clNext.includes('{') && !clNext.includes('->') && !clNext.startsWith('//')) {
            if ((lines[j + 2] || '').trim().includes('-->') || (lines[j + 2] || '').trim().includes('->')) {
              j++;
              break;
            }
          }
          j++;
        }
        parsePolicyBlock(blockLines, model);
        i = j;
        continue;
      }
    }

    i++;
  }

  return model;
}

module.exports = { parse, ParseError };
