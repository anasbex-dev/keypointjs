# Security Best Practices

These are application and deployment recommendations. They are not all built-in framework protections.

## Credentials and keypoints

* Generate high-entropy key IDs/secrets and protect their distribution.
* The current validator does not require a secret; it checks a supplied `X-Keypoint-Secret` with direct string equality. Treat this as a limitation and add an application-appropriate credential design before relying on secret authentication.
* Avoid storing production credentials in source control. Restrict file-storage access; the built-in JSON store does not encrypt secrets.
* Set and periodically review `expiresAt`; revoke credentials no longer needed.
* Do not assume `allowedIps` on a keypoint is enforced. The separate policy IP rule uses simplified CIDR matching and should not be a security boundary.

## Authorization and origins

* Assign the minimum scopes needed and check them at sensitive handlers. Use `ctx.hasScope` for inherited scope behavior.
* Review all global rules and named policies. A missing named policy does not automatically deny after global rules pass.
* Configure explicit `allowedOrigins` where origin checks are meaningful. Empty keypoint origin lists accept any origin. Origin checks are not a substitute for authentication or CSRF protections.
* Use `corsOrigins` carefully. CORS is a browser policy mechanism, not authorization.

## Network and operations

* Serve authenticated traffic over TLS. Configure `trustedProxies` only for known proxy hops; do not trust arbitrary forwarded headers.
* Review request-size limits, route behavior, error responses, and logs for the deployment.
* Rate limits are in-process and have limitations described in [Rate Limiting](rate-limiting.md). They do not replace edge controls or distributed abuse protection.
* Audit logs may contain identifiers, addresses, paths, and metadata. Restrict access, set retention, and avoid secrets in metadata.
* Test shutdown and storage backup/recovery behavior for your own deployment.

The framework supplies building blocks but does not provide a security guarantee, external audit, distributed enforcement, or complete credential-management lifecycle. Review the source and threat model for your application.
