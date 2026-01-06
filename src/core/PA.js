// core/ProtocolAdapter.js

import { HttpEngine } from './HttpEngine.js';
import { GrpcEngine } from './GrpcEngine.js';
import { WsEngine } from './WsEngine.js';

export class ProtocolAdapter {
  constructor(options = {}) {
    this.engines = new Map();
    this.defaultEngine = 'http';
    
    // Initialize engines
    this.registerEngine('http', new HttpEngine(options.http));
    this.registerEngine('https', new HttpEngine({ ...options.http, defaultSecure: true }));
    this.registerEngine('grpc', new GrpcEngine(options.grpc));
    this.registerEngine('ws', new WsEngine(options.ws));
    this.registerEngine('wss', new WsEngine({ ...options.ws, defaultSecure: true }));
  }
  
  registerEngine(name, engine) {
    this.engines.set(name, engine);
  }
  
  getEngine(protocol) {
    const engine = this.engines.get(protocol);
    if (!engine) {
      throw new Error(`No engine registered for protocol: ${protocol}`);
    }
    return engine;
  }
  
  async detectProtocol(request) {
    // Try to detect protocol from request
    const upgrade = request.headers?.upgrade;
    const contentType = request.headers?.['content-type'];
    const scheme = request.scheme;
    
    // Check WebSocket
    if (upgrade?.toLowerCase() === 'websocket') {
      const isSecure = request.connection?.encrypted || request.secure;
      return isSecure ? 'wss' : 'ws';
    }
    
    // Check gRPC
    if (contentType?.startsWith('application/grpc')) {
      return 'grpc';
    }
    
    // Check HTTP/HTTPS
    const isSecure = request.connection?.encrypted ||
      request.socket?.encrypted ||
      request.secure ||
      scheme === 'https';
    
    return isSecure ? 'https' : 'http';
  }
  
  async process(request) {
    const protocol = await this.detectProtocol(request);
    const engine = this.getEngine(protocol);
    
    try {
      const context = await engine.process(request);
      context.metadata.processedBy = protocol;
      return context;
    } catch (error) {
      error.protocol = protocol;
      throw error;
    }
  }
  
  // Multi-protocol server creation
  createServer(options = {}) {
    const servers = {};
    
    // Create HTTP/HTTPS server
    if (options.http !== false) {
      const http = require('http');
      const https = require('https');
      
      if (options.https) {
        servers.https = https.createServer(options.https, this.handleRequest.bind(this));
      }
      
      servers.http = http.createServer(this.handleRequest.bind(this));
    }
    
    // Note: gRPC and WebSocket would need their own server setup
    return servers;
  }
  
  async handleRequest(req, res) {
    try {
      const context = await this.process(req);
      
      // Handle based on protocol
      const engine = this.getEngine(context.protocol);
      
      if (context.protocol.startsWith('ws')) {
        // WebSocket handshake
        const wsEngine = engine;
        const handshakeResponse = wsEngine.createHandshakeResponse(context);
        res.writeHead(101, handshakeResponse);
        res.end();
        
        // Handle WebSocket connection
        this.handleWebSocket(req.socket, req, context);
      } else {
        // HTTP/HTTPS response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          protocol: context.protocol,
          message: 'Request processed'
        }));
      }
    } catch (error) {
      console.error('Protocol handling error:', error);
      res.writeHead(error.code || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: error.message,
        protocol: error.protocol
      }));
    }
  }
  
  handleWebSocket(socket, req, context) {
    const wsEngine = this.getEngine(context.protocol);
    
    socket.on('data', async (data) => {
      try {
        const frame = await wsEngine.parse(data);
        
        // Emit event based on opcode
        switch (frame.opcode) {
          case 1: // Text
            this.eventEmitter.emit('message', {
              connectionId: context.connectionId,
              data: frame.payload.toString(),
              frame
            });
            break;
          case 2: // Binary
            this.eventEmitter.emit('binary', {
              connectionId: context.connectionId,
              data: frame.payload,
              frame
            });
            break;
          case 8: // Close
            this.eventEmitter.emit('close', context.connectionId);
            break;
          case 9: // Ping
            this.eventEmitter.emit('ping', context.connectionId);
            // Auto respond with pong
            const pongFrame = wsEngine.createFrame('', { opcode: 10 });
            socket.write(pongFrame);
            break;
        }
      } catch (error) {
        this.eventEmitter.emit('error', { connectionId: context.connectionId, error });
      }
    });
  }
  
  // Event handling
  on(event, handler) {
    this.eventEmitter.on(event, handler);
  }
}