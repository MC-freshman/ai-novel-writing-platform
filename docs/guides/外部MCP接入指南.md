# 外部 MCP 接入指南（P81）

把自研或外部 MCP 服务接入本小说项目，让 Claude Desktop、Qoder、Cursor 等外部 AI 客户端直接检索章节、角色、世界观、知识库与规划数据。平台侧只负责**发现目录、校验、生成客户端配置与只读连接自检**；不复制、不修改、不随包分发外部服务字节。

入口：**设置 → 外部接入（MCP）**。

## 1. 准备 MCP 服务目录

支持两种目录形态（与 `ai-software` 软件库约定一致）：

- **软件库根目录**：含 `current.json`（版本指针）与 `versions/<版本>/`；平台按 `current.json.version` 解析当前版本。
- **版本目录**：直接含 `manifest.json`（`kind: mcp-stdio`）与入口文件（默认 `src/server.mjs`）。

已验证的参考实现：`ai-novel-platform-mcp` v3.1.0（零依赖 stdio MCP，31 个工具；读取开放，写入需 `novel_plan` → `planId + confirmToken` 两步确认，令牌一次性、5 分钟过期、参数漂移即失效）。任何遵循相同目录约定的自研服务都可以替换接入。

## 2. 配置步骤

1. 打开设置 → 外部接入（MCP）→「选择目录…」，选中软件库根目录或版本目录；面板显示识别到的名称与版本。
2. 选择运行时：
   - **自动**：优先系统 Node（`node --version` 探测），不可用时回退应用自带运行时。
   - **系统 Node**：要求本机已安装 Node ≥ 20。
   - **应用自带运行时**：以 `ELECTRON_RUN_AS_NODE=1` 用本程序可执行文件运行服务，无需另装 Node。
3. 可选填写「XMind 导入限制目录」：填写后外部服务的 `.xmind` 导入只能读取该目录内文件。
4. 点「保存设置」。设置保存在应用级偏好（`app-preferences.json` 的 `mcp` 字段），与项目设置相互独立，不进入项目交换包。
5. 点「生成客户端配置」→「复制配置」，粘贴到外部客户端的 MCP 配置（如 Claude Desktop 的 `claude_desktop_config.json`）。生成的配置形如：

```json
{
  "mcpServers": {
    "ai-novel-platform": {
      "command": "node",
      "args": ["<服务目录>/src/server.mjs"],
      "env": {
        "NOVEL_PROJECT_ROOT": "<当前项目目录>",
        "NOVEL_APP_ROOT": "<应用根目录>"
      }
    }
  }
}
```

6. 点「连接自检（只读）」验证：initialize → tools/list → 项目信息 → 注入预加载 → 导图列表。自检**绝不触发写工具**。

## 3. 两种运行形态

| 形态 | NOVEL_APP_ROOT | 说明 |
|---|---|---|
| 源码运行（npm run start） | 仓库根目录 | 服务从 `electron/services` 注入平台能力；已用合成项目验证 v3.1.0 全链路（293 只读 / 119 可写函数预加载 0 错误） |
| 打包版（安装版/便携版） | `resources/app.asar.unpacked` | 构建已将 `electron/`、`shared/`、`node_modules/` 解包（asarUnpack）；配置自动附带 `NODE_PATH` 指向平台生成的 electron 占位模块（`userData/mcp-runtime/node_modules`），因为服务对 electron 的调用均为惰性 |

注意：`NOVEL_PROJECT_ROOT` 固定为**生成配置时打开的项目**。切换项目后请重新生成并更新客户端配置。

## 4. 安全与边界

- 外部客户端能读取当前项目正文与资料；启用前请确认客户端可信。服务侧响应经过脱敏（密钥/凭据/baseUrl 等字段被遮蔽），配置只返回白名单字段。
- 写入工具（章节写入、备份、重建索引、导图增删改、XMind 导入等）必须两步确认；破坏性函数另需 `ack=DELETE`。平台自检不使用任何写工具。
- **单写者原则**：桌面端保有内存草稿。外部写入后，请在规划页点「刷新规划数据」再打开对应导图；不要同时在两个客户端编辑同一张导图。
- 平台不代理外部服务的网络与进程行为；外部服务自身的红线（不做 GUI 自动化、不调用云端模型、不发布）由其自身约束。

## 5. 故障排查

| 现象 | 处理 |
|---|---|
| 目录校验失败 | 确认目录含 `current.json`+`versions/` 或 `manifest.json`；`kind` 必须为 `mcp-stdio` |
| 自检 initialize 超时 | 运行时不可用：改用「应用自带运行时」或安装 Node ≥ 20 |
| 注入预加载 errors 非空 | 查看步骤明细中的模块错误；打包版确认 `NOVEL_APP_ROOT` 指向 `app.asar.unpacked` 且配置含 `NODE_PATH` |
| `CAPABILITY_UNAVAILABLE` | 服务缺少 `NOVEL_APP_ROOT` 或对应函数不在其白名单；按服务 README 处理 |
| 外部写入后桌面端看不到 | 规划页点「刷新规划数据」；确认两端未同时编辑同一导图 |

## 6. 验证记录

- 合成项目冒烟（源码形态，Node v24.18.0）：`.test-runs/mcp-integration/smoke-report.json`，16/16 通过（含确认式写入往返、无令牌拒绝、令牌重放拒绝）。
- 服务单测：`npm run test:services`（external-mcp.test.cjs，合成 fixture，不依赖外部安装）。
- 已知上游小瑕疵（不影响功能）：v3.1.0 `novel_project_info` 的 schema 标签被内层 `novel-config/v1` 覆盖，建议上游下一版修正。