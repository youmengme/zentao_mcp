# zentao-mcp

禅道 Bug 管理系统的 MCP Server，通过 Playwright 自动化 CAS SSO 登录，为 Claude Code 提供禅道操作能力。

## 功能

- **zentao_login** — CAS 自动登录，获取/刷新 session
- **zentao_list_bugs** — 查询 Bug 列表（按产品/项目/指派人/状态筛选）
- **zentao_get_bug** — 获取 Bug 详情
- **zentao_resolve_bug** — 解决 Bug（支持选择解决方案、版本、备注）
- **zentao_add_comment** — 给 Bug 添加备注

## 前置条件

- Node.js 18+
- 本机已安装 Google Chrome
- 禅道 12.x 专业版（已验证 12.5.3，理论上 12.0+ 均可）
- 禅道接入 CAS SSO 登录

## 安装

```bash
npm install
npm run build
```

## 配置

复制环境变量模板并填入你的账号信息：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
ZENTAO_URL=http://zentao.xxx.com/zentao/
CAS_URL=https://sso.xxxx.com/cas/login
ZENTAO_USER=your_username
ZENTAO_PASSWORD=your_password
```

## 接入 Claude Code

在 `~/.claude/.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "zentao": {
      "command": "node",
      "args": ["/path/to/zentao/dist/index.js"],
      "cwd": "/path/to/zentao"
    }
  }
}
```

重启 Claude Code 后即可使用。

## 使用示例

在 Claude Code 中直接用自然语言操作：

- "查看指派给我的 Bug"
- "读取 Bug #96035 的详情"
- "解决 Bug #96035，备注：已修复登录判断逻辑"
- "给 Bug #96035 添加备注：需要回归测试"
