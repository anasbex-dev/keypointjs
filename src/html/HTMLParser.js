import { parse5 } from './dependencies.js';
import { Document, DocumentFragment, validateTree } from './DOM.js';

const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 1024 * 1024,
  maxNodes: 100_000,
  maxDepth: 512
});

function resolveLimits(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('HTMLParser options must be an object');
  }
  const limits = { ...DEFAULT_LIMITS };
  for (const name of Object.keys(DEFAULT_LIMITS)) {
    if (options[name] === undefined) continue;
    if (!Number.isSafeInteger(options[name]) || options[name] < 1) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
    limits[name] = options[name];
  }
  return limits;
}

function validateHTML(html, limits) {
  if (typeof html !== 'string') throw new TypeError('HTML input must be a string');
  const size = Buffer.byteLength(html, 'utf8');
  if (size > limits.maxInputBytes) {
    throw new RangeError(`HTML input exceeds maxInputBytes (${limits.maxInputBytes})`);
  }
}

function createContext(raw, limits) {
  return { root: raw, limits, cache: new WeakMap() };
}

export class HTMLParser {
  constructor(options = {}) {
    this.limits = resolveLimits(options);
  }

  parse(html) {
    validateHTML(html, this.limits);
    const raw = parse5.parse(html, { scriptingEnabled: false });
    validateTree(raw, this.limits);
    const context = createContext(raw, this.limits);
    const document = new Document(raw, context);
    context.cache.set(raw, document);
    return document;
  }

  parseFragment(html) {
    validateHTML(html, this.limits);
    const raw = parse5.parseFragment(html, { scriptingEnabled: false });
    validateTree(raw, this.limits);
    const context = createContext(raw, this.limits);
    const fragment = new DocumentFragment(raw, context);
    context.cache.set(raw, fragment);
    return fragment;
  }

  static parse(html, options = {}) {
    return new HTMLParser(options).parse(html);
  }

  static parseFragment(html, options = {}) {
    return new HTMLParser(options).parseFragment(html);
  }
}

