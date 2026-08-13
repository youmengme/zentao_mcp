# ahs-zentao

禅道 Bug 管理系统的 MCP Server，通过 Playwright 自动化 CAS SSO 登录，为 AI 编程工具提供禅道操作能力。

## 功能

- **zentao_login** — CAS 自动登录，获取/刷新 session
- **zentao_list_bugs** — 查询 Bug 列表（按产品/项目/指派人/状态筛选）
- **zentao_my_bugs** — 查询与我相关的 Bug（指派给我 / 由我创建 / 由我解决）
- **zentao_get_bug** — 获取 Bug 详情，并列出正文/评论/附件中的图片
- **zentao_get_bug_image** — 下载并查看 Bug 中的图片（配合 get_bug 返回的 fileId）
- **zentao_resolve_bug** — 解决 Bug（支持选择解决方案、版本、备注）
- **zentao_add_comment** — 给 Bug 添加备注

## 前置条件

- Node.js 18+
- 本机已安装 Google Chrome
- 禅道 12.x 专业版（已验证 12.5.3，理论上 12.0+ 均可）
- 禅道接入 CAS SSO 登录

## 快速开始

### 1. 配置账号

```bash
npx ahs-zentao init
```

按提示输入禅道地址、CAS 地址、OA用户名和OA密码，配置会保存到 `~/.ahs-zentao/.env`。

### 2. 添加到 AI 客户端

支持的客户端：`claude`、`codex`、`cursor`、`windsurf`、`gemini`

**全局安装**（推荐，所有项目可用）：

```bash
npx ahs-zentao add claude -g
npx ahs-zentao add codex -g
```

**项目级安装**（仅当前项目生效）：

```bash
npx ahs-zentao add claude
npx ahs-zentao add cursor
```

安装完成后重启对应客户端即可使用。

## 使用示例

接入后可以直接用自然语言操作禅道：

- "查看指派给我的 Bug"
- "读取 Bug #96035 的详情"
- "读取 Bug #96035，把里面的图片也一起看了"
- "解决 Bug #96035，备注：已修复登录判断逻辑"
- "给 Bug #96035 添加备注：需要回归测试"

## CLI 命令

| 命令 | 说明 |
|------|------|
| `npx ahs-zentao init` | 交互式配置禅道账号信息 |
| `npx ahs-zentao add <client> -g` | 全局添加到 AI 客户端 |
| `npx ahs-zentao add <client>` | 添加到当前项目 |
| `npx ahs-zentao update` | 检查并升级到最新版本 |
| `npx ahs-zentao serve` | 手动启动 MCP Server |
| `npx ahs-zentao help` | 查看帮助 |

支持的客户端：`claude`、`codex`、`cursor`、`windsurf`、`gemini`

## 技术实现

- **认证**：Playwright 驱动本机 Chrome 完成 CAS SSO 登录，提取 session cookie，后续 API 调用复用该 session
- **读取操作**：通过禅道的 `.json` 后缀路由获取结构化数据（轻量 HTTP 请求）
- **写入操作**：通过 Playwright 操作禅道表单页面提交（兼容 KindEditor 富文本和 chosen 下拉组件）
- **图片读取**：解析正文/评论/附件中的 `file-read-<id>` 引用，按需带 session 下载图片字节，以 MCP image 内容块返回
- **Session 管理**：登录后 session 持久化到 `~/.ahs-zentao/session.json`，24 小时有效，过期自动重登
