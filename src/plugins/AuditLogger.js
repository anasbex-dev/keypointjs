export class AuditLogger {
  constructor(options = {}) {
    this.options = {
      logLevel: 'info',
      logToConsole: true,
      logToFile: false,
      filePath: './audit.log',
      maxFileSize: '10mb',
      ...options
    };
    
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      critical: 4
    };
    
    this.logs = [];
    this.rotationInterval = null;
    
    if (this.options.logToFile) {
      this.setupFileLogging();
    }
  }
  
  async process(context, next) {
    const startTime = Date.now();
    
    try {
      // Add audit data to context
      context.audit = {
        requestId: context.id,
        keypointId: context.getKeypointId(),
        timestamp: new Date(),
        action: `${context.method} ${context.path}`,
        status: 'processing'
      };
      
      const result = await next(context);
      const duration = Date.now() - startTime;
      
      // Log successful request
      await this.logRequest(context, {
        status: 'success',
        duration,
        responseStatus: context.response?.status
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log failed request
      await this.logRequest(context, {
        status: 'error',
        duration,
        error: error.message,
        errorCode: error.code,
        stack: this.options.logLevel === 'debug' ? error.stack : undefined
      });
      
      throw error;
    }
  }
  
  async logRequest(context, details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: details.status === 'error' ? 'error' : 'info',
      requestId: context.id,
      keypointId: context.getKeypointId(),
      ip: context.ip,
      userAgent: context.getHeader('user-agent'),
      method: context.method,
      path: context.path,
      protocol: context.protocol,
      scopes: context.keypoint?.scopes || [],
      ...details,
      metadata: {
        ...context.getKeypointMetadata(),
        ...details.metadata
      }
    };
    
    // Add to memory buffer
    this.logs.push(logEntry);
    
    // Log to console
    if (this.options.logToConsole) {
      this.logToConsole(logEntry);
    }
    
    // Log to file
    if (this.options.logToFile) {
      await this.logToFile(logEntry);
    }
    
    // Trigger event
    this.emit('audit', logEntry);
    
    return logEntry;
  }
  
  logToConsole(entry) {
    const color = {
      info: '\x1b[32m', // Green
      warn: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
      debug: '\x1b[36m' // Cyan
    } [entry.level] || '\x1b[0m';
    
    const reset = '\x1b[0m';
    
    const message = [
      `${color}[${entry.timestamp}]`,
      `${entry.level.toUpperCase()}`,
      `${entry.method} ${entry.path}`,
      `${entry.status || ''}`,
      `${entry.duration ? `${entry.duration}ms` : ''}`,
      entry.error ? `- ${entry.error}` : '',
      reset
    ].filter(Boolean).join(' ');
    
    console.log(message);
  }
  
  async logToFile(entry) {
    const fs = await import('fs/promises');
    
    try {
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.options.filePath, line, 'utf-8');
      
      // Check file size for rotation
      await this.checkFileRotation();
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }
  
  async checkFileRotation() {
    const fs = await import('fs/promises');
    
    try {
      const stats = await fs.stat(this.options.filePath);
      const maxSize = this.parseSize(this.options.maxFileSize);
      
      if (stats.size > maxSize) {
        await this.rotateLogFile();
      }
    } catch (error) {
      // File doesn't exist or other error
    }
  }
  
  async rotateLogFile() {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const oldPath = this.options.filePath;
    const newPath = path.join(
      path.dirname(oldPath),
      `${path.basename(oldPath, '.log')}-${timestamp}.log`
    );
    
    try {
      await fs.rename(oldPath, newPath);
      console.log(`Rotated audit log to ${newPath}`);
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }
  
  parseSize(size) {
    const match = size.match(/^(\d+)(mb|kb|b)$/i);
    if (!match) return 10 * 1024 * 1024; // 10MB default
    
    const [, num, unit] = match;
    const multiplier = {
      'b': 1,
      'kb': 1024,
      'mb': 1024 * 1024
    } [unit.toLowerCase()];
    
    return parseInt(num) * multiplier;
  }
  
  setupFileLogging() {
    // Setup periodic rotation check
    this.rotationInterval = setInterval(() => {
      this.checkFileRotation();
    }, 60000); // Check every minute
    
    // Ensure log directory exists
    this.ensureLogDirectory();
  }
  
  async ensureLogDirectory() {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const dir = path.dirname(this.options.filePath);
    
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }
  
  async queryLogs(filter = {}) {
    let filtered = this.logs;
    
    if (filter.startDate) {
      const start = new Date(filter.startDate);
      filtered = filtered.filter(log => new Date(log.timestamp) >= start);
    }
    
    if (filter.endDate) {
      const end = new Date(filter.endDate);
      filtered = filtered.filter(log => new Date(log.timestamp) <= end);
    }
    
    if (filter.level) {
      filtered = filtered.filter(log => log.level === filter.level);
    }
    
    if (filter.keypointId) {
      filtered = filtered.filter(log => log.keypointId === filter.keypointId);
    }
    
    if (filter.ip) {
      filtered = filtered.filter(log => log.ip === filter.ip);
    }
    
    if (filter.method) {
      filtered = filtered.filter(log => log.method === filter.method);
    }
    
    if (filter.path) {
      filtered = filtered.filter(log => log.path.includes(filter.path));
    }
    
    // Sort and limit
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (filter.limit) {
      filtered = filtered.slice(0, filter.limit);
    }
    
    return {
      total: this.logs.length,
      filtered: filtered.length,
      logs: filtered
    };
  }
  
  clearLogs() {
    const count = this.logs.length;
    this.logs = [];
    return count;
  }
  
  // Event emitter methods
  on(event, handler) {
    if (!this.listeners) this.listeners = new Map();
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }
  
  emit(event, data) {
    if (!this.listeners || !this.listeners.has(event)) return;
    
    for (const handler of this.listeners.get(event)) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in audit event handler:`, error);
      }
    }
  }
  
  // Cleanup
  cleanup() {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
    }
  }
}