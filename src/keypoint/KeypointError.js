export class KeypointError extends Error {
  constructor(message, code = 401, details = {}) {
    super(message);
    this.name = 'KeypointError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
  }
}
