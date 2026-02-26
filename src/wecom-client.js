/**
 * @fileoverview 企业微信机器人 API 客户端
 * @description 提供与企业微信机器人 API 交互的所有功能
 * 
 * 参考文档：https://developer.work.weixin.qq.com/document/path/99110
 * 
 * @module wecom-client
 */

import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import { basename, extname } from 'path';

/**
 * 企业微信 API 基础 URL
 * @constant {string}
 */
const BASE_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook';

/**
 * 文件类型枚举
 * @enum {string}
 */
const FILE_TYPE = {
  FILE: 'file',
  VOICE: 'voice'
};

/**
 * 支持的图片格式
 * @constant {string[]}
 */
const SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png'];

/**
 * 文件大小限制（字节）
 * @constant {Object}
 */
const FILE_SIZE_LIMITS = {
  FILE: 20 * 1024 * 1024,      // 20MB
  VOICE: 2 * 1024 * 1024,      // 2MB
  IMAGE: 2 * 1024 * 1024       // 2MB
};

/**
 * Markdown 消息内容最大字节数
 * @constant {number}
 */
const MARKDOWN_MAX_BYTES = 4096;

/**
 * 计算文件的 MD5 值
 * 
 * @param {Buffer} buffer - 文件内容的 Buffer
 * @returns {string} MD5 哈希值（32 位十六进制字符串）
 * 
 * @example
 * const md5 = calculateMD5(Buffer.from('hello world'));
 * // 返回："5eb63bbbe01eeed093cb22bb8f5acdc3"
 */
function calculateMD5(buffer) {
  return createHash('md5').update(buffer).digest('hex');
}

/**
 * @typedef {Object} WeComApiResponse
 * @property {number} errcode - 错误码（0 表示成功）
 * @property {string} errmsg - 错误消息
 * @property {*} [data] - 响应数据
 */

/**
 * @typedef {Object} SendMessageResult
 * @property {boolean} success - 是否成功
 * @property {string} message - 结果消息
 * @property {WeComApiResponse} data - 原始响应数据
 */

/**
 * @typedef {Object} UploadMediaResult
 * @property {boolean} success - 是否成功
 * @property {string} message - 结果消息
 * @property {string} media_id - 媒体文件 ID
 * @property {string} type - 文件类型
 * @property {number} created_at - 创建时间戳
 */

/**
 * 企业微信 API 错误类
 * 
 * 用于封装企业微信 API 返回的错误信息
 * 
 * @example
 * try {
 *   await client.sendMarkdownV2('test');
 * } catch (error) {
 *   if (error instanceof WeComError) {
 *     console.error(`API 错误 ${error.code}: ${error.message}`);
 *   }
 * }
 */
export class WeComError extends Error {
  /**
   * 创建错误实例
   * 
   * @param {number} code - 错误码
   * @param {string} message - 错误消息
   * @param {Object} [data] - 原始响应数据
   */
  constructor(code, message, data = {}) {
    super(message);
    this.name = 'WeComError';
    this.code = code;
    this.data = data;

    // 捕获堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WeComError);
    }
  }

  /**
   * 获取错误的字符串表示
   * 
   * @returns {string} 错误字符串
   */
  toString() {
    return `WeComError [${this.code}]: ${this.message}`;
  }
}

/**
 * 企业微信机器人客户端类
 * 
 * 提供发送消息、上传文件、发送图片等功能
 * 
 * @example
 * // 创建客户端实例
 * const client = new WeComClient('your-webhook-key');
 * 
 * // 发送 Markdown 消息
 * await client.sendMarkdownV2('# 标题\\n**加粗文本**');
 * 
 * // 上传并发送文件
 * const result = await client.uploadMedia('/path/to/file.pdf');
 * await client.sendFile(result.media_id);
 */
