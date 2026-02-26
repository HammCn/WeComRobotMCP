# 企业微信机器人 MCP 服务

[![npm version](https://img.shields.io/npm/v/wecom-robot-mcp.svg)](https://www.npmjs.com/package/wecom-robot-mcp)
[![npm downloads](https://img.shields.io/npm/dm/wecom-robot-mcp.svg)](https://www.npmjs.com/package/wecom-robot-mcp)
[![Node.js version](https://img.shields.io/node/v/wecom-robot-mcp.svg)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/wecom-robot-mcp.svg)](https://github.com/hamm/WeComRobot/blob/main/LICENSE)

基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 标准实现的企业微信机器人服务，支持通过 AI 助手发送消息、文件和图片到企业微信群聊。

## ✨ 功能特性

- ✅ **发送 Markdown 消息** - 支持 Markdown V2 格式，包含标题、加粗、斜体、列表、引用、链接、代码块、表格等
- ✅ **发送文件** - 支持 PDF、Word、Excel、PPT、TXT、ZIP 等多种格式，最大 20MB
- ✅ **发送图片** - 支持本地图片文件或网络图片 URL，JPG/PNG 格式，最大 2MB
- ✅ **标准 MCP 协议** - 兼容 MCP 客户端，如 Claude Desktop


## 🚀 快速开始

### 获取 Webhook Key

在企业微信中创建群机器人
   - 进入企业微信 -> 群聊 -> 群机器人 -> 添加
   - 选择机器人类型，设置名称和头像

复制 webhook URL，格式如下：
   ```
   https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693axxx6-7aoc-4bc4-97a0-0ec2sifa5aaa
   ```

提取 `key` 参数值：`693axxx6-7aoc-4bc4-97a0-0ec2sifa5aaa`


### 在 MCP 客户端中配置

```json
{
  "mcpServers": {
    "wecom-robot": {
      "command": "npx",
      "args": ["-y", "wecom-robot-mcp"],
      "env": {
        "WECOM_WEBHOOK_KEY": "$WECOM_WEBHOOK_KEY"
      }
    }
  }
}
```

## 📄 License

[MIT](LICENSE)