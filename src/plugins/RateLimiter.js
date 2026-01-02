export class RateLimiter {
  constructor(options = {}) {
    this.limits = new Map();
    this.window = options.window || 60 * 1000; // 1 minute
  }
  
  async process(context, next) {
    const { keypoint, request } = context;
    
    if (!keypoint) return next(context);
    
    const limitKey = `rate:${keypoint.keyId}:${Date.now() / this.window}`;
    
    const current = this.limits.get(limitKey) || 0;
    const limit = keypoint.rateLimit.requests;
    
    if (current >= limit) {
      throw new Error('Rate limit exceeded', 429);
    }
    
    this.limits.set(limitKey, current + 1);
    return next(context);
  }
}