export class WeComClient {
  /**
   * 创建客户端实例
   * 
   * @param {string} webhookKey - 机器人 webhook URL 中的 key 参数
   * @throws {WeComError} 当 webhookKey 为空时抛出错误
   * 
   * @example
   * const client = new WeComClient('your-webhook-key');
   */
  constructor(webhookKey) {
    if (!webhookKey || typeof webhookKey !== 'string') {
      throw new WeComError(-1, 'webhookKey 是必需的字符串参数');
    }

    /**
     * @private
     * @type {string}
     */
    this.webhookKey = webhookKey;

    /**
     * @private
     * @type {import('axios').AxiosInstance}
     */
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000, // 30 秒超时
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * 发送消息（通用方法）
   * 
   * @param {string} msgType - 消息类型（markdown_v2, file, image 等）
   * @param {Object} content - 消息内容对象
   * @returns {Promise<SendMessageResult>} API 响应结果
   * @throws {WeComError} 当 API 返回错误或网络请求失败时
   * 
   * @private
   */
  async sendMessage(msgType, content) {
    try {
      const response = await this.client.post('/send', {
        msgtype: msgType,
        [msgType]: content
      }, {
        params: {
          key: this.webhookKey
        }
      });

      const data = response.data;

      // 检查错误码
      if (data.errcode !== 0) {
        throw new WeComError(
          data.errcode,
          data.errmsg || '发送消息失败',
          data
        );
      }

      return {
        success: true,
        message: '消息发送成功',
        data: data
      };
    } catch (error) {
      // 处理已有的 WeComError
      if (error instanceof WeComError) {
        throw error;
      }

      // 处理 axios 错误
      if (error.response) {
        throw new WeComError(
          error.response.status,
          `API 响应错误：${error.response.status} ${error.response.statusText}`,
          { status: error.response.status, data: error.response.data }
        );
      }

      // 处理网络错误或其他异常
      throw new WeComError(
        -1,
        `网络请求失败：${error.message}`,
        { originalError: error.message }
      );
    }
  }

  /**
   * 发送 Markdown V2 格式的消息
   * 
   * 支持的语法：
   * - 标题：`# H1`, `## H2`, ... `###### H6`
   * - 斜体：`*text*`
   * - 加粗：`**text**`
   * - 列表：`- 项` 或 `1. 项`
   * - 引用：`> 引用`
   * - 链接：`[text](url)`
   * - 图片：`![alt](url)`
   * - 代码：`` `code` `` 或 ` ```code block``` `
   * - 表格：`| 列 1 | 列 2 |`
   * 
   * @param {string} content - Markdown V2 格式的内容（最大 4096 字节）
   * @returns {Promise<SendMessageResult>} API 响应结果
   * @throws {WeComError} 当内容为空、类型错误或超出长度限制时
   * 
   * @example
   * await client.sendMarkdownV2('# 标题\\n**加粗文本**\\n- 列表项');
   */
  async sendMarkdownV2(content) {
    // 验证参数
    if (!content || typeof content !== 'string') {
      throw new WeComError(
        -1,
        'content 参数不能为空且必须是字符串'
      );
    }

    // 检查内容长度（UTF-8 编码后不超过 4096 字节）
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > MARKDOWN_MAX_BYTES) {
      throw new WeComError(
        -1,
        `内容长度超出限制：当前 ${byteLength} 字节，最大 ${MARKDOWN_MAX_BYTES} 字节`
      );
    }

    return this.sendMessage('markdown_v2', { content });
  }

