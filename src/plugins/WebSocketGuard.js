import { WebSocketServer } from 'ws';

export class WebSocketGuard {
  constructor(options = {}) {
    this.options = {
      path: '/ws',
      verifyClient: this.defaultVerifyClient.bind(this),
      keypointHeader: 'x-keypoint-id',
      requireKeypoint: true,
      pingInterval: 30000,
      maxConnections: 1000,
      ...options
    };
    
    this.wss = null;
    this.connections = new Map();
    this.messageHandlers = new Map();
    this.connectionCallbacks = [];
    this.disconnectionCallbacks = [];
  }
  
  async process(context, next) {
    // This plugin works differently - it creates WebSocket server
    // For HTTP requests, just pass through
    return next(context);
  }
  
  attachToServer(httpServer, keypointJS) {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: this.options.path,
      verifyClient: (info, callback) => {
        this.options.verifyClient(info, callback, keypointJS);
      }
    });
    
    this.setupWebSocketHandlers(keypointJS);
    return this;
  }
  
  defaultVerifyClient(info, callback, keypointJS) {
    const req = info.req;
    const keypointId = req.headers[this.options.keypointHeader];
    
    if (this.options.requireKeypoint && !keypointId) {
      callback(false, 401, 'Keypoint ID required');
      return;
    }
    
    // Create a mock context for validation
    const mockContext = {
      request: {
        headers: req.headers,
        url: req.url,
        method: 'GET',
        ip: req.socket.remoteAddress
      },
      getKeypointId: () => keypointId
    };
    
    // Validate keypoint if provided
    if (keypointId) {
      keypointJS.keypointValidator.validate(mockContext)
        .then(() => {
          callback(true);
        })
        .catch(() => {
          callback(false, 401, 'Invalid keypoint');
        });
    } else {
      callback(true);
    }
  }
  
  setupWebSocketHandlers(keypointJS) {
    this.wss.on('connection', (ws, req) => {
      const connectionId = this.generateConnectionId();
      const keypointId = req.headers[this.options.keypointHeader];
      
      const connection = {
        id: connectionId,
        ws,
        req,
        keypointId,
        ip: req.socket.remoteAddress,
        connectedAt: new Date(),
        lastActivity: new Date(),
        metadata: {}
      };
      
      this.connections.set(connectionId, connection);
      
      // Attach keypoint to WebSocket
      if (keypointId) {
        keypointJS.keypointStorage.get(keypointId)
          .then(keypoint => {
            connection.keypoint = keypoint;
            connection.scopes = keypoint.scopes;
          })
          .catch(() => {
            // Keypoint not found, but connection already established
          });
      }
      
      // Setup message handler
      ws.on('message', async (data) => {
        connection.lastActivity = new Date();
        await this.handleMessage(connection, data);
      });
      
      // Setup ping/pong
      ws.on('pong', () => {
        connection.lastActivity = new Date();
      });
      
      // Handle close
      ws.on('close', () => {
        this.handleDisconnection(connectionId);
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for connection ${connectionId}:`, error);
        this.handleDisconnection(connectionId);
      });
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'welcome',
        connectionId,
        timestamp: new Date().toISOString()
      }));
      
      // Call connection callbacks
      this.connectionCallbacks.forEach(callback => callback(connection));
    });
    
    // Setup ping interval
    setInterval(() => {
      this.checkConnections();
    }, this.options.pingInterval);
  }
  
  generateConnectionId() {
    return Math.random().toString(36).substring(2) + 
           Date.now().toString(36);
  }
  
  async handleMessage(connection, data) {
    let message;
    
    try {
      message = JSON.parse(data.toString());
    } catch {
      connection.ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid JSON message'
      }));
      return;
    }
    
    // Check if handler exists for message type
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        const result = await handler(message, connection);
        if (result) {
          connection.ws.send(JSON.stringify(result));
        }
      } catch (error) {
        connection.ws.send(JSON.stringify({
          type: 'error',
          error: error.message
        }));
      }
    } else {
      // Default echo handler
      connection.ws.send(JSON.stringify({
        type: 'echo',
        timestamp: new Date().toISOString(),
        data: message
      }));
    }
  }
  
  handleDisconnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      this.connections.delete(connectionId);
      
      // Call disconnection callbacks
      this.disconnectionCallbacks.forEach(callback => callback(connection));
    }
  }
  
  checkConnections() {
    const now = new Date();
    const timeout = this.options.pingInterval * 2;
    
    for (const [connectionId, connection] of this.connections) {
      const idleTime = now - connection.lastActivity;
      
      if (idleTime > timeout) {
        connection.ws.terminate();
        this.connections.delete(connectionId);
      } else {
        // Send ping
        connection.ws.ping();
      }
    }
  }
  
  // Public API
  onConnection(callback) {
    this.connectionCallbacks.push(callback);
    return this;
  }
  
  onDisconnection(callback) {
    this.disconnectionCallbacks.push(callback);
    return this;
  }
  
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
    return this;
  }
  
  broadcast(message, filter = {}) {
    const messageStr = JSON.stringify(message);
    
    for (const connection of this.connections.values()) {
      // Apply filters
      if (filter.keypointId && connection.keypointId !== filter.keypointId) {
        continue;
      }
      
      if (filter.scope && (!connection.scopes || !connection.scopes.includes(filter.scope))) {
        continue;
      }
      
      if (filter.ip && connection.ip !== filter.ip) {
        continue;
      }
      
      connection.ws.send(messageStr);
    }
    
    return this.connections.size;
  }
  
  sendToConnection(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
  
  getConnection(connectionId) {
    return this.connections.get(connectionId);
  }
  
  getConnections(filter = {}) {
    let connections = Array.from(this.connections.values());
    
    if (filter.keypointId) {
      connections = connections.filter(c => c.keypointId === filter.keypointId);
    }
    
    if (filter.scope) {
      connections = connections.filter(c => 
        c.scopes && c.scopes.includes(filter.scope)
      );
    }
    
    if (filter.ip) {
      connections = connections.filter(c => c.ip === filter.ip);
    }
    
    return connections;
  }
  
  disconnect(connectionId) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.ws.close();
      return true;
    }
    return false;
  }
  
  disconnectAll(filter = {}) {
    const connections = this.getConnections(filter);
    
    for (const connection of connections) {
      connection.ws.close();
    }
    
    return connections.length;
  }
  
  getStats() {
    return {
      totalConnections: this.connections.size,
      connectionsByKeypoint: this.groupConnectionsByKeypoint(),
      connectionsByIp: this.groupConnectionsByIp(),
      uptime: this.getUptime()
    };
  }
  
  groupConnectionsByKeypoint() {
    const groups = {};
    
    for (const connection of this.connections.values()) {
      const key = connection.keypointId || 'anonymous';
      if (!groups[key]) groups[key] = 0;
      groups[key]++;
    }
    
    return groups;
  }
  
  groupConnectionsByIp() {
    const groups = {};
    
    for (const connection of this.connections.values()) {
      const ip = connection.ip;
      if (!groups[ip]) groups[ip] = 0;
      groups[ip]++;
    }
    
    return groups;
  }
  
  getUptime() {
    if (!this.wss) return 0;
    return Date.now() - this.wss.options.server?.startTime || Date.now();
  }
  
  cleanup() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    
    this.connections.clear();
    this.messageHandlers.clear();
  }
}