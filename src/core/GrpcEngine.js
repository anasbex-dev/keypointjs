// core/GrpcEngine.js

import { BaseProtocolEngine } from './BPE.js';
import crypto from 'crypto';

export class GrpcEngine extends BaseProtocolEngine {
  constructor(options = {}) {
    super(options);
    this.protocolName = 'grpc';
    this.supportedVersions = new Set(['1.0']);
    
    this.options = {
      maxMessageSize: '4mb',
      enableReflection: false,
      compression: 'none', // 'gzip', 'deflate'
      keepaliveTime: 7200000, // 2 hours
      ...options
    };
    
    this.services = new Map();
    this.interceptors = [];
  }
  
  async detect(connection) {
    // Detect gRPC over various transports
    const alpnProtocol = connection.alpnProtocol;
    
    if (alpnProtocol === 'h2') {
      // gRPC over HTTP/2
      return 'grpc+http2';
    } else if (connection.encrypted) {
      // gRPC over TLS
      return 'grpc+tls';
    }
    
    // Plain gRPC
    return 'grpc';
  }
  
  async parse(stream) {
    // Parse gRPC wire format
    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalLength = 0;
      
      stream.on('data', (chunk) => {
        totalLength += chunk.length;
        
        if (totalLength > this.parseSizeLimit()) {
          stream.destroy();
          reject(new ProtocolError('gRPC message too large', 413));
          return;
        }
        
        chunks.push(chunk);
      });
      
      stream.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          const message = this.decodeGRPCMessage(buffer);
          resolve(message);
        } catch (error) {
          reject(new ProtocolError(`Failed to parse gRPC message: ${error.message}`, 400));
        }
      });
      
      stream.on('error', reject);
    });
  }
  
  decodeGRPCMessage(buffer) {
    // Simple gRPC message decoding
    // Format: [1 byte compression flag] + [4 bytes message length] + [message]
    
    if (buffer.length < 5) {
      throw new Error('Invalid gRPC message format');
    }
    
    const compressed = buffer.readUInt8(0);
    const length = buffer.readUInt32BE(1);
    const message = buffer.slice(5, 5 + length);
    
    if (compressed === 1) {
      return this.decompress(message);
    }
    
    // Assuming Protobuf - in real implementation use protobuf.js
    return { raw: message, length };
  }
  
  decompress(buffer) {
    // Implement compression based on options
    if (this.options.compression === 'gzip') {
      const zlib = await import('zlib');
      return new Promise((resolve, reject) => {
        zlib.gunzip(buffer, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    }
    return buffer;
  }
  
  async validate(context) {
    // Validate gRPC-specific rules
    const { headers } = context.request;
    
    // Check required gRPC headers
    const requiredHeaders = ['content-type', 'te', 'user-agent'];
    for (const header of requiredHeaders) {
      if (!headers[header]) {
        throw new ProtocolError(`Missing gRPC header: ${header}`, 400);
      }
    }
    
    // Validate content-type
    const contentType = headers['content-type'];
    if (!contentType.startsWith('application/grpc')) {
      throw new ProtocolError(`Invalid gRPC content-type: ${contentType}`, 415);
    }
    
    // Validate TE header
    const te = headers['te'];
    if (te !== 'trailers') {
      throw new ProtocolError(`Invalid TE header: ${te}`, 400);
    }
    
    return true;
  }
  
  async process(connection) {
    const context = this.createContext({});
    
    // Detect gRPC variant
    context.protocol = await this.detect(connection);
    context.metadata.grpcVersion = '1.0';
    
    // Extract gRPC info
    context.request = {
      stream: connection,
      headers: connection.headers || {},
      method: this.extractGRPCMethod(connection),
      service: this.extractGRPCService(connection),
      authority: connection.authority,
      scheme: connection.scheme || 'http'
    };
    
    // Parse message if available
    if (connection.readableLength > 0) {
      context.request.message = await this.parse(connection);
    }
    
    // Validate
    await this.validate(context);
    
    // Add gRPC-specific metadata
    context.metadata.grpc = {
      contentType: context.request.headers['content-type'],
      acceptEncoding: context.request.headers['grpc-accept-encoding'],
      encoding: context.request.headers['grpc-encoding'],
      timeout: context.request.headers['grpc-timeout'],
      messageEncoding: context.request.headers['grpc-message-encoding']
    };
    
    // Run interceptors
    await this.runInterceptors(context);
    
    return context;
  }
  
  extractGRPCMethod(connection) {
    const path = connection.headers[':path'] || '';
    // gRPC path format: /package.service/method
    const match = path.match(/\/([^\/]+\.[^\/]+)\/(.+)/);
    return match ? match[2] : '';
  }
  
  extractGRPCService(connection) {
    const path = connection.headers[':path'] || '';
    const match = path.match(/\/([^\/]+\.[^\/]+)\//);
    return match ? match[1] : '';
  }
  
  addService(serviceName, handler) {
    this.services.set(serviceName, handler);
  }
  
  addInterceptor(interceptor) {
    this.interceptors.push(interceptor);
  }
  
  async runInterceptors(context) {
    for (const interceptor of this.interceptors) {
      await interceptor(context);
    }
  }
  
  createGRPCResponse(message, options = {}) {
    const compressionFlag = options.compressed ? 1 : 0;
    const messageBuffer = Buffer.from(JSON.stringify(message));
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(messageBuffer.length);
    
    const header = Buffer.from([compressionFlag]);
    return Buffer.concat([header, lengthBuffer, messageBuffer]);
  }
}