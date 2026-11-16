export class RateLimitExceededError extends Error {
  constructor({ headers, responseBody }) {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceededError';
    this.code = 429;
    this.headers = headers;
    this.responseBody = responseBody;
  }
}

export class RateLimiterStorageError extends Error {
  constructor(cause) {
    super('Rate limit storage is unavailable');
    this.name = 'RateLimiterStorageError';
    this.code = 503;
    this.cause = cause;
  }
}
