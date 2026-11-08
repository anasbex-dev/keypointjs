# Examples

Examples below use public package imports and implemented APIs. Each is a focused pattern; combine them with deployment-specific validation and error handling.

## Protected API and least privilege

```js
import { KeypointJS } from 'keypointjs';

const api = new KeypointJS();
await api.createKeypoint({ keyId: 'reader', scopes: ['catalog:read'], protocols: ['https'] });

api.get('/catalog', (ctx) => {
  if (!ctx.hasScope('catalog:read')) return ctx.status(403).json({ error: 'Forbidden' });
  return ctx.json({ items: [] });
});

await api.listen(3000, '127.0.0.1');
```

## Two identities with different permissions

```js
await api.createKeypoint({ keyId: 'catalog-reader', scopes: ['catalog:read'], protocols: ['https'] });
await api.createKeypoint({ keyId: 'catalog-editor', scopes: ['catalog:write'], protocols: ['https'] });
```

Check each route using `ctx.hasScope`. Define and register inheritance explicitly if write should include read; scope names alone do not imply a hierarchy. See [Scope Management](scope-management.md).

## Named policy

```js
api.addPolicy('catalog-reader', api.policyEngine.allow({
  scope: 'catalog:read', method: 'GET', protocol: 'https'
}));
await api.createKeypoint({
  keyId: 'reader', scopes: ['catalog:read'], protocols: ['https'],
  metadata: { policy: 'catalog-reader' }
});
```

## Register a custom rule

```js
import { PolicyRule } from 'keypointjs/policy/rules';

api.addPolicyRule(new PolicyRule('maintenance-window', async (ctx) => ({
  allowed: ctx.getHeader('x-maintenance-mode') !== 'deny',
  reason: 'Unavailable during maintenance'
})));
```

This is an illustrative rule; production maintenance controls should use trusted configuration, not a caller-controlled header.

## Optional parser

```js
import { HTMLParser } from 'keypointjs/html-parser';

const doc = HTMLParser.parse('<main><h1>Catalog</h1></main>');
console.log(doc.querySelector('h1')?.textContent); // Catalog
```

The parser does not fetch a page or execute scripts. See [HTML Parser](html-parser.md). WebScraper is not implemented.
