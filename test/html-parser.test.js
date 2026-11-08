import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HTMLParser,
  Document,
  DocumentFragment,
  Element,
  Text,
  Comment,
  DocumentType
} from '../src/html/index.js';

describe('HTMLParser', () => {
  it('is available through the additive package subpath export', async () => {
    const module = await import('keypointjs/html-parser');
    assert.equal(typeof module.HTMLParser.parse, 'function');
  });

  it('parses a full HTML document into document, head, and body nodes', () => {
    const document = HTMLParser.parse('<!doctype html><title>Example</title><main>content</main>');

    assert.ok(document instanceof Document);
    assert.equal(document.documentElement.tagName, 'html');
    assert.equal(document.head.querySelector('title').textContent, 'Example');
    assert.equal(document.body.querySelector('main').textContent, 'content');
  });

  it('parses multiple root elements as a fragment', () => {
    const fragment = HTMLParser.parseFragment('<i>one</i><b>two</b>');

    assert.ok(fragment instanceof DocumentFragment);
    assert.deepEqual(fragment.children.map(element => element.tagName), ['i', 'b']);
    assert.equal(fragment.toString(), '<i>one</i><b>two</b>');
  });

  it('preserves nested elements and parent-child relationships', () => {
    const document = HTMLParser.parse('<section><article><p>nested</p></article></section>');
    const section = document.querySelector('section');
    const article = section.querySelector('article');
    const paragraph = article.firstElementChild;

    assert.ok(section instanceof Element);
    assert.equal(article.parentNode, section);
    assert.equal(paragraph.parentElement, article);
    assert.equal(section.children[0], article);
    assert.equal(document.documentElement.parentNode, document);
  });

  it('exposes text nodes, comments, and doctype nodes', () => {
    const document = HTMLParser.parse('<!doctype html><!--note--><p>text</p>');

    assert.ok(document.childNodes[0] instanceof DocumentType);
    assert.ok(document.childNodes[1] instanceof Comment);
    assert.ok(document.querySelector('p').firstChild instanceof Text);
    assert.equal(document.querySelector('p').firstChild.nodeType, 3);
  });

  it('decodes HTML entities in text and attributes', () => {
    const document = HTMLParser.parse('<p title="A &amp; B">Tom &amp; Jerry &#x2713;</p>');

    assert.equal(document.querySelector('p').getAttribute('title'), 'A & B');
    assert.equal(document.querySelector('p').textContent, 'Tom & Jerry ✓');
  });

  it('repairs common malformed HTML', () => {
    const document = HTMLParser.parse('<p>first<div>second</div>');

    assert.equal(document.querySelector('p').textContent, 'first');
    assert.equal(document.querySelector('div').textContent, 'second');
    assert.equal(document.body.children.length, 2);
  });

  it('reads, mutates, removes, and selects attributes', () => {
    const document = HTMLParser.parse('<button class="action primary" data-ready>go</button>');
    const button = document.querySelector('button');

    assert.equal(button.getAttribute('data-ready'), '');
    button.setAttribute('aria-label', 'Save & close');
    button.setAttribute('class', 'action');
    assert.equal(button.getAttribute('aria-label'), 'Save & close');
    assert.deepEqual(document.getElementsByClassName('action'), [button]);
    assert.deepEqual(document.getElementsByClassName('action primary'), []);
    button.removeAttribute('data-ready');
    assert.equal(button.hasAttribute('data-ready'), false);
  });

  it('supports textContent reads and writes with serialization escaping', () => {
    const document = HTMLParser.parse('<p><b>old</b></p>');
    const paragraph = document.querySelector('p');

    assert.equal(paragraph.textContent, 'old');
    paragraph.textContent = '<new & text>';
    assert.equal(paragraph.textContent, '<new & text>');
    assert.equal(paragraph.innerHTML, '&lt;new &amp; text&gt;');
  });

  it('gets and sets innerHTML and outerHTML', () => {
    const document = HTMLParser.parse('<main><p>one &amp; two</p></main>');
    const main = document.querySelector('main');

    assert.equal(main.innerHTML, '<p>one &amp; two</p>');
    main.innerHTML = '<b>three</b><i>four</i>';
    assert.equal(main.children.length, 2);
    assert.equal(main.outerHTML, '<main><b>three</b><i>four</i></main>');
    assert.equal(document.toString(), '<html><head></head><body><main><b>three</b><i>four</i></main></body></html>');
  });

  it('serializes comments, doctypes, text, and attributes with escaping', () => {
    const document = HTMLParser.parse('<!doctype html><!--c--><p title="a &amp; b">x &lt; y &amp; z</p>');

    assert.equal(
      document.toString(),
      '<!DOCTYPE html><!--c--><html><head></head><body><p title="a &amp; b">x &lt; y &amp; z</p></body></html>'
    );
  });

  it('supports the documented CSS selector subset', () => {
    const document = HTMLParser.parse('<ul><li class="item" data-kind="a">one</li><li class="item active" data-kind="b"><a href="/b">two</a></li></ul>');

    assert.equal(document.querySelector('#missing'), null);
    assert.equal(document.getElementById('absent'), null);
    assert.equal(document.querySelector('ul > li.active a[href^="/"]').textContent, 'two');
    assert.equal(document.querySelectorAll('li, a').length, 3);
    assert.equal(document.querySelector('li:nth-child(2)').className, 'item active');
    assert.equal(document.querySelector('li:not(.active)').textContent, 'one');
    assert.equal(document.getElementsByTagName('LI').length, 2);
    assert.equal(document.getElementsByClassName('item active').length, 1);
  });

  it('rejects invalid and unsupported CSS selectors explicitly', () => {
    const document = HTMLParser.parse('<p>text</p>');

    assert.throws(() => document.querySelector('p['));
    assert.throws(() => document.querySelector('p:hover'), /Unsupported CSS selector/);
    assert.throws(() => document.querySelector(''), /non-empty string/);
  });

  it('enforces configurable UTF-8 input byte limits', () => {
    const parser = new HTMLParser({ maxInputBytes: 5 });

    assert.equal(parser.parse('éé').body.textContent, 'éé');
    assert.throws(() => parser.parse('ééé'), /maxInputBytes/);
  });

  it('enforces configurable DOM node count limits', () => {
    assert.throws(() => HTMLParser.parseFragment('<i></i><b></b>', { maxNodes: 2 }), /maxNodes/);
  });

  it('enforces configurable DOM nesting depth limits', () => {
    assert.throws(() => HTMLParser.parseFragment('<i><b><u>x</u></b></i>', { maxDepth: 2 }), /maxDepth/);
  });

  it('validates parser resource limit configuration', () => {
    assert.throws(() => new HTMLParser({ maxNodes: 0 }), /positive safe integer/);
    assert.throws(() => HTMLParser.parse('<div></div>', { maxDepth: 1 }), /maxDepth/);
  });
});
