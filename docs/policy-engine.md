# Policy Engine

`PolicyEngine` evaluates its ordered global rules in insertion order and stops at the first denial. If rules pass, it checks the keypoint's `metadata.policy` for a registered policy function. No policy attached or no matching policy means the engine returns allow after global rules pass. Do not confuse this behavior with a deny-by-default policy.

## Built-in rules

Import `BuiltInRules` from `keypointjs` or `PolicyRule` from `keypointjs/policy/rules`.

```js
import { BuiltInRules } from 'keypointjs';

api.addPolicyRule(BuiltInRules.methodRule(['GET', 'POST']));
api.addPolicyRule(BuiltInRules.scopeRule('orders:read'));
api.addPolicyRule(BuiltInRules.originRule(['https://app.example']));
```

Factories implemented: `methodRule(allowedMethods)`, `originRule(allowedOrigins)`, `ipRule(allowedIPs, blockedIPs)`, `timeWindowRule(startHour, endHour)`, `rateLimitRule(limit, windowSeconds)`, `scopeRule(requiredScope)`, and `protocolRule(allowedProtocols)`. Origin rules allow requests without an Origin header. Empty origin lists allow any origin. The IP CIDR matcher is simplified string-prefix logic and is not a reliable security boundary; `allowedIps` on a keypoint is not automatically enforced.

`PolicyRule` wraps an async evaluator receiving context. Returning `{allowed:false, reason}` denies. Errors thrown from the evaluator are converted to denial. `priority` is recorded on the rule but the current `PolicyEngine` does not sort by it.

## Named policies

```js
api.addPolicy('orders-reader', api.policyEngine.allow({
  scope: 'orders:read',
  method: 'GET',
  protocol: 'https'
}));

await api.createKeypoint({
  keyId: 'reader',
  scopes: ['orders:read'],
  protocols: ['https'],
  metadata: { policy: 'orders-reader' }
});
```

Named policy functions run after all global rules pass. `allow(config)` checks optional scope, method, and protocol. Policy results are plain objects; although `AccessDecision` is exported, the current engine does not return that class. Do not rely on a priority ordering or decision merging in the active request pipeline.