  /**
   * 上传文件到企业微信服务器
   * 
   * 文件限制：
   * - 普通文件 (file): ≤ 20MB, > 5 字节
   * - 语音文件 (voice): ≤ 2MB, 仅支持 AMR 格式
   * 
   * @param {string} filePath - 本地文件路径
   * @param {string} [type='file'] - 文件类型：'file' (普通文件) 或 'voice' (语音)
   * @returns {Promise<UploadMediaResult>} 上传结果，包含 media_id
   * @throws {WeComError} 当文件不存在、超出大小限制或上传失败时
   * 
   * @example
   * const result = await client.uploadMedia('/path/to/file.pdf', 'file');
   * console.log(result.media_id); // 可用于发送文件消息
   */
  async uploadMedia(filePath, type = FILE_TYPE.FILE) {
    // 验证参数
    if (!filePath || typeof filePath !== 'string') {
      throw new WeComError(-1, 'filePath 参数必须是有效的字符串');
    }

    if (!Object.values(FILE_TYPE).includes(type)) {
      throw new WeComError(-1, `type 参数必须是 "${FILE_TYPE.FILE}" 或 "${FILE_TYPE.VOICE}"`);
    }

    try {
      // 读取文件内容
      const fileBuffer = await this._readFile(filePath);

      // 验证文件大小
      const fileSize = fileBuffer.length;
      
      if (fileSize <= 5) {
        throw new WeComError(-1, '文件大小必须大于 5 字节');
      }

      const maxSize = FILE_SIZE_LIMITS[type];
      if (fileSize > maxSize) {
        const maxMB = maxSize / 1024 / 1024;
        throw new WeComError(-1, `文件大小超出限制：最大 ${maxMB}MB`);
      }

      // 创建 FormData 实例
      const formData = new FormData();
      formData.append('media', fileBuffer, {
        filename: basename(filePath),
        contentType: this._getMimeType(filePath)
      });

      // 发送上传请求
      const response = await axios.post(
        `${BASE_URL}/upload_media`,
        formData,
        {
          params: {
            key: this.webhookKey,
            type: type
          },
          headers: {
            ...formData.getHeaders()
          },
          timeout: 60000 // 文件上传可能需要更长时间
        }
      );

      const data = response.data;

      if (data.errcode !== 0) {
        throw new WeComError(
          data.errcode,
          data.errmsg || '文件上传失败',
          data
        );
      }

      return {
        success: true,
        message: '文件上传成功',
        media_id: data.media_id,
        type: data.type,
        created_at: data.created_at
      };
    } catch (error) {
      // 处理已有的 WeComError
      if (error instanceof WeComError) {
        throw error;
      }

      // 处理文件不存在错误
      if (error.code === 'ENOENT') {
        throw new WeComError(-1, `文件不存在：${filePath}`);
      }

      // 处理其他错误
      throw new WeComError(
        -1,
        `文件上传失败：${error.message}`,
        { originalError: error.message }
      );
    }
  }

  /**
   * 发送文件消息
   * 
   * 注意：media_id 仅在 3 天内有效
   * 
   * @param {string} mediaId - 通过 uploadMedia 获取的 media_id
   * @returns {Promise<SendMessageResult>} API 响应结果
   * @throws {WeComError} 当 mediaId 为空时
   * 
   * @example
   * const uploadResult = await client.uploadMedia('/path/to/file.pdf');
   * await client.sendFile(uploadResult.media_id);
   */
  async sendFile(mediaId) {
    if (!mediaId || typeof mediaId !== 'string') {
      throw new WeComError(-1, 'mediaId 参数必须是有效的字符串');
    }

    return this.sendMessage('file', {
      media_id: mediaId
    });
  }

  /**
   * 发送本地图片文件
   * 
   * 图片限制：
   * - 格式：JPG, PNG
   * - 大小：≤ 2MB
   * 
   * @param {string} imagePath - 本地图片文件路径
   * @returns {Promise<SendMessageResult>} API 响应结果
   * @throws {WeComError} 当图片不存在、格式不支持或超出大小限制时
   * 
   * @example
   * await client.sendImage('/path/to/image.png');
   */
  async sendImage(imagePath) {
    // 验证参数
    if (!imagePath || typeof imagePath !== 'string') {
      throw new WeComError(-1, 'imagePath 参数必须是有效的字符串');
    }

    try {
      // 读取图片文件
      const imageBuffer = await this._readFile(imagePath);

      // 验证图片格式
      const fileExt = extname(imagePath).slice(1).toLowerCase();
      if (!SUPPORTED_IMAGE_FORMATS.includes(fileExt)) {
        throw new WeComError(
          -1,
          `不支持的图片格式：${fileExt}，仅支持 ${SUPPORTED_IMAGE_FORMATS.join(', ')}`
        );
      }

      // 验证图片大小
      const fileSize = imageBuffer.length;
      if (fileSize > FILE_SIZE_LIMITS.IMAGE) {
        throw new WeComError(-1, `图片大小超出限制：最大 ${FILE_SIZE_LIMITS.IMAGE / 1024 / 1024}MB`);
      }

      // 计算 MD5
      const md5 = calculateMD5(imageBuffer);

      // 转换为 Base64
      const base64 = imageBuffer.toString('base64');

      return this.sendMessage('image', {
        base64: base64,
        md5: md5
      });
    } catch (error) {
      // 处理已有的 WeComError
      if (error instanceof WeComError) {
        throw error;
      }

      // 处理文件不存在错误
      if (error.code === 'ENOENT') {
        throw new WeComError(-1, `图片文件不存在：${imagePath}`);
      }

      // 处理其他错误
      throw new WeComError(
        -1,
        `发送图片失败：${error.message}`,
        { originalError: error.message }
      );
    }
  }

  /**
   * 发送网络图片
   * 
   * 从 URL 下载图片并发送
   * 
   * @param {string} imageUrl - 图片的 URL 地址
   * @returns {Promise<SendMessageResult>} API 响应结果
   * @throws {WeComError} 当 URL 无效、下载失败或图片超出限制时
   * 
   * @example
   * await client.sendImageFromUrl('https://example.com/image.png');
   */
  async sendImageFromUrl(imageUrl) {
    // 验证参数
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new WeComError(-1, 'imageUrl 参数必须是有效的字符串');
    }

    // 验证 URL 格式
    try {
      new URL(imageUrl);
    } catch {
      throw new WeComError(-1, '无效的 URL 格式');
    }

    try {
      // 下载图片
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: FILE_SIZE_LIMITS.IMAGE,
        validateStatus: (status) => status === 200
      });

      if (response.status !== 200) {
        throw new WeComError(-1, `下载图片失败：HTTP ${response.status}`);
      }

      const imageBuffer = Buffer.from(response.data);

      // 验证图片大小
      const fileSize = imageBuffer.length;
      if (fileSize > FILE_SIZE_LIMITS.IMAGE) {
        throw new WeComError(-1, `图片大小超出限制：最大 ${FILE_SIZE_LIMITS.IMAGE / 1024 / 1024}MB`);
      }

      // 计算 MD5
      const md5 = calculateMD5(imageBuffer);

      // 转换为 Base64
      const base64 = imageBuffer.toString('base64');

      return this.sendMessage('image', {
        base64: base64,
        md5: md5
      });
    } catch (error) {
      // 处理已有的 WeComError
      if (error instanceof WeComError) {
        throw error;
      }

      // 处理其他错误
      throw new WeComError(
        -1,
        `下载或发送图片失败：${error.message}`,
        { originalError: error.message }
      );
    }
  }

  /**
   * 读取文件内容为 Buffer
   * 
   * @param {string} filePath - 文件路径
   * @returns {Promise<Buffer>} 文件内容的 Buffer
   * @throws {Error} 当文件读取失败时
   * 
   * @private
   */
  async _readFile(filePath) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const stream = createReadStream(filePath);

      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', error => {
        reject(error);
      });
    });
  }

  /**
   * 根据文件扩展名获取 MIME 类型
   * 
   * @param {string} filePath - 文件路径
   * @returns {string} MIME 类型
   * 
   * @private
   */
  _getMimeType(filePath) {
    const ext = extname(filePath).slice(1).toLowerCase();
    
    /** @type {Object.<string, string>} */
    const mimeTypes = {
      // 文档
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // 文本
      'txt': 'text/plain',
      'csv': 'text/csv',
      'md': 'text/markdown',
      // 压缩文件
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      // 图片
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      // 音频
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'amr': 'audio/amr',
      // 视频
      'mp4': 'video/mp4',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }
}

export default WeComClient;
