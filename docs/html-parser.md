# KeyPointJS HTML Parser

The HTML Parser provides a Node.js HTML document and fragment parser with a small DOM-like API and a supported subset of CSS selectors. It is an optional capability and is separate from KeyPointJS request handling.

## Installation and imports

Install KeyPointJS normally to install its optional parser dependencies:

```sh
npm install keypointjs
```

Import the parser from its package subpath:

```js
import { HTMLParser } from 'keypointjs/html-parser';
```

If optional dependencies were omitted, for example with `npm install --omit=optional`, the main KeyPointJS package remains usable. Importing `keypointjs/html-parser` then reports which parser dependency is missing and provides an install command. Install the parser dependencies in the consuming project to enable it:

```sh
npm install parse5@7.3.0 css-select@5.2.2 css-what@6.2.2
```

The parser dependencies are `parse5`, `css-select`, and `css-what`. They are not loaded by the main KeyPointJS entry point.

## Parsing documents and fragments

```js
import { HTMLParser } from 'keypointjs/html-parser';

const document = HTMLParser.parse(`
  <!doctype html>
  <html>
    <head><title>Catalog</title></head>
    <body><main><h1>Items</h1></main></body>
  </html>
`);

console.log(document.querySelector('title')?.textContent); // Catalog

const fragment = HTMLParser.parseFragment('<li>One</li><li>Two</li>');
console.log(fragment.children.length); // 2
```

`parse()` creates a complete HTML document, including implied document structure when needed. `parseFragment()` returns a fragment that can contain multiple root nodes.

The equivalent instance API allows per-parser limits:

```js
const parser = new HTMLParser({
  maxInputBytes: 1024 * 1024,
  maxNodes: 100000,
  maxDepth: 512
});

const document = parser.parse('<main>Ready</main>');
```

Defaults are 1 MiB of UTF-8 input, 100,000 DOM nodes, and depth 512. Each configured limit must be a positive safe integer. Static calls also accept the same optional limits object as their second argument:

```js
const document = HTMLParser.parse('<p>Small input</p>', { maxNodes: 1000 });
```

## Querying and changing a document

```js
const document = HTMLParser.parse(`
  <article id="item-1" class="product featured" data-price="12">
    <h2>Notebook</h2>
    <a href="/notebook">View</a>
  </article>
`);

const article = document.getElementById('item-1');
const heading = document.querySelector('.product > h2');
const links = document.querySelectorAll('article a[href]');

console.log(heading.textContent); // Notebook
console.log(article.getAttribute('data-price')); // 12
console.log(document.getElementsByClassName('product featured').length); // 1

article.setAttribute('aria-label', 'Notebook product');
article.removeAttribute('data-price');
article.querySelector('h2').textContent = 'Grid notebook';
article.querySelector('a').setAttribute('href', '/grid-notebook');

console.log(article.outerHTML);
console.log(document.toString());
```

`textContent` replaces an element's children with text; serialization escapes that text. `innerHTML` reads or replaces an element's children using parsed HTML. `outerHTML` serializes an element. `document.toString()` serializes the full document.

The facade exposes `Document`, `DocumentFragment`, `Element`, `Text`, `Comment`, and `DocumentType` nodes. Nodes provide `parentNode`, `parentElement`, `childNodes`, `children`, `firstChild`, `lastChild`, `firstElementChild`, `lastElementChild`, `previousSibling`, and `nextSibling`. These child collections are arrays returned as snapshots, not live browser `NodeList` objects.

## CSS selector support

Supported selectors include:

- Tag names and universal selector `*`.
- IDs (`#main`) and classes (`.selected`).
- Attribute presence and comparisons: `[name]`, `[name=value]`, `[name~=value]`, `[name|=value]`, `[name^=value]`, `[name$=value]`, and `[name*=value]`.
- Comma-separated groups, such as `h1, h2`.
- Descendant, child (`>`), adjacent sibling (`+`), and general sibling (`~`) combinators.
- Structural pseudo-classes: `:root`, `:empty`, `:first-child`, `:last-child`, `:only-child`, `:first-of-type`, `:last-of-type`, `:only-of-type`, `:nth-child()`, `:nth-last-child()`, `:nth-of-type()`, and `:nth-last-of-type()`.
- Selector-list pseudo-classes `:not()`, `:is()`, and `:where()`.

Invalid selector syntax throws an error. Valid CSS selectors outside the supported subset, including namespace selectors and dynamic pseudo-classes such as `:hover`, are rejected explicitly; they do not silently return an empty result. This is a practical subset, not full browser selector compatibility.

## Errors and malformed HTML

The HTML parser repairs common malformed markup rather than rejecting every non-conforming document. Non-string input throws `TypeError`; invalid parser limits, input exceeding `maxInputBytes`, or a parsed tree exceeding `maxNodes`/`maxDepth` throw an error. Invalid or unsupported CSS selectors also throw.

```js
try {
  const parser = new HTMLParser({ maxInputBytes: 32 });
  parser.parse('<p>This input exceeds the configured limit.</p>');
} catch (error) {
  if (error instanceof RangeError) {
    console.error('HTML or DOM resource limit exceeded:', error.message);
  } else {
    throw error;
  }
}

const repaired = HTMLParser.parse('<p>First<div>Second</div>');
console.log(repaired.querySelectorAll('p, div').length); // 2
```

## Limitations

- The facade is not a complete browser DOM implementation. It has no layout, event system, live collections, or general browser DOM mutation APIs.
- Website JavaScript is not executed.
- External resources such as scripts, stylesheets, images, and frames are not loaded.
- Only the documented CSS selector subset is supported.
- Node-count and depth validation happen after parse5 has constructed the tree. They are useful input constraints, but do not provide complete protection against parser resource exhaustion. The input-byte limit is checked before parsing.

The parser is independent from `HttpEngine` and does not fetch URLs. Web scraping and outbound HTTP are outside this module's scope.
