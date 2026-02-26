/**
 * @fileoverview MCP 工具定义和处理器
 * @description 定义企业微信机器人 MCP 服务提供的所有工具及其处理逻辑
 * 
 * 符合 MCP (Model Context Protocol) 规范
 * 参考：https://modelcontextprotocol.io/
 * 
 * @module tools
 */

import { WeComClient, WeComError } from './wecom-client.js';

/**
 * 从环境变量获取默认的 webhook key
 * @constant {string|null}
 */
const DEFAULT_WEBHOOK_KEY = process.env.WECOM_WEBHOOK_KEY || null;

/**
 * @typedef {Object} ToolDefinition
 * @property {string} name - 工具名称
 * @property {string} description - 工具描述
 * @property {Object} inputSchema - JSON Schema 格式的输入参数定义
 */

/**
 * @typedef {Object} ToolResult
 * @property {Array<ContentItem>} content - 响应内容数组
 * @property {boolean} [isError] - 是否错误响应
 */

/**
 * @typedef {Object} ContentItem
 * @property {string} type - 内容类型（text, image 等）
 * @property {string} text - 文本内容
 */

/**
 * @typedef {Object} SendMessageArgs
 * @property {string} [webhook_key] - 企业微信机器人的 webhook key（可选，可从环境变量获取）
 * @property {string} content - Markdown V2 格式的消息内容
 */

/**
 * @typedef {Object} SendFileArgs
 * @property {string} [webhook_key] - 企业微信机器人的 webhook key（可选，可从环境变量获取）
 * @property {string} file_path - 本地文件的绝对路径或相对路径
 */

/**
 * @typedef {Object} SendImageArgs
 * @property {string} [webhook_key] - 企业微信机器人的 webhook key（可选，可从环境变量获取）
 * @property {string} [image_path] - 本地图片文件路径
 * @property {string} [image_url] - 网络图片 URL 地址
 */

/**
 * 工具定义列表
 * 
 * 每个工具包含：
 * - name: 工具名称（唯一标识）
 * - description: 工具描述（用于 AI 理解工具用途）
 * - inputSchema: JSON Schema 格式的输入参数定义
 * 
 * @type {ToolDefinition[]}
 */
export const tools = [
  {
    /**
     * 发送 Markdown 消息工具
     * 
     * 用于发送 Markdown V2 格式的消息到企业微信机器人
     * 支持丰富的文本格式化语法
     */
    name: 'send_message',
    description: '发送 Markdown V2 格式的消息到企业微信机器人。支持标题、加粗、斜体、列表、引用、链接、代码块、表格等语法。内容最大 4096 字节。如果配置了 WECOM_WEBHOOK_KEY 环境变量，webhook_key 参数可选。',
    inputSchema: {
      type: 'object',
      properties: {
        webhook_key: {
          type: 'string',
          description: '企业微信机器人的 webhook key。如果未设置 WECOM_WEBHOOK_KEY 环境变量，则此参数必填。'
        },
        content: {
          type: 'string',
          description: 'Markdown V2 格式的消息内容。支持语法：# 标题、**加粗**、*斜体*、- 列表、> 引用、[链接](url)、`代码`、```代码块```、|表格| 等'
        }
      },
      required: ['content'],
      additionalProperties: false
    }
  },
  {
    /**
     * 发送文件工具
     * 
     * 先上传文件到企业微信服务器，然后发送文件消息
     * 文件限制：普通文件≤20MB，语音文件≤2MB
     * 注意：media_id 仅 3 天有效
     */
    name: 'send_file',
    description: '发送文件到企业微信机器人。先上传文件到企业微信服务器，然后发送文件消息。支持 PDF、Word、Excel、PPT、TXT、ZIP 等格式，最大 20MB。如果配置了 WECOM_WEBHOOK_KEY 环境变量，webhook_key 参数可选。',
    inputSchema: {
      type: 'object',
      properties: {
        webhook_key: {
          type: 'string',
          description: '企业微信机器人的 webhook key。如果未设置 WECOM_WEBHOOK_KEY 环境变量，则此参数必填。'
        },
        file_path: {
          type: 'string',
          description: '本地文件的绝对路径或相对路径（例如：/path/to/document.pdf 或 ./files/report.xlsx）'
        }
      },
      required: ['file_path'],
      additionalProperties: false
    }
  },
  {
    /**
     * 发送图片工具
     * 
     * 支持发送本地图片文件或网络图片 URL
     * 图片限制：JPG/PNG 格式，最大 2MB
     */
    name: 'send_image',
    description: '发送图片到企业微信机器人。支持本地图片文件路径或网络图片 URL。仅支持 JPG 和 PNG 格式，最大 2MB。如果配置了 WECOM_WEBHOOK_KEY 环境变量，webhook_key 参数可选。',
    inputSchema: {
      type: 'object',
      properties: {
        webhook_key: {
          type: 'string',
          description: '企业微信机器人的 webhook key。如果未设置 WECOM_WEBHOOK_KEY 环境变量，则此参数必填。'
        },
        image_path: {
          type: 'string',
          description: '本地图片文件的路径（可选，与 image_url 二选一）'
        },
        image_url: {
          type: 'string',
          description: '网络图片的 URL 地址（可选，与 image_path 二选一）'
        }
      },
      required: [],
      oneOf: [
        { required: ['image_path'] },
        { required: ['image_url'] }
      ],
      additionalProperties: false
    }
  }
];

