// core/WsEngine.js

import { BaseProtocolEngine } from './BPE.js';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export class WsEngine extends BaseProtocolEngine {
  constructor(options = {}) {
    super(options);
    this.protocolName = 'ws';
    this.supportedVersions = new Set(['13']); // RFC 6455
    
    this.options = {
      maxPayload: '16mb',
      pingInterval: 30000,
      pongTimeout: 10000,
      compression: false,
      perMessageDeflate: false,
      ...options
    };
    
    this.connections = new Map();
    this.eventEmitter = new EventEmitter();
    this.messageHandlers = new Map();
  }
  
  async detect(request) {
    // WebSocket detection
    const upgrade = request.headers['upgrade'];
    const connection = request.headers['connection'];
    const key = request.headers['sec-websocket-key'];
    const version = request.headers['sec-websocket-version'];
    
    if (upgrade?.toLowerCase() !== 'websocket') {
      throw new ProtocolError('Not a WebSocket request', 400);
    }
    
    if (!connection?.toLowerCase().includes('upgrade')) {
      throw new ProtocolError('Invalid Connection header', 400);
    }
    
    if (!key) {
      throw new ProtocolError('Missing Sec-WebSocket-Key', 400);
    }
    
    if (version !== '13') {
      throw new ProtocolError(`Unsupported WebSocket version: ${version}`, 426);
    }
    
    // Check if secure
    const isSecure = request.connection?.encrypted || 
                    request.socket?.encrypted ||
                    request.secure;
    
    return isSecure ? 'wss' : 'ws';
  }
  
  async parse(frame) {
    // Parse WebSocket frame
    // Format: [fin+rsv+opcode] [mask+payloadLen] [extendedLen] [maskingKey] [payload]
    
    const buffer = Buffer.from(frame);
    
    if (buffer.length < 2) {
      throw new Error('Invalid WebSocket frame');
    }
    
    const firstByte = buffer.readUInt8(0);
    const secondByte = buffer.readUInt8(1);
    
    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0F;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7F;
    
    let offset = 2;
    
    // Extended payload length
    if (payloadLength === 126) {
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      // 64-bit length (first 4 bytes must be 0 for WebSocket)
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      
      if (high !== 0) {
        throw new Error('Payload length too large');
      }
      
      payloadLength = low;
      offset += 8;
    }
    
    // Check size limit
    if (payloadLength > this.parseSizeLimit()) {
      throw new ProtocolError('WebSocket payload too large', 413);
    }
    
    // Masking key
    let maskingKey;
    if (masked) {
      maskingKey = buffer.slice(offset, offset + 4);
      offset += 4;
    }
    
    // Payload
    const payload = buffer.slice(offset, offset + payloadLength);
    
    // Unmask if necessary
    let unmaskedPayload = payload;
    if (masked && maskingKey) {
      unmaskedPayload = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        unmaskedPayload[i] = payload[i] ^ maskingKey[i % 4];
      }
    }
    
    return {
      fin,
      opcode,
      masked,
      payloadLength,
      payload: unmaskedPayload,
      raw: buffer
    };
  }
  
  async validate(context) {
    const { headers, request } = context;
    
    // Validate WebSocket headers
    const requiredHeaders = [
      'upgrade',
      'connection', 
      'sec-websocket-key',
      'sec-websocket-version'
    ];
    
    for (const header of requiredHeaders) {
      if (!headers[header]) {
        throw new ProtocolError(`Missing WebSocket header: ${header}`, 400);
      }
    }
    
    // Validate protocol version
    if (headers['sec-websocket-version'] !== '13') {
      throw new ProtocolError('WebSocket version must be 13', 426);
    }
    
    // Validate subprotocols if requested
    const clientProtocols = headers['sec-websocket-protocol'];
    const serverProtocols = this.options.subprotocols || [];
    
    if (clientProtocols && serverProtocols.length > 0) {
      const clientProtocolList = clientProtocols.split(',').map(p => p.trim());
      const hasCommonProtocol = clientProtocolList.some(p => 
        serverProtocols.includes(p)
      );
      
      if (!hasCommonProtocol) {
        throw new ProtocolError('No common subprotocol', 400);
      }
    }
    
    return true;
  }
  
  async process(socket, request) {
    const context = this.createContext(request);
    
    // Detect protocol
    context.protocol = await this.detect(request);
    context.metadata.wsVersion = '13';
    
    // Extract WebSocket info
    context.request = {
      socket,
      headers: request.headers,
      url: request.url,
      method: request.method,
      ip: this.extractIP(request),
      key: request.headers['sec-websocket-key'],
      version: request.headers['sec-websocket-version'],
      protocols: request.headers['sec-websocket-protocol']?.split(',').map(p => p.trim()) || [],
      extensions: request.headers['sec-websocket-extensions']
    };
    
    // Generate accept key (for handshake response)
    const acceptKey = this.generateAcceptKey(context.request.key);
    context.metadata.acceptKey = acceptKey;
    
    // Validate
    await this.validate(context);
    
    // Add WebSocket-specific metadata
    context.metadata.ws = {
      key: context.request.key,
      acceptKey,
      protocols: context.request.protocols,
      extensions: context.request.extensions,
      origin: request.headers.origin,
      host: request.headers.host
    };
    
    // Store connection
    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, {
      id: connectionId,
      socket,
      context,
      connectedAt: new Date(),
      lastActivity: new Date()
    });
    
    context.connectionId = connectionId;
    
    return context;
  }
  
  generateAcceptKey(key) {
    const SHA1 = crypto.createHash('sha1');
    const magicString = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    SHA1.update(key + magicString);
    return SHA1.digest('base64');
  }
  
  createHandshakeResponse(context) {
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${context.metadata.acceptKey}`
    ];
    
    // Add subprotocol if negotiated
    if (context.metadata.selectedProtocol) {
      headers.push(`Sec-WebSocket-Protocol: ${context.metadata.selectedProtocol}`);
    }
    
    // Add extensions if supported
    if (this.options.perMessageDeflate) {
      headers.push('Sec-WebSocket-Extensions: permessage-deflate');
    }
    
    headers.push('', ''); // Empty line to end headers
    
    return headers.join('\r\n');
  }
  
  createFrame(payload, options = {}) {
    const { opcode = 1, fin = true, masked = false } = options;
    const payloadBuffer = Buffer.from(
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    );
    
    const payloadLength = payloadBuffer.length;
    let frameBuffer;
    let offset = 0;
    
    // First byte: FIN + RSV + OPCODE
    const firstByte = (fin ? 0x80 : 0x00) | (opcode & 0x0F);
    
    // Determine frame size
    if (payloadLength < 126) {
      frameBuffer = Buffer.alloc(2 + (masked ? 4 : 0) + payloadLength);
      frameBuffer.writeUInt8(firstByte, offset++);
      frameBuffer.writeUInt8((masked ? 0x80 : 0x00) | payloadLength, offset++);
    } else if (payloadLength < 65536) {
      frameBuffer = Buffer.alloc(4 + (masked ? 4 : 0) + payloadLength);
      frameBuffer.writeUInt8(firstByte, offset++);
      frameBuffer.writeUInt8((masked ? 0x80 : 0x00) | 126, offset++);
      frameBuffer.writeUInt16BE(payloadLength, offset);
      offset += 2;
    } else {
      frameBuffer = Buffer.alloc(10 + (masked ? 4 : 0) + payloadLength);
      frameBuffer.writeUInt8(firstByte, offset++);
      frameBuffer.writeUInt8((masked ? 0x80 : 0x00) | 127, offset++);
      frameBuffer.writeUInt32BE(0, offset); // High 32 bits must be 0
      offset += 4;
      frameBuffer.writeUInt32BE(payloadLength, offset);
      offset += 4;
    }
    
    // Add masking key if needed
    let maskingKey;
    if (masked) {
      maskingKey = crypto.randomBytes(4);
      maskingKey.copy(frameBuffer, offset);
      offset += 4;
    }
    
    // Add payload
    if (masked && maskingKey) {
      for (let i = 0; i < payloadLength; i++) {
        frameBuffer[offset + i] = payloadBuffer[i] ^ maskingKey[i % 4];
      }
    } else {
      payloadBuffer.copy(frameBuffer, offset);
    }
    
    return frameBuffer;
  }
  
  // Connection management
  getConnection(id) {
    return this.connections.get(id);
  }
  
  broadcast(message, filter = {}) {
    const frame = this.createFrame(message);
    
    for (const [id, connection] of this.connections) {
      // Apply filters
      if (filter.protocols && !connection.context.request.protocols.some(p => 
        filter.protocols.includes(p))) {
        continue;
      }
      
      connection.socket.write(frame);
    }
  }
  
  sendToConnection(connectionId, message) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      const frame = this.createFrame(message);
      connection.socket.write(frame);
      return true;
    }
    return false;
  }
}