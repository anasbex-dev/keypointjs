# Authorization

Authorization occurs after protocol processing and optional keypoint validation. Global policy rules run before a named policy, and the router is reached only if the policy engine allows the request.

## Scope checks in handlers

```js
api.get('/reports', (ctx) => {
  if (!ctx.hasScope('reports:read')) {
    return ctx.status(403).json({ error: 'Insufficient scope' });
  }
  return ctx.json({ reports: [] });
});
```

`KeypointContext` uses the framework's shared `ScopeManager`, so registered inheritance is applied by `hasScope`, `hasAnyScope`, and `hasAllScopes`. The lower-level `Keypoint.hasScope()` checks only literal scopes and wildcard; use context checks for request authorization.

## Policy selection

Named policies are registered with `api.addPolicy(name, policyFn)`. The engine selects a policy when the authenticated keypoint's `metadata.policy` names a registered policy. `PolicyEngine.allow({scope, method, protocol})` creates a simple policy function. Global rules run first and deny on the first failed rule. The framework's built-in named policy templates exist, but are not automatically assigned to every keypoint.

## Denials

Policy denial is represented by a result with `allowed: false` and a reason. In the main request pipeline that becomes a `PolicyError` with code 403 and is passed to the configured error handler. A missing route after successful authorization is a separate 404 result.

See [Scope Management](scope-management.md) and [Policy Engine](policy-engine.md). Always apply authorization to each sensitive action; possession of a valid keypoint alone does not imply permission to perform every operation.