/**
 * 工具处理器类
 * 
 * 根据工具名称调用相应的处理函数
 * 提供统一的错误处理和响应格式化
 * 
 * @example
 * const handler = new ToolHandler();
 * const result = await handler.handle('send_message', { content: '# Hello' });
 */
export class ToolHandler {
  /**
   * 处理工具调用请求
   * 
   * 根据工具名称路由到相应的处理方法
   * 
   * @param {string} name - 工具名称
   * @param {Object} args - 工具参数
   * @returns {Promise<ToolResult>} 处理结果
   * @throws {Error} 当工具名称未知或执行失败时
   * 
   * @example
   * const result = await handler.handle('send_message', { content: '# Hello' });
   */
  async handle(name, args) {
    // 验证工具名称
    if (!name || typeof name !== 'string') {
      throw new WeComError(-1, '工具名称必须是有效的字符串');
    }

    switch (name) {
      case 'send_message':
        return this.handleSendMessage(args);
      case 'send_file':
        return this.handleSendFile(args);
      case 'send_image':
        return this.handleSendImage(args);
      default:
        throw new WeComError(-1, `未知工具：${name}。可用工具：send_message, send_file, send_image`);
    }
  }

  /**
   * 获取有效的 webhook key
   * 
   * 优先级：调用时提供的 key > 环境变量配置的 key
   * 
   * @param {string} [providedKey] - 调用时提供的 webhook key
   * @returns {string} webhook key
   * @throws {WeComError} 当未提供 key 且环境变量也未配置时
   * 
   * @private
   */
  _getWebhookKey(providedKey) {
    const key = providedKey || DEFAULT_WEBHOOK_KEY;
    
    if (!key) {
      throw new WeComError(
        -1,
        '未提供 webhook_key 参数，且未设置 WECOM_WEBHOOK_KEY 环境变量'
      );
    }
    
    return key;
  }

  /**
   * 处理发送消息请求
   * 
   * @param {SendMessageArgs} args - 参数对象
   * @param {string} [args.webhook_key] - Webhook key（可选）
   * @param {string} args.content - Markdown 内容
   * @returns {Promise<ToolResult>} 处理结果
   * 
   * @example
   * await handler.handleSendMessage({ content: '# 标题\\n**加粗**' });
   */
  async handleSendMessage({ webhook_key, content }) {
    try {
      // 获取 webhook key
      const key = this._getWebhookKey(webhook_key);

      // 验证内容参数
      if (!content || typeof content !== 'string') {
        throw new WeComError(-1, 'content 参数不能为空且必须是字符串');
      }

      // 创建客户端并发送消息
      const client = new WeComClient(key);
      const result = await client.sendMarkdownV2(content);

      return this._formatSuccess(result);
    } catch (error) {
      return this._formatError(error);
    }
  }

  /**
   * 处理发送文件请求
   * 
   * 流程：
   * 1. 验证参数
   * 2. 上传文件到企业微信服务器
   * 3. 发送文件消息
   * 
   * @param {SendFileArgs} args - 参数对象
   * @param {string} [args.webhook_key] - Webhook key（可选）
   * @param {string} args.file_path - 文件路径
   * @returns {Promise<ToolResult>} 处理结果
   * 
   * @example
   * await handler.handleSendFile({ file_path: '/path/to/file.pdf' });
   */
  async handleSendFile({ webhook_key, file_path }) {
    try {
      // 获取 webhook key
      const key = this._getWebhookKey(webhook_key);

      // 验证文件路径参数
      if (!file_path || typeof file_path !== 'string') {
        throw new WeComError(-1, 'file_path 参数不能为空且必须是字符串');
      }

      // 创建客户端
      const client = new WeComClient(key);

      // 先上传文件
      const uploadResult = await client.uploadMedia(file_path, 'file');

      // 然后发送文件消息
      const sendResult = await client.sendFile(uploadResult.media_id);

      return this._formatSuccess({
        upload: uploadResult,
        send: sendResult
      });
    } catch (error) {
      return this._formatError(error);
    }
  }

  /**
   * 处理发送图片请求
   * 
   * 支持本地文件路径和网络图片 URL 两种方式
   * 
   * @param {SendImageArgs} args - 参数对象
   * @param {string} [args.webhook_key] - Webhook key（可选）
   * @param {string} [args.image_path] - 本地图片路径
   * @param {string} [args.image_url] - 网络图片 URL
   * @returns {Promise<ToolResult>} 处理结果
   * 
   * @example
   * // 发送本地图片
   * await handler.handleSendImage({ image_path: '/path/to/image.png' });
   * 
   * // 发送网络图片
   * await handler.handleSendImage({ image_url: 'https://example.com/image.png' });
   */
  async handleSendImage({ webhook_key, image_path, image_url }) {
    try {
      // 获取 webhook key
      const key = this._getWebhookKey(webhook_key);

      // 验证参数：必须提供 image_path 或 image_url 之一
      if (!image_path && !image_url) {
        throw new WeComError(-1, '必须提供 image_path 或 image_url 参数');
      }

      // 验证不能同时提供两个参数
      if (image_path && image_url) {
        throw new WeComError(-1, 'image_path 和 image_url 只能提供一个');
      }

      // 创建客户端
      const client = new WeComClient(key);
      let result;

      if (image_path) {
        // 发送本地图片
        result = await client.sendImage(image_path);
      } else if (image_url) {
        // 发送网络图片
        result = await client.sendImageFromUrl(image_url);
      }

      return this._formatSuccess(result);
    } catch (error) {
      return this._formatError(error);
    }
  }

  /**
   * 格式化成功响应
   * 
   * @param {Object} data - 响应数据
   * @returns {ToolResult} 格式化的成功响应
   * 
   * @private
   */
  _formatSuccess(data) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  }

  /**
   * 格式化错误响应
   * 
   * @param {Error} error - 错误对象
   * @returns {ToolResult} 格式化的错误响应
   * 
   * @private
   */
  _formatError(error) {
    /** @type {Object} */
    const errorData = {
      error: error.name || 'Error',
      message: error.message,
      code: error.code
    };

    // 如果有额外数据，添加到响应中
    if (error.data) {
      errorData.data = error.data;
    }

    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(errorData, null, 2)
        }
      ]
    };
  }
}

export default { tools, ToolHandler };
