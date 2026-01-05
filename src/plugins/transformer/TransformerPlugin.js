// Copyright AnasBex - 2026 TransformersPlugin.js
/*

API response standardization

Inject metadata (requestId, timestamp, duration)

Optional envelope (success, data, error)

*/

export class TransformerPlugin {
  constructor(options = {}) {
    this.options = {
      envelope: true,
      addRequestId: true,
      addTimestamp: true,
      addDuration: true,
      ...options
    };
  }

  async process(ctx, next) {
    const start = Date.now();

    const response = await next(ctx);

    // If handler returns null / undefined
    if (!response) return response;

    // If the response is not a KeypointJS API object
    if (typeof response !== 'object' || !response.body) {
      return response;
    }

    const duration = Date.now() - start;

    // Error response
    if (response.status >= 400) {
      return {
        ...response,
        body: this.options.envelope
          ? {
              success: false,
              error: response.body,
              meta: this._meta(ctx, duration)
            }
          : response.body
      };
    }

    // Success response
    return {
      ...response,
      body: this.options.envelope
        ? {
            success: true,
            data: response.body,
            meta: this._meta(ctx, duration)
          }
        : response.body
    };
  }

  _meta(ctx, duration) {
    const meta = {};

    if (this.options.addRequestId) {
      meta.requestId = ctx.id;
    }

    if (this.options.addTimestamp) {
      meta.timestamp = new Date().toISOString();
    }

    if (this.options.addDuration) {
      meta.durationMs = duration;
    }

    return meta;
  }
}