#!/usr/bin/env node

/**
 * @fileoverview 企业微信机器人 MCP 服务器主入口
 * @description 基于 Model Context Protocol (MCP) 标准实现的企业微信机器人服务
 * 
 * 功能特性：
 * - send_message: 发送 Markdown V2 格式消息
 * - send_file: 发送文件
 * - send_image: 发送图片
 * 
 * 通信方式：stdio（标准输入输出）+ JSON-RPC 2.0 协议
 * 
 * @example
 * // 直接运行
 * node index.js
 * 
 * // Claude Desktop 配置
 * {
 *   "mcpServers": {
 *     "wecom-robot": {
 *       "command": "node",
 *       "args": ["/path/to/WeComRobot/index.js"]
 *     }
 *   }
 * }
 * 
 * @module index
 */

import { createInterface } from 'readline';
import { tools, ToolHandler } from './src/tools.js';

/**
 * MCP 协议版本号
 * @constant {string}
 */
const MCP_VERSION = '2024-11-05';

/**
 * 从环境变量读取企业微信机器人配置
 * @constant {string|null}
 */
const WECOM_WEBHOOK_KEY = process.env.WECOM_WEBHOOK_KEY || null;

/**
 * 服务器元信息
 * @constant {Object}
 * @property {string} name - 服务器名称
 * @property {string} version - 版本号
 * @property {string} description - 描述信息
 */
const SERVER_INFO = {
  name: 'wecom-robot-mcp',
  version: '1.0.0',
  description: '企业微信机器人 MCP 服务，支持发送消息、文件和图片'
};

/**
 * JSON-RPC 错误码定义
 * @enum {number}
 */
const JSONRPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};

/**
 * @typedef {Object} JsonRpcRequest
 * @property {string} jsonrpc - JSON-RPC 版本（固定为 "2.0"）
 * @property {string|number|null} id - 请求 ID
 * @property {string} method - 方法名
 * @property {Object} [params] - 方法参数
 */

/**
 * @typedef {Object} JsonRpcResponse
 * @property {string} jsonrpc - JSON-RPC 版本（固定为 "2.0"）
 * @property {string|number|null} id - 请求 ID
 * @property {Object} [result] - 响应结果
 * @property {Object} [error] - 错误信息
 */

/**
 * @typedef {Object} JsonRpcError
 * @property {number} code - 错误码
 * @property {string} message - 错误消息
 * @property {*} [data] - 额外错误数据
 */

/**
 * 获取有效的 webhook key
 * 
 * 优先级：调用时提供的 key > 环境变量配置的 key
 * 
 * @param {string} [providedKey] - 调用时提供的 webhook key
 * @returns {string|null} webhook key，如果都未提供则返回 null
 */
function getWebhookKey(providedKey) {
  return providedKey || WECOM_WEBHOOK_KEY;
}

/**
 * MCP 服务器类
 * 
 * 实现 JSON-RPC 2.0 协议处理，通过 stdio 与客户端通信
 * 支持 MCP 协议定义的所有标准方法
 * 
 * @example
 * const server = new MCPServer();
 * server.start();
 */
class MCPServer {
  /**
   * 创建 MCP 服务器实例
   */
  constructor() {
    /**
     * @private
     * @type {ToolHandler}
     */
    this.toolHandler = new ToolHandler();

    /**
     * @private
     * @type {import('readline').Interface|null}
     */
    this.rl = null;

    /**
     * @private
     * @type {boolean}
     */
    this.isInitialized = false;

    // 绑定方法上下文
    this.handleLine = this.handleLine.bind(this);
    this.sendResponse = this.sendResponse.bind(this);
    this.sendNotification = this.sendNotification.bind(this);
    this.log = this.log.bind(this);
  }

  /**
   * 启动 MCP 服务器
   * 
   * 设置标准输入监听，开始处理 JSON-RPC 请求
   * 注册进程信号处理器以优雅关闭
   */
  start() {
    // 创建 readline 接口读取标准输入
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    // 监听输入行
    this.rl.on('line', this.handleLine);

    // 处理进程退出信号
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());

    // 监听标准输入关闭事件
    process.stdin.on('end', () => this.shutdown());

    // 记录启动日志
    this.log('MCP 服务器已启动，等待请求...');
  }

  /**
   * 处理输入行（JSON-RPC 请求）
   * 
   * 解析 JSON，验证协议版本，路由到相应处理器
   * 
   * @param {string} line - 输入的 JSON 字符串
   * @private
   */
  async handleLine(line) {
    // 跳过空行
    if (!line.trim()) {
      return;
    }

    this.log(`收到请求：${this._truncateString(line, 100)}...`);

    /** @type {JsonRpcRequest} */
    let request;

    // 解析 JSON
    try {
      request = JSON.parse(line);
    } catch (error) {
      this.log(`JSON 解析失败：${error.message}`);
      this.sendError(null, JSONRPC_ERROR.PARSE_ERROR, 'Parse error', error.message);
      return;
    }

    // 验证 JSON-RPC 版本
    if (request.jsonrpc !== '2.0') {
      this.log(`不支持的 JSON-RPC 版本：${request.jsonrpc}`);
      this.sendError(
        request.id,
        JSONRPC_ERROR.INVALID_REQUEST,
        'Invalid Request',
        '不支持的 JSON-RPC 版本，仅支持 2.0'
      );
      return;
    }

    // 路由请求到处理器
    try {
      await this.routeRequest(request);
    } catch (error) {
      this.log(`请求处理失败：${error.message}`);
      this.sendError(
        request.id,
        JSONRPC_ERROR.INTERNAL_ERROR,
        'Internal error',
        error.message
      );
    }
  }

  /**
   * 路由 JSON-RPC 请求到相应处理器
   * 
   * 支持的方法：
   * - initialize: 初始化连接
   * - initialized: 客户端初始化完成通知
   * - ping: 健康检查
   * - tools/list: 获取工具列表
   * - tools/call: 调用工具
   * - resources/list: 资源列表（返回空）
   * - resources/read: 资源读取（不支持）
   * - prompts/list: 提示列表（返回空）
   * - prompts/get: 获取提示（不支持）
   * 
   * @param {JsonRpcRequest} request - JSON-RPC 请求对象
   * @private
   */
  async routeRequest(request) {
    const { method, params, id } = request;

    this.log(`路由请求：method=${method}`);

    switch (method) {
      // MCP 协议方法
      case 'initialize':
        await this.handleInitialize(request);
        break;

      case 'initialized':
        // 客户端通知服务器初始化完成，无需响应
        this.isInitialized = true;
        this.log('客户端已初始化');
        break;

      case 'ping':
        this.sendResponse(id, {});
        break;

      // 工具相关方法
      case 'tools/list':
        this.handleToolsList(request);
        break;

      case 'tools/call':
        await this.handleToolsCall(request);
        break;

      // 资源相关方法（本服务不提供资源）
      case 'resources/list':
        this.sendResponse(id, { resources: [] });
        break;

      case 'resources/read':
        this.sendError(
          id,
          JSONRPC_ERROR.METHOD_NOT_FOUND,
          'Method not found',
          '本服务不支持资源读取'
        );
        break;

      // 提示相关方法（本服务不提供提示）
      case 'prompts/list':
        this.sendResponse(id, { prompts: [] });
        break;

      case 'prompts/get':
        this.sendError(
          id,
          JSONRPC_ERROR.METHOD_NOT_FOUND,
          'Method not found',
          '本服务不支持提示功能'
        );
        break;

      default:
        this.log(`未知方法：${method}`);
        this.sendError(
          id,
          JSONRPC_ERROR.METHOD_NOT_FOUND,
          'Method not found',
          `未知方法：${method}`
        );
    }
  }

  /**
   * 处理 initialize 请求
   * 
   * 响应服务器信息和能力声明
   * 
   * @param {JsonRpcRequest} request - JSON-RPC 请求
   * @private
   */
  async handleInitialize(request) {
    const { params } = request;

    this.log(`客户端初始化：${JSON.stringify(params?.clientInfo || {})}`);

    const response = {
      protocolVersion: MCP_VERSION,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      serverInfo: SERVER_INFO
    };

    this.sendResponse(request.id, response);
  }

  /**
   * 处理 tools/list 请求
   * 
   * 返回所有可用工具的列表及其 schema
   * 
   * @param {JsonRpcRequest} request - JSON-RPC 请求
   * @private
   */
  handleToolsList(request) {
    const toolsInfo = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));

    this.sendResponse(request.id, {
      tools: toolsInfo
    });
  }

  /**
   * 处理 tools/call 请求
   * 
   * 调用指定的工具并返回执行结果
   * 
   * @param {JsonRpcRequest} request - JSON-RPC 请求
   * @private
   */
  async handleToolsCall(request) {
    const { params } = request;
    const { name, arguments: args } = params || {};

    if (!name) {
      this.sendError(
        request.id,
        JSONRPC_ERROR.INVALID_PARAMS,
        'Invalid params',
        '缺少工具名称'
      );
      return;
    }

    this.log(`调用工具：${name}, 参数：${this._truncateString(JSON.stringify(args), 200)}`);

    try {
      const result = await this.toolHandler.handle(name, args || {});
      this.sendResponse(request.id, result);
    } catch (error) {
      this.log(`工具执行失败：${error.message}`);
      this.sendError(
        request.id,
        JSONRPC_ERROR.INTERNAL_ERROR,
        'Tool execution failed',
        error.message
      );
    }
  }

  /**
   * 发送 JSON-RPC 响应
   * 
   * @param {string|number|null} id - 请求 ID
   * @param {*} result - 响应结果
   * @private
   */
  sendResponse(id, result) {
    /** @type {JsonRpcResponse} */
    const response = {
      jsonrpc: '2.0',
      id: id,
      result: result
    };

    this._sendJSON(response);
  }

  /**
   * 发送 JSON-RPC 错误响应
   * 
   * @param {string|number|null} id - 请求 ID
   * @param {number} code - 错误码
   * @param {string} message - 错误消息
   * @param {*} [data] - 额外错误数据
   * @private
   */
  sendError(id, code, message, data = null) {
    /** @type {JsonRpcResponse} */
    const error = {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: code,
        message: message
      }
    };

    if (data !== null) {
      error.error.data = data;
    }

    this._sendJSON(error);
  }

  /**
   * 发送 JSON-RPC 通知
   * 
   * 通知是没有 ID 的请求，不需要响应
   * 
   * @param {string} method - 通知方法
   * @param {Object} [params] - 通知参数
   * @private
   */
  sendNotification(method, params = {}) {
    /** @type {JsonRpcRequest} */
    const notification = {
      jsonrpc: '2.0',
      method: method,
      params: params
    };

    this._sendJSON(notification);
  }

  /**
   * 发送 JSON 对象到标准输出
   * 
   * @param {Object} obj - 要发送的对象
   * @private
   */
  _sendJSON(obj) {
    const json = JSON.stringify(obj);
    process.stdout.write(json + '\n');
    this.log(`发送响应：${this._truncateString(json, 100)}...`);
  }

  /**
   * 记录日志到标准错误
   * 
   * 使用 stderr 避免干扰 stdout 的 JSON-RPC 通信
   * 
   * @param {string} message - 日志消息
   */
  log(message) {
    const timestamp = new Date().toISOString();
    process.stderr.write(`[${timestamp}] ${message}\n`);
  }

  /**
   * 截断长字符串用于日志显示
   * 
   * @param {string} str - 要截断的字符串
   * @param {number} maxLength - 最大长度
   * @returns {string} 截断后的字符串
   * @private
   */
  _truncateString(str, maxLength) {
    if (str.length <= maxLength) {
      return str;
    }
    return str.substring(0, maxLength);
  }

  /**
   * 关闭服务器
   * 
   * 优雅关闭：关闭 readline 接口，发送关闭通知，退出进程
   */
  shutdown() {
    this.log('正在关闭服务器...');

    if (this.rl) {
      this.rl.close();
    }

    // 发送关闭通知
    this.sendNotification('notifications/closed');

    process.exit(0);
  }
}

/**
 * 记录日志到标准错误
 * 
 * 使用 stderr 避免干扰 stdout 的 JSON-RPC 通信
 * 
 * @param {string} message - 日志消息
 */
function log(message) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] ${message}\n`);
}

/**
 * 主入口函数
 * 
 * 检查环境变量配置，启动 MCP 服务器
 */
function main() {
  // 启动时检查环境变量
  if (!WECOM_WEBHOOK_KEY) {
    log('警告：未设置 WECOM_WEBHOOK_KEY 环境变量，调用工具时必须提供 webhook_key 参数');
  } else {
    // 脱敏显示 webhook key（仅显示首尾各 8 位）
    const keyLength = WECOM_WEBHOOK_KEY.length;
    const maskedKey = keyLength > 16
      ? `${WECOM_WEBHOOK_KEY.substring(0, 8)}...${WECOM_WEBHOOK_KEY.substring(keyLength - 8)}`
      : '***';
    log(`已配置 WECOM_WEBHOOK_KEY: ${maskedKey}`);
  }

  const server = new MCPServer();
  server.start();
}

// 运行主入口
main();
