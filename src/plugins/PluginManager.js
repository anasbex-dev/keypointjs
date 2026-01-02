export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.middlewareChain = [];
    this.events = new Map();
    this.hooks = new Map();
  }
  
  register(plugin, options = {}) {
    const pluginName = plugin.constructor.name;
    
    if (this.plugins.has(pluginName)) {
      throw new Error(`Plugin ${pluginName} already registered`);
    }
    
    // Initialize plugin
    plugin.name = pluginName;
    plugin.options = options;
    plugin.enabled = true;
    
    this.plugins.set(pluginName, plugin);
    
    // Add plugin's middleware if it has process method
    if (typeof plugin.process === 'function') {
      this.middlewareChain.push(async (ctx, next) => {
        if (!plugin.enabled) return next(ctx);
        return plugin.process(ctx, next);
      });
    }
    
    // Register plugin events
    if (typeof plugin.on === 'function') {
      plugin.on('*', (event, data) => {
        this.emit(event, data);
      });
    }
    
    // Setup hooks
    if (plugin.hooks) {
      for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
        this.addHook(hookName, hookFn);
      }
    }
    
    console.log(`Plugin registered: ${pluginName}`);
    return this;
  }
  
  unregister(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return false;
    
    // Remove middleware
    const index = this.middlewareChain.findIndex(middleware => {
      // Find middleware that uses this plugin
      return middleware.toString().includes(pluginName);
    });
    
    if (index !== -1) {
      this.middlewareChain.splice(index, 1);
    }
    
    // Cleanup plugin
    if (typeof plugin.cleanup === 'function') {
      plugin.cleanup();
    }
    
    this.plugins.delete(pluginName);
    console.log(`Plugin unregistered: ${pluginName}`);
    return true;
  }
  
  enable(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      plugin.enabled = true;
      return true;
    }
    return false;
  }
  
  disable(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      plugin.enabled = false;
      return true;
    }
    return false;
  }
  
  async process(context, next) {
    // Run through plugin middleware chain
    let index = 0;
    
    const runNext = async () => {
      if (index >= this.middlewareChain.length) {
        return next(context);
      }
      
      const middleware = this.middlewareChain[index];
      index++;
      
      return middleware(context, runNext);
    };
    
    return runNext();
  }
  
  // Event system
  on(event, handler) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push(handler);
    return this;
  }
  
  off(event, handler) {
    if (!this.events.has(event)) return;
    
    const handlers = this.events.get(event);
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
    return this;
  }
  
  emit(event, data) {
    if (!this.events.has(event)) return;
    
    const handlers = this.events.get(event);
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }
    
    // Also emit to wildcard handlers
    if (this.events.has('*')) {
      const wildcardHandlers = this.events.get('*');
      for (const handler of wildcardHandlers) {
        try {
          handler(event, data);
        } catch (error) {
          console.error(`Error in wildcard event handler:`, error);
        }
      }
    }
  }
  
  // Hook system
  addHook(hookName, hookFn) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }
    this.hooks.get(hookName).push(hookFn);
    return this;
  }
  
  async runHook(hookName, ...args) {
    if (!this.hooks.has(hookName)) return [];
    
    const results = [];
    const hooks = this.hooks.get(hookName);
    
    for (const hookFn of hooks) {
      try {
        const result = await hookFn(...args);
        if (result !== undefined) {
          results.push(result);
        }
      } catch (error) {
        console.error(`Error in hook ${hookName}:`, error);
      }
    }
    
    return results;
  }
  
  // Plugin management
  getPlugin(pluginName) {
    return this.plugins.get(pluginName);
  }
  
  getAllPlugins() {
    return Array.from(this.plugins.values());
  }
  
  getPluginNames() {
    return Array.from(this.plugins.keys());
  }
  
  getEnabledPlugins() {
    return Array.from(this.plugins.values()).filter(p => p.enabled);
  }
  
  // Configuration
  configurePlugin(pluginName, config) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return false;
    
    if (typeof plugin.configure === 'function') {
      plugin.configure(config);
      return true;
    }
    
    // Merge options if no configure method
    plugin.options = { ...plugin.options, ...config };
    return true;
  }
  
  // Statistics
  getStats() {
    return {
      totalPlugins: this.plugins.size,
      enabledPlugins: this.getEnabledPlugins().length,
      disabledPlugins: this.plugins.size - this.getEnabledPlugins().length,
      middlewareCount: this.middlewareChain.length,
      eventCount: Array.from(this.events.values()).reduce((sum, handlers) => sum + handlers.length, 0),
      hookCount: Array.from(this.hooks.values()).reduce((sum, hooks) => sum + hooks.length, 0),
      plugins: this.getAllPlugins().map(p => ({
        name: p.name,
        enabled: p.enabled,
        hasProcess: typeof p.process === 'function',
        hasCleanup: typeof p.cleanup === 'function'
      }))
    };
  }
  
  // Lifecycle
  async initialize() {
    // Run initialization hooks
    await this.runHook('initialize', this);
    
    // Initialize all plugins
    for (const plugin of this.plugins.values()) {
      if (typeof plugin.initialize === 'function') {
        try {
          await plugin.initialize();
          console.log(`Plugin initialized: ${plugin.name}`);
        } catch (error) {
          console.error(`Failed to initialize plugin ${plugin.name}:`, error);
        }
      }
    }
    
    this.emit('initialized', { timestamp: new Date() });
  }
  
  async shutdown() {
    // Run shutdown hooks
    await this.runHook('shutdown', this);
    
    // Shutdown all plugins
    for (const plugin of this.plugins.values()) {
      if (typeof plugin.shutdown === 'function') {
        try {
          await plugin.shutdown();
          console.log(`Plugin shutdown: ${plugin.name}`);
        } catch (error) {
          console.error(`Failed to shutdown plugin ${plugin.name}:`, error);
        }
      }
    }
    
    this.emit('shutdown', { timestamp: new Date() });
    this.clear();
  }
  
  clear() {
    this.plugins.clear();
    this.middlewareChain = [];
    this.events.clear();
    this.hooks.clear();
  }
}

// Built-in hooks
export const BuiltInHooks = {
  // Request lifecycle hooks
  BEFORE_KEYPOINT_VALIDATION: 'before_keypoint_validation',
  AFTER_KEYPOINT_VALIDATION: 'after_keypoint_validation',
  BEFORE_POLICY_CHECK: 'before_policy_check',
  AFTER_POLICY_CHECK: 'after_policy_check',
  BEFORE_ROUTE_EXECUTION: 'before_route_execution',
  AFTER_ROUTE_EXECUTION: 'after_route_execution',
  BEFORE_RESPONSE: 'before_response',
  AFTER_RESPONSE: 'after_response',
  
  // Error hooks
  ON_ERROR: 'on_error',
  
  // Plugin lifecycle hooks
  PLUGIN_REGISTERED: 'plugin_registered',
  PLUGIN_UNREGISTERED: 'plugin_unregistered',
  
  // System hooks
  INITIALIZE: 'initialize',
  SHUTDOWN: 'shutdown'
};