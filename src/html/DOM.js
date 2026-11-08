import { cssSelect, cssWhat, parse5 } from './dependencies.js';

const { selectAll, selectOne } = cssSelect;
const { parse: parseSelector } = cssWhat;
const { defaultTreeAdapter, serialize, serializeOuter } = parse5;

const NODE_TYPES = {
  '#document': 9,
  '#document-fragment': 11,
  '#text': 3,
  '#comment': 8,
  '#documentType': 10
};

const SUPPORTED_PSEUDOS = new Set([
  'root', 'empty', 'not', 'is', 'where',
  'first-child', 'last-child', 'only-child',
  'first-of-type', 'last-of-type', 'only-of-type',
  'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type'
]);

const SELECTOR_ADAPTER = {
  isTag: node => typeof node?.tagName === 'string',
  existsOne(test, nodes) {
    for (const node of nodes) {
      if (this.isTag(node) && test(node)) return true;
      if (this.existsOne(test, node.childNodes || [])) return true;
    }
    return false;
  },
  getAttributeValue: (element, name) => element.attrs?.find(attr => attr.name === name)?.value,
  getChildren: node => node.childNodes || [],
  getName: element => element.tagName,
  getParent: node => node.parentNode || null,
  getSiblings: node => node.parentNode?.childNodes || [node],
  prevElementSibling(node) {
    const siblings = node.parentNode?.childNodes || [];
    const index = siblings.indexOf(node);
    for (let i = index - 1; i >= 0; i--) {
      if (this.isTag(siblings[i])) return siblings[i];
    }
    return null;
  },
  getText(node) {
    if (node.nodeName === '#text') return node.value;
    return (node.childNodes || []).map(child => this.getText(child)).join('');
  },
  hasAttrib: (element, name) => Boolean(element.attrs?.some(attr => attr.name === name)),
  removeSubsets(nodes) {
    const unique = [...new Set(nodes)];
    const selected = new Set(unique);
    return unique.filter(node => {
      for (let parent = node.parentNode; parent; parent = parent.parentNode) {
        if (selected.has(parent)) return false;
      }
      return true;
    });
  },
  findAll(test, nodes) {
    const result = [];
    const visit = node => {
      if (this.isTag(node)) {
        if (test(node)) result.push(node);
        for (const child of node.childNodes || []) visit(child);
      } else {
        for (const child of node.childNodes || []) visit(child);
      }
    };
    for (const node of nodes) visit(node);
    return result;
  },
  findOne(test, nodes) {
    for (const node of nodes) {
      if (this.isTag(node) && test(node)) return node;
      const found = this.findOne(test, node.childNodes || []);
      if (found) return found;
    }
    return null;
  }
};

function validateSelectorGroups(groups, selector) {
  for (const group of groups) {
    for (const token of group) {
      if (['tag', 'universal', 'descendant', 'child', 'sibling', 'adjacent'].includes(token.type)) {
        if (['tag', 'universal'].includes(token.type) && token.namespace !== null) {
          throw new SyntaxError(`Unsupported CSS namespace selector: ${selector}`);
        }
        continue;
      }
      if (token.type === 'attribute') {
        if (token.namespace !== null || !['exists', 'equals', 'element', 'not', 'start', 'end', 'any', 'hyphen'].includes(token.action)) {
          throw new SyntaxError(`Unsupported CSS attribute selector: ${selector}`);
        }
        continue;
      }
      if (token.type === 'pseudo' && SUPPORTED_PSEUDOS.has(token.name)) {
        if (Array.isArray(token.data)) validateSelectorGroups(token.data, selector);
        continue;
      }
      throw new SyntaxError(`Unsupported CSS selector token: ${token.type}${token.name ? ` (${token.name})` : ''}`);
    }
  }
}

function assertSupportedSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim()) {
    throw new TypeError('CSS selector must be a non-empty string');
  }

  const groups = parseSelector(selector);
  validateSelectorGroups(groups, selector);
  return groups;
}

export function validateTree(root, limits) {
  let count = 0;
  const stack = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    count++;
    if (count > limits.maxNodes) {
      throw new RangeError(`HTML DOM exceeds maxNodes (${limits.maxNodes})`);
    }
    if (depth > limits.maxDepth) {
      throw new RangeError(`HTML DOM exceeds maxDepth (${limits.maxDepth})`);
    }
    const children = node.childNodes || [];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i], depth: depth + 1 });
    }
  }
}

export class DOMNode {
  constructor(raw, context) {
    this._raw = raw;
    this._context = context;
  }

  get nodeType() {
    return NODE_TYPES[this._raw.nodeName] || 1;
  }

  get nodeName() {
    return this._raw.nodeName;
  }

  get parentNode() {
    return this._raw.parentNode ? wrapNode(this._raw.parentNode, this._context) : null;
  }

  get parentElement() {
    const parent = this._raw.parentNode;
    return parent?.tagName ? wrapNode(parent, this._context) : null;
  }

  get childNodes() {
    return (this._raw.childNodes || []).map(node => wrapNode(node, this._context));
  }

  get children() {
    return (this._raw.childNodes || []).filter(node => node.tagName).map(node => wrapNode(node, this._context));
  }

  get firstChild() {
    const node = this._raw.childNodes?.[0];
    return node ? wrapNode(node, this._context) : null;
  }

  get lastChild() {
    const children = this._raw.childNodes || [];
    const node = children[children.length - 1];
    return node ? wrapNode(node, this._context) : null;
  }

  get firstElementChild() {
    const node = (this._raw.childNodes || []).find(child => child.tagName);
    return node ? wrapNode(node, this._context) : null;
  }

  get lastElementChild() {
    const children = this._raw.childNodes || [];
    const node = [...children].reverse().find(child => child.tagName);
    return node ? wrapNode(node, this._context) : null;
  }

  get previousSibling() {
    const siblings = this._raw.parentNode?.childNodes || [];
    const index = siblings.indexOf(this._raw);
    return index > 0 ? wrapNode(siblings[index - 1], this._context) : null;
  }

  get nextSibling() {
    const siblings = this._raw.parentNode?.childNodes || [];
    const index = siblings.indexOf(this._raw);
    return index >= 0 && index + 1 < siblings.length ? wrapNode(siblings[index + 1], this._context) : null;
  }

  get textContent() {
    if (this._raw.nodeName === '#text') return this._raw.value;
    if (this._raw.nodeName === '#comment') return this._raw.data;
    return SELECTOR_ADAPTER.getText(this._raw);
  }

  set textContent(value) {
    const text = String(value ?? '');
    if (this._raw.nodeName === '#text') {
      this._raw.value = text;
      return;
    }
    if (this._raw.nodeName === '#comment') {
      this._raw.data = text;
      return;
    }
    this._replaceChildren(text ? [defaultTreeAdapter.createTextNode(text)] : []);
  }

  querySelector(selector) {
    assertSupportedSelector(selector);
    const match = selectOne(selector, this._raw, {
      adapter: SELECTOR_ADAPTER,
      context: this._raw,
      xmlMode: false,
      cacheResults: false
    });
    return match ? wrapNode(match, this._context) : null;
  }

  querySelectorAll(selector) {
    assertSupportedSelector(selector);
    return selectAll(selector, this._raw, {
      adapter: SELECTOR_ADAPTER,
      context: this._raw,
      xmlMode: false,
      cacheResults: false
    }).map(node => wrapNode(node, this._context));
  }

  getElementsByTagName(tagName) {
    const tag = String(tagName).toLowerCase();
    if (tag !== '*' && !/^[a-z][a-z0-9-]*$/.test(tag)) throw new SyntaxError(`Invalid tag name: ${tagName}`);
    return this.querySelectorAll(tag);
  }

  getElementsByClassName(className) {
    const classes = String(className).trim().split(/\s+/).filter(Boolean);
    if (!classes.length) return [];
    return this.querySelectorAll('[class]').filter(element => {
      const present = new Set(element.className.split(/\s+/).filter(Boolean));
      return classes.every(name => present.has(name));
    });
  }

  _replaceChildren(nodes) {
    const previous = this._raw.childNodes || [];
    for (const child of previous) child.parentNode = null;
    this._raw.childNodes = nodes;
    for (const child of nodes) child.parentNode = this._raw;
    try {
      validateTree(this._context.root, this._context.limits);
    } catch (error) {
      for (const child of nodes) child.parentNode = null;
      this._raw.childNodes = previous;
      for (const child of previous) child.parentNode = this._raw;
      throw error;
    }
  }

