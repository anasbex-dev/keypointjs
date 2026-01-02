export class KeypointValidator {
  constructor(storage) {
    this.storage = storage || new KeypointStorage();
  }
  
  async validate(context) {
    const { request } = context;
    
    // Extract keypoint from request
    const keypointId = this.extractKeypointId(request);
    if (!keypointId) {
      throw new KeypointError('Keypoint header required', 401);
    }
    
    // Load keypoint from storage
    const keypoint = await this.storage.get(keypointId);
    if (!keypoint) {
      throw new KeypointError('Invalid keypoint', 401);
    }
    
    // Validate keypoint
    if (keypoint.isExpired()) {
      throw new KeypointError('Keypoint expired', 401);
    }
    
    // Verify secret if provided
    if (request.headers['x-keypoint-secret']) {
      const isValid = await this.verifySecret(
        keypoint, 
        request.headers['x-keypoint-secret']
      );
      if (!isValid) {
        throw new KeypointError('Invalid secret', 401);
      }
    }
    
    // Attach keypoint to context
    context.keypoint = keypoint;
    return true;
  }
  
  extractKeypointId(request) {
    return request.headers['x-keypoint-id'] || 
           request.query.keypointId;
  }
  
  async verifySecret(keypoint, providedSecret) {
    // Implement secure secret verification
    return keypoint.secret === providedSecret;
  }
}