# zentao-mcp

禅道 Bug 管理系统的 MCP Server，通过 Playwright 自动化 CAS SSO 登录，为 Claude Code / Codex 提供禅道操作能力。

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
git clone <your-repo-url>
cd zentao
npm install
npm run build
```

## 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入你的禅道账号信息：

```env
ZENTAO_URL=http://zentao.xxx.com/zentao/
CAS_URL=https://sso.xxx.com/cas/login
ZENTAO_USER=your_username
ZENTAO_PASSWORD=your_password
```

## 接入 Claude Code

1. 打开配置文件 `~/.claude/.mcp.json`（如果不存在则新建）

2. 添加以下内容（将路径替换为你的实际安装路径）：

```json
{
  "mcpServers": {
    "zentao": {
      "command": "node",
      "args": ["/Users/你的用户名/zentao/dist/index.js"],
      "cwd": "/Users/你的用户名/zentao"
    }
  }
}
```

3. 重启 Claude Code（退出后重新打开），MCP Server 会自动加载

4. 验证：在 Claude Code 中输入"查看我的 Bug"，如果返回 Bug 列表则接入成功

## 接入 OpenAI Codex

Codex 通过 `codex.json` 配置 MCP Server。

1. 在项目根目录创建或编辑 `.codex/config.json`：

```json
{
  "mcpServers": {
    "zentao": {
      "command": "node",
      "args": ["/Users/你的用户名/zentao/dist/index.js"],
      "cwd": "/Users/你的用户名/zentao"
    }
  }
}
```

2. 重启 Codex CLI，MCP Server 会自动加载

## 使用示例

接入后可以直接用自然语言操作禅道：

- "查看指派给我的 Bug"
- "读取 Bug #96035 的详情"
- "解决 Bug #96035，备注：已修复登录判断逻辑"
- "给 Bug #96035 添加备注：需要回归测试"

## 技术实现

- **认证**：Playwright 驱动本机 Chrome 完成 CAS SSO 登录，提取 session cookie，后续 API 调用复用该 session
- **读取操作**：通过禅道的 `.json` 后缀路由获取结构化数据（轻量 HTTP 请求）
- **写入操作**：通过 Playwright 操作禅道表单页面提交（兼容 KindEditor 富文本和 chosen 下拉组件）
- **Session 管理**：登录后 session 持久化到 `~/.zentao-session`，24 小时有效，过期自动重登
