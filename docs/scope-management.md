# Scope Management

`ScopeManager` is owned by each `KeypointJS` instance. Define scopes with `api.defineScope(name, description, metadata)` and register inheritance directly on `api.scopeManager` using `addInheritance(parent, children)`.

```js
api.defineScope('reports:read', 'Read reports');
api.defineScope('reports:write', 'Change reports');
api.scopeManager.addInheritance('reports:write', ['reports:read']);

await api.createKeypoint({
  keyId: 'report-admin',
  scopes: ['reports:write'],
  protocols: ['https']
});
```

With the registered relationship, a context holding `reports:write` passes `ctx.hasScope('reports:read')`. Inheritance follows parent-to-descendant edges transitively. Built-in definitions include `*`, `read`, `write`, `admin`, API scopes, and resource examples. Built-in relationships include `admin` to `read`, `write`, `*`; `write` to `read`; and `api:internal` to private and public API scopes.

`hasAnyScope(available, requested)` succeeds when at least one requested scope resolves; `hasAllScopes` requires every requested scope. `*` grants wildcard access. `validateScope` checks whether a name is defined, but scope validation is not automatically applied to keypoint creation. `addInheritance` also does not require the referenced names to have definitions, so define scopes deliberately and validate user-provided assignments in your application.

The inheritance traversal is cycle-safe and de-duplicates inherited results. Prefer a clear, least-privilege hierarchy; wildcard should be reserved for deliberately unrestricted identities. `Keypoint.hasScope` is a literal fallback without hierarchy; request code should use `ctx.hasScope`.