  toString() {
    return serializeOuter(this._raw);
  }
}

export class Element extends DOMNode {
  get tagName() {
    return this._raw.tagName;
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  getAttribute(name) {
    return SELECTOR_ADAPTER.getAttributeValue(this._raw, String(name).toLowerCase()) ?? null;
  }

  hasAttribute(name) {
    return SELECTOR_ADAPTER.hasAttrib(this._raw, String(name).toLowerCase());
  }

  setAttribute(name, value) {
    const attributeName = String(name).toLowerCase();
    if (!/^[^\s"'<>/=]+$/.test(attributeName)) throw new SyntaxError(`Invalid attribute name: ${name}`);
    const existing = this._raw.attrs.find(attr => attr.name === attributeName);
    if (existing) existing.value = String(value);
    else this._raw.attrs.push({ name: attributeName, value: String(value) });
  }

  removeAttribute(name) {
    const attributeName = String(name).toLowerCase();
    this._raw.attrs = this._raw.attrs.filter(attr => attr.name !== attributeName);
  }

  get innerHTML() {
    return (this._raw.childNodes || []).map(node => serializeOuter(node)).join('');
  }

  set innerHTML(html) {
    const value = String(html ?? '');
    checkInputSize(value, this._context.limits);
    const fragment = parse5.parseFragment(this._raw, value);
    const children = fragment.childNodes;
    const previous = this._raw.childNodes || [];
    for (const child of previous) child.parentNode = null;
    this._raw.childNodes = children;
    for (const child of children) child.parentNode = this._raw;
    try {
      validateTree(this._context.root, this._context.limits);
    } catch (error) {
      for (const child of children) child.parentNode = null;
      this._raw.childNodes = previous;
      for (const child of previous) child.parentNode = this._raw;
      throw error;
    }
  }

  get outerHTML() {
    return serializeOuter(this._raw);
  }

  toString() {
    return this.outerHTML;
  }
}

export class Text extends DOMNode {
  get data() { return this._raw.value; }
  set data(value) { this._raw.value = String(value); }
}

export class Comment extends DOMNode {
  get data() { return this._raw.data; }
  set data(value) { this._raw.data = String(value); }
}

export class DocumentType extends DOMNode {
  get name() { return this._raw.name; }
  get publicId() { return this._raw.publicId; }
  get systemId() { return this._raw.systemId; }
}

export class Document extends DOMNode {
  get documentElement() {
    const node = this._raw.childNodes.find(child => child.tagName === 'html');
    return node ? wrapNode(node, this._context) : null;
  }

  get head() {
    const node = this._raw.childNodes.find(child => child.tagName === 'html')?.childNodes.find(child => child.tagName === 'head');
    return node ? wrapNode(node, this._context) : null;
  }

  get body() {
    const node = this._raw.childNodes.find(child => child.tagName === 'html')?.childNodes.find(child => child.tagName === 'body');
    return node ? wrapNode(node, this._context) : null;
  }

  getElementById(id) {
    return this.querySelectorAll('[id]').find(element => element.getAttribute('id') === String(id)) || null;
  }

  toString() {
    return serialize(this._raw);
  }
}

export class DocumentFragment extends DOMNode {
  toString() {
    return (this._raw.childNodes || []).map(node => serializeOuter(node)).join('');
  }
}

function wrapNode(raw, context) {
  if (context.cache.has(raw)) return context.cache.get(raw);
  let Constructor = Element;
  if (raw.nodeName === '#document') Constructor = Document;
  else if (raw.nodeName === '#document-fragment') Constructor = DocumentFragment;
  else if (raw.nodeName === '#text') Constructor = Text;
  else if (raw.nodeName === '#comment') Constructor = Comment;
  else if (raw.nodeName === '#documentType') Constructor = DocumentType;
  const node = new Constructor(raw, context);
  context.cache.set(raw, node);
  return node;
}

function checkInputSize(value, limits) {
  const size = Buffer.byteLength(value, 'utf8');
  if (size > limits.maxInputBytes) {
    throw new RangeError(`HTML input exceeds maxInputBytes (${limits.maxInputBytes})`);
  }
}

