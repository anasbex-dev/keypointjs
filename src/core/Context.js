export class Context {
  constructor(request) {
    this.request = request;
    this.response = {
      status: 200,
      headers: {},
      body: null
    };
    this.state = {};
    this.keypoint = null;
    this.policyDecision = null;
    this.pluginData = new Map();
  }
  
  // Response helpers
  json(data, status = 200) {
    this.response.status = status;
    this.response.body = data;
    this.response.headers['content-type'] = 'application/json';
    return this;
  }
  
  text(data, status = 200) {
    this.response.status = status;
    this.response.body = data;
    this.response.headers['content-type'] = 'text/plain';
    return this;
  }
  
  html(data, status = 200) {
    this.response.status = status;
    this.response.body = data;
    this.response.headers['content-type'] = 'text/html';
    return this;
  }
  
  setHeader(key, value) {
    this.response.headers[key.toLowerCase()] = value;
    return this;
  }
  
  getHeader(key) {
    return this.request.headers[key.toLowerCase()];
  }
  
  status(code) {
    this.response.status = code;
    return this;
  }
  
  // Query and param helpers
  getQuery(key) {
    return this.request.url.searchParams.get(key);
  }
  
  getAllQuery() {
    const result = {};
    for (const [key, value] of this.request.url.searchParams) {
      result[key] = value;
    }
    return result;
  }
  
  // Body accessor
  get body() {
    return this.request.body;
  }
  
  // Protocol info
  get protocol() {
    return this.request.protocol;
  }
  
  get ip() {
    return this.request.ip;
  }
  
  get method() {
    return this.request.method;
  }
  
  get path() {
    return this.request.url.pathname;
  }
  
  // State management
  setState(key, value) {
    this.state[key] = value;
    return this;
  }
  
  getState(key) {
    return this.state[key];
  }
  
  // Plugin data
  setPluginData(pluginName, data) {
    this.pluginData.set(pluginName, data);
  }
  
  getPluginData(pluginName) {
    return this.pluginData.get(pluginName);
  }
}