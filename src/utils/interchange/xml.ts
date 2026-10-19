/** Small XML reader and writer for FCPXML and xmeml. */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body] ?? all;
  });
}

function localName(name: string): string {
  const index = name.lastIndexOf(':');
  return index >= 0 ? name.slice(index + 1) : name;
}

export function el(name: string, attrs: Record<string, string> = {}, children: XmlNode[] | string = []): XmlNode {
  if (typeof children === 'string') return { name, attrs, children: [], text: children };
  return { name, attrs, children, text: '' };
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((item) => item.name === name);
}

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((item) => item.name === name);
}

export function childText(node: XmlNode, name: string): string {
  return child(node, name)?.text ?? '';
}

export function findAll(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = [];
  const walk = (current: XmlNode) => {
    if (current.name === name) found.push(current);
    current.children.forEach(walk);
  };
  walk(node);
  return found;
}

function skipNoise(source: string, index: number): number {
  let cursor = index;
  for (;;) {
    while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4);
      cursor = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', cursor)) {
      const end = source.indexOf('?>', cursor + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith('<!DOCTYPE', cursor) || source.startsWith('<!doctype', cursor)) {
      cursor += 9;
      let depth = 0;
      while (cursor < source.length) {
        const char = source[cursor];
        if (char === '[') depth += 1;
        else if (char === ']') depth = Math.max(0, depth - 1);
        else if (char === '>' && depth === 0) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      continue;
    }
    return cursor;
  }
}

function parseAttributes(source: string, index: number): { attrs: Record<string, string>; index: number } {
  const attrs: Record<string, string> = {};
  let cursor = index;
  while (cursor < source.length) {
    cursor = skipNoise(source, cursor);
    if (source[cursor] === '>' || source.startsWith('/>', cursor)) break;
    const match = /^([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(source.slice(cursor));
    if (!match) throw new Error('Invalid XML attribute');
    attrs[localName(match[1])] = decodeXml(match[3] ?? match[4] ?? '');
    cursor += match[0].length;
  }
  return { attrs, index: cursor };
}

function parseNodes(source: string, index: number, until: string | null): { nodes: XmlNode[]; text: string; index: number } {
  const nodes: XmlNode[] = [];
  let text = '';
  let cursor = index;
  while (cursor < source.length) {
    if (until && source.startsWith(`</${until}`, cursor)) break;
    cursor = skipNoise(source, cursor);
    if (until && source.startsWith(`</${until}`, cursor)) break;
    if (cursor >= source.length) break;
    if (source.startsWith('<![CDATA[', cursor)) {
      const end = source.indexOf(']]>', cursor + 9);
      if (end === -1) throw new Error('Unclosed CDATA section');
      text += source.slice(cursor + 9, end);
      cursor = end + 3;
      continue;
    }
    if (source[cursor] !== '<') {
      const next = source.indexOf('<', cursor);
      const chunk = source.slice(cursor, next === -1 ? source.length : next);
      text += chunk;
      cursor += chunk.length;
      continue;
    }
    if (source.startsWith('</', cursor)) break;
    const parsed = parseElement(source, cursor);
    nodes.push(parsed.node);
    cursor = parsed.index;
  }
  return { nodes, text: decodeXml(text).trim(), index: cursor };
}

function parseElement(source: string, index: number): { node: XmlNode; index: number } {
  let cursor = skipNoise(source, index);
  if (source[cursor] !== '<') throw new Error('Expected an XML element');
  cursor += 1;
  const nameMatch = /^([A-Za-z_:][\w:.-]*)/.exec(source.slice(cursor));
  if (!nameMatch) throw new Error('Invalid XML tag');
  const rawName = nameMatch[1];
  cursor += rawName.length;
  const attributes = parseAttributes(source, cursor);
  cursor = attributes.index;
  cursor = skipNoise(source, cursor);
  if (source.startsWith('/>', cursor)) {
    return {
      node: { name: localName(rawName), attrs: attributes.attrs, children: [], text: '' },
      index: cursor + 2,
    };
  }
  if (source[cursor] !== '>') throw new Error(`Unclosed tag <${rawName}>`);
  cursor += 1;
  const body = parseNodes(source, cursor, rawName);
  cursor = body.index;
  if (!source.startsWith(`</${rawName}`, cursor)) throw new Error(`Missing close tag for <${rawName}>`);
  cursor += 2 + rawName.length;
  while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
  if (source[cursor] !== '>') throw new Error(`Missing close tag for <${rawName}>`);
  return {
    node: { name: localName(rawName), attrs: attributes.attrs, children: body.nodes, text: body.text },
    index: cursor + 1,
  };
}

export function parseXml(source: string): XmlNode {
  const text = source.replace(/^\uFEFF/, '');
  const parsed = parseNodes(text, 0, null);
  const root = parsed.nodes[0];
  if (!root) throw new Error('XML document is empty');
  return root;
}

function serializeNode(node: XmlNode, depth: number): string {
  const pad = '  '.repeat(depth);
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('');
  if (node.children.length === 0 && node.text.length === 0) return `${pad}<${node.name}${attrs}/>`;
  if (node.children.length === 0) return `${pad}<${node.name}${attrs}>${escapeXml(node.text)}</${node.name}>`;
  const inner = node.children.map((childNode) => serializeNode(childNode, depth + 1)).join('\n');
  return `${pad}<${node.name}${attrs}>\n${inner}\n${pad}</${node.name}>`;
}

export function serializeXml(node: XmlNode): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializeNode(node, 0)}\n`;
}
