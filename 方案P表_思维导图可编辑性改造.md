# 思维导图「可编辑性」改造 · 方案 P 表（自研路线）

> **可行性判定**：✅ **可行** —— 在「类似 XMind、可编辑性达标、支持任意连线与备注」的验收目标下成立
> **状态（2026-11-09 21:00 更新）**：方案**已实施** —— T01–T04 全部落地、T05 测试断言与用户文档收口已完成；8 项具名静态门禁实跑 exit 0 + 2 组新单测通过（日志 `.test-runs/qa-gate-20261109/`）。**唯一放行条件**仍是真机跑通 `test:ui-planning-boards` 全量 22 条 CDP 断言 + 截图确认终点三角箭头可见（K1）；在此之前不得宣称全量验收通过。
> **过期快照提示**：本文 §12.1.2 表格与文末「结论」里的「T03/T04/T05 待用户指令后推进」「T03 未做」「positions 存而不用」「K4 绝对像素须先换算」「UI 断言 16 条」等，均为实施前记录，现以 §12.1 表格与本状态行为准；K4 已按 §12.1.1 终裁实现（不读 `svg:x/svg:y`、`x/y` 恒置 0），N2 的 `split(">")` 已改为 `lastIndexOf` 切分。
> **与既有文档的关系**：与 `方案P表_思维导图改造.md`（A′ 外部 XMind 路线）**并列且互斥为主**；本表是自研路线专项，编号 **P57–P72**、验收 **AC-S01～AC-S18**，与历史 `方案P表.md`（P01–P37）、A′ 专项（P38–P56）区分
> **日期**：2026-11-09
> **取证纪律**：全部事实来自本机只读实测与仓库 `文件:行号`；未实测项一律标注「未实测 / 待验证」；不编造性能数字或功能数量

---

## 0. 结论先行

| 项 | 结论 |
|---|---|
| **用户新诉求** | 「做一个类似 XMind 的思维导图编辑模块；现在可编辑性太差，两节点间无法任意连线备注」 |
| **可行性** | ✅ **可行**。决定性理由：**任意连线可作为独立数据层实现，端点坐标复用现有 `layoutMindMap` 的输出，不需重写布局引擎**；新增字段落在 `state.json` 内，交换包与快照天然覆盖；**零新增第三方依赖**；许可干净；**可随包分发** |
| **验收目标的变化（关键）** | 由 A′ 的「与 XMind 功能/按钮布局/名称/交互/体验**完全一致**」**降级**为「类似 XMind 的核心交互 + 可编辑性达标」。这是本方案可行的前提，**须用户确认** |
| **推荐方案** | **方案 A：增量扩展**（保留现有引擎与既有按钮名/DOM，新增 `relations` 关系线数据层 + 连线备注 + 撤销/多选/右键） |
| **明确不做** | 不复制 XMind 按钮文案/图标/布局；不提供 16 种结构、甘特图、演示模式、PDF/Word/PPT 导出、主题库/图标库、拼写检查、云分享等全功能集；不承诺「完全一致」 |
| **相对 A′ 的最大收益** | **上传 GitHub 后别人下载即用**（不依赖对方预装 XMind）；无 289.7 MB 外部程序、无 Plus/Pro 专有许可、无 `.xmind` 二进制交换包改造、无 100MB/500MB 容量冲突 |
| **未实施** | 按「方案先行、确认后再动手」，本轮只交付 P 表 |

---

## 1. 项目现状

### 1.1 平台侧

| 维度 | 现状 | 证据 |
|---|---|---|
| 产品/基线 | AI 小说创作平台 `0.3.9` / Windows x64；中文界面；「源码可见、保留所有权利」 | README.md:7/:9/:223；package.json:3 |
| 技术栈 | React 18 + TypeScript 5 + Vite 6 + Electron 44 + TipTap 3 + zustand 5；Node ≥22.12.0 | package.json:6-8/:46-65/:84-91 |
| 思维导图模块来源 | `7422488` 引入 + `dd404a8` 合并关系网/弹窗；README 仍声明 0.3.9 → **未进入发布基线**；git 工作区干净 | `git log -2` / `git status` |
| 数据落盘 | `analysis/creative-workspace/state.json` 的 `mindMaps`；每项目 60 张 | README.md:122/:334；creative-workspace.cjs:17 |
| 自动保存 | 本地草稿 + **600ms 防抖** + 切换视图 / `Ctrl+S` / 关闭窗口 flush | src/hooks/useWorkspaceDraft.ts:64-75；README.md:121-122 |

### 1.2 现有思维导图模块能力边界（只读实测）

| 项 | 现状 | 证据 |
|---|---|---|
| 数据模型 | `MindMapNode` **8 字段**：`id/parentId/text/note/color/collapsed/order/side`；`MindMap` 7 字段；**单父纯树，无关系边集合** | src/types/mindmap.ts:1-21 |
| 布局 | 节点固定 **168×40**，层级 228 / 叶间距 62 / 留白 70；`layoutMindMap` 自动算左右双向树坐标，**无手工坐标字段** | src/lib/mind-map.ts:3-7/:77-163 |
| 渲染 | 节点**绝对定位**（`left: item.x - W/2`）；已有 SVG 连线层 `.mind-map-links`，按 `layout.edges` 画三次贝塞尔曲线；该层 `pointer-events: none` | src/components/MindMaps.tsx:311-318；planning-boards.css:38-46 |
| 画布交互 | 空白处拖拽**平移**、滚轮缩放（0.3–2.2）、`Tab` 子主题 / `Enter` 同级 / `F2` 改名 / `Delete` 删除 / 双击改名 | MindMaps.tsx:236-257/:319-342 |
| 属性区 | 仅 4 项：主题文字、备注、颜色、一级分支方向 | MindMaps.tsx:331-335 |
| 弹窗 | React DOM `div.modal-backdrop` + `.mind-map-modal`，复用同一套 `MindMaps(true)` 自研组件 | ProgressWorkspace.tsx:84-86/:104-113 |
| 导入 | 单向 `importXMind`，只读 zip 内 `content.json`/`content.xml`，只保留 title+note | ipc-channels.cjs:73；mind-map-import.cjs:96-144 |

### 1.3 决定可行性的 6 条实测事实（本轮新增）

| # | 实测结论 | 证据 | 意义 |
|---|---|---|---|
| F1 | **顶层新增字段不会丢**：`creative-workspace.cjs:200` 是 `return { ...base, title, rootId, nodes }`，`base = { ...payload, ... }`（:64-71）→ `relations` 等顶层字段**原样落盘**；`:187-196` 的白名单**只作用于 `nodes` 数组内部** | electron/services/creative-workspace.cjs:64-71/:184-200 | 新增关系线集合**不需要改数据通道**，但**必须补显式白名单 + 值域校验**（否则未校验字段直通落盘，安全/一致性风险） |
| F2 | **交换包天然覆盖**：`project-exchange.cjs:106-108` 对整个 `workspace` 做 `portableValue` 后 `addFile(".../state.json")`；新字段在 state.json 内 → **交换包零改造** | electron/services/project-exchange.cjs:106-108 | 对比 A′ 必须改造交换包纳入 `.xmind` 二进制并撞 100MB/500MB 上限 |
| F3 | **快照/备份天然覆盖**：`MANAGED_ROOTS` 含 `analysis` | electron/services/project-snapshots.cjs:5；project-archives.cjs:9 | 无需改快照/备份 |
| F4 | **无行数门槛**：`check-module-boundaries.cjs:8-16` 的限额只含 `App.tsx`(650)、`AnalysisPanel.tsx`(150)、`types.ts`(30)、`handlers.cjs`(120) 等，**不含 `MindMaps.tsx`** | scripts/check-module-boundaries.cjs:8-16 | 编辑器组件扩展不会触发职责入口门禁 |
| F5 | **既有 UI 断言可零改动通过**：`test-ui-planning-boards.cjs` 断言的是 `.mind-map-panel` / `.mind-map-node` / 按钮名 / `mindMaps[0].nodes` / `.mind-map-modal`；只要**保留既有按钮名、DOM 类名与 `nodes` 结构**，新增 `relations` 是增量字段 | scripts/test-ui-planning-boards.cjs:108-168（本轮逐行复核） | 门禁回退风险低 |
| F6 | **无任何图形/拖拽库依赖**：`package.json` 中 `flow / reactflow / d3 / konva / dagre / xyflow` 全部无命中 | package.json:46-91（grep 实测） | 要么零依赖原生实现（推荐），要么新增依赖并触发许可/打包审计 |

---

## 2. 现有模块问题（重点：可编辑性差 / 两节点无法任意连线备注）

> **根因**：数据模型是「单父纯树 + 自动布局」，**没有关系边这一维度**；因此「任意连线」不是补一个按钮，而是要新增一层独立于树的数据与渲染。同时基础编辑命令缺失，导致人工创作效率低。

| # | 缺陷 | 源码依据 | 影响人工操作 |
|---|---|---|---|
| D01 | **无关系线集合**：`MindMap` 只有 `nodes`，边完全由 `parentId` 推导；`layout.edges` 只是布局产物 | src/types/mindmap.ts:14-21；src/lib/mind-map.ts:105-113 | **两节点间无法任意连线**（本次核心痛点） |
| D02 | **连线无文字/备注/样式**：SVG `<path>` 只有 `stroke`，无 `<text>`、无数据字段 | MindMaps.tsx:311-315 | 无法给关系加说明、标签、语义 |
| D03 | **连线不可交互**：`.mind-map-links` 设 `pointer-events: none` | planning-boards.css:42 | 连线不能选中/编辑/删除 |
| D04 | 节点固定 168×40、坐标自动算出，**不可拖拽自由定位**；画布鼠标事件显式排除节点 | src/lib/mind-map.ts:114-129；MindMaps.tsx:244-253 | 无法自由排版 |
| D05 | **无撤销/重做**（组件全文无 undo/redo；删除文案自述「不可撤销」） | MindMaps.tsx:124 | 误操作无法回退；连线试错成本高 |
| D06 | **无多选/框选**：选中态为单一 `selectedId` 字符串 | MindMaps.tsx:25/:39/:319 | 无法批量改色/删除 |
| D07 | **无右键上下文菜单** | MindMaps.tsx 全文无 `onContextMenu` | 连线/节点常用命令无快捷入口 |
| D08 | **无复制/剪切/粘贴** | MindMaps.tsx 全文 | 跨导图复用主题 |
| D09 | 快捷键仅 5 个，按钮为自研命名体系 | MindMaps.tsx:236-242/:262-277 | 连续建图效率低 |
| D10 | 属性仅 4 项；备注只挂在节点，单行 `textarea` | MindMaps.tsx:320-335 | 长文本与关系说明表达受限 |
| D11 | 结构单一（左右双向树），无自由主题/浮动主题/外框/摘要 | src/types/mindmap.ts:1；src/lib/mind-map.ts:77-98 | 非线性表达缺失 |
| D12 | 导入 XMind 有损：relationship/boundary/marker/样式全不转换 | mind-map-import.cjs:96-125；使用说明_请先看.md:78 | 从 XMind 迁入后连线信息丢失 |
| D13 | 同级顺序无法拖拽重排；缩放硬编码 0.3–2.2 | MindMaps.tsx:83-98/:256 | 调整顺序困难 |
| D14 | 无 `.xmind` 导出 | ipc-channels.cjs:73；MindMaps.tsx:262-277 | 无法交付给 XMind 用户 |

---

## 3. 改造目标

### 3.1 用户字面目标（逐字）

> 「探索一下直接做一个类似 xmind 思维导图编辑的模块是否可行，现在的思维导图模块可编辑性太差，两节点间无法任意连线备注，如果可行，出一份 P 表」

### 3.2 可落地功能目标

| 编号 | 目标 | 期望 | 优先级 |
|---|---|---|---|
| G01 | **任意连线（含箭头联系）** | 任意两个节点（跨分支、跨层级、同层、含根）可建立关系线；支持曲线/直线/折线、单向或双向三角箭头、虚线与自定义颜色；与父子树边（实线）视觉区分 | P0 |
| G02 | **连线备注与箭头联系** | 连线可写文字标签（斜体/彩色，贴在曲线中段）+ 备注（建议 ≤2000 字）；支持**单向/双向三角箭头**、虚线/点线/实线、曲线/直线/折线、自定义弯曲控制点；可改颜色/线宽，可选中/删除。**目标形态＝用户截图中的「绿色虚线曲线 + 末端箭头 + 斜体灰色标签」** | P0 |
| G03 | 基础编辑命令 | 撤销/重做、多选/框选、复制粘贴、右键菜单 | P0 |
| G04 | 自由摆放 | 节点可拖拽定位（`positions` 偏移），不破坏自动布局回退 | P1 |
| G05 | 关系线随动 | 折叠/展开/自动布局变化时，关系线端点跟随或有明确隐藏规则 | P0 |
| G06 | 保存不丢稿 | 600ms 防抖 / `Ctrl+S` / 切换视图 / 关闭窗口 flush；弹窗内外一致 | P0 |
| G07 | 数据兼容 | 旧 `mindMaps`（无 `relations`）可正常打开；快照/备份/项目交换回迁后连线与备注完整 | P0 |
| G08 | 门禁不回退 | 既有按钮名/DOM 保留，`test-ui-planning-boards` 既有断言零改动通过；新增断言补齐 | P0 |
| G09 | **可随包分发** | 不依赖外部 XMind；安装版/便携版下载即可编辑 | P0 |
| G10 | 导入兼容（可选） | 扩展 `mind-map-import.cjs` 解析 XMind 8 `<relationships>` 转为 `relations` | P2 |

### 3.3 明确放弃（本方案的前提）

- ❌ 「与 XMind 功能/按钮布局/按钮名称/交互流程/人工操作体验**完全一致**」
- ❌ XMind 全功能集：16 种结构、甘特图、演示模式、PDF/Word/PPT/SVG 导出、主题/样式库、图标与标记库、外框、摘要、附件、拼写检查、云分享、黑匣子
- ❌ 复制 XMind 的中文按钮文案、助记符 `(&X)`、图标、工具栏布局（许可与商标边界）
- ✅ 保留的是：**类似 XMind 的思维导图编辑手感**（节点树 + 自由关系线 + 备注 + 拖拽 + 撤销）

> ⚠️ 若用户仍坚持「完全一致」，本方案不成立，须回到 A′ 外部 XMind 路线（`方案P表_思维导图改造.md`）。

---

## 4. 两种候选方案

### 4.1 方案 A（增量扩展，保留现有引擎）

在现有 `MindMaps.tsx` / `layoutMindMap` / `mindMaps` 模型上**新增一层关系边数据**：`relations[]` 独立于 `nodes[]`，端点坐标复用布局结果，在同一 `.mind-map-links` SVG 层加 `<path>` + `<text>`；补基础编辑命令；**零新增第三方依赖**。

### 4.2 方案 B（引入图形库重写画布）

引入 `@xyflow/react`（或 d3 + konva / 自研图形引擎），整体替换画布与交互层，自带自由布局、缩放平移、连线手势、minimap、框选等。

### 4.3 方案 C（参照，不推荐）：A′ 唤起外部 XMind

详见 `方案P表_思维导图改造.md`。依赖用户本机 XMind 8（289.7 MB / Plus/Pro 专有），**GitHub 下载者无法开箱即用**，且需改造交换包、撞 100MB/500MB 限额、许可待法务确认。

### 4.4 七维可行性判定表

| 维度 | 方案 A（增量扩展） | 方案 B（图形库重写） | 方案 C（A′ 外部 XMind） |
|---|---|---|---|
| **技术可达** | ✅ **可行**。F1 顶层字段保留、SVG 连线层已存在（MindMaps.tsx:311-315），关系线只需按 `layout.nodes` 坐标画；`pointer-events` 改为可交互层即可 | ✅ 可行，但需重写画布与全部交互 | ⚠️ 有条件可行（双层承载） |
| **依赖/打包** | ✅ **零新增依赖**（F6）；`package.json:100-105` 白名单不变 | ❌ 新增第三方库 → package.json / 打包白名单 / 许可审计 / 体积 / CI 全链路改动 | ⚠️ 不随包分发，但需文档声明预装 XMind |
| **数据/存储** | ✅ 新字段在 `state.json` 内 → **交换包与快照零改造**（F2/F3） | ⚠️ 若改用库自有状态模型，需重新设计落盘与迁移 | ❌ 需交换包显式纳入 `.xmind` 二进制，撞 100MB/500MB 上限 |
| **许可** | ✅ **干净**：纯自研，不复制 XMind 文案/图标/布局 | ✅ 干净（需核查所选库许可证） | ⚠️ EPL/LGPL + Plus/Pro 专有 XPLA，待法务确认 |
| **分发可移植** | ✅ **下载即用**（G09） | ✅ 下载即用 | ❌ 不能「下载即用」 |
| **质量门禁** | ✅ 保留按钮名/DOM → 既有 UI 断言零改动通过（F5）；无行数门槛（F4） | ❌ 画布替换 → `test-ui-planning-boards.cjs:108-168` 大面积断言失效，需重写 | ⚠️ 既有 UI 断言需按「只读派生」语义重写（A′ P 表 G9） |
| **工程量** | ✅ 中：1 个类型文件、1 个组件、1 个布局辅助、1 个服务白名单、CSS、测试、文档 | ❌ 大：重写画布 + 状态 + 交互 + 迁移 + 全部测试 | ⚠️ 中：新增 IPC 通道/服务/交换包/格式生成器 |
| **验收目标** | ✅ 「类似 XMind、可编辑性达标」可达 | ✅ 可达（且交互更丰富） | ⚠️ 「完全一致」由真 XMind 达成，但分发场景不可达 |
| **结论** | ✅ **推荐** | ⚠️ 可行但代价高、非必要 | ❌ 不推荐（分发目标下） |

---

## 5. 推荐方案 A 及理由

### 5.1 方案 A 定义（P57–P62）

| 编号 | 条目 | 内容 |
|---|---|---|
| P57 | 数据模型 | `src/types/mindmap.ts` 新增 `MindMapRelation`，字段按**实测的 XMind 8 关系线属性**拆分（见附录 M10）：`id / sourceId / targetId / label / note`；视觉样式 `shape: "curved"\|"straight"\|"elbow"`、`linePattern: "solid"\|"dash"\|"dot"`、`lineColor`、`lineWidth`、`arrowBegin: "none"\|"triangle"`、`arrowEnd: "none"\|"triangle"`、`labelFontStyle: "normal"\|"italic"`、`labelColor`；可选 `controlPoints?: [{amount,angle,x,y}]`（自定义弯曲，相对坐标）。`MindMap` 新增 `relations: MindMapRelation[]`（默认 `[]`）与可选 `positions?: Record<string, {dx,dy}>`；**`nodes` 8 字段与 `parentId` 树结构保持不变** |
| P58 | 关系线渲染 | 复用 `.mind-map-links` SVG：`layout.edges`（树边）保持实线；`relations` 按 `controlPoints` 或默认三次贝塞尔画 `<path>`，`stroke-dasharray` 实/虚线、`stroke`/`stroke-width` 颜色线宽、**`marker-start`/`marker-end` 三角箭头**（SVG `<marker>` / `<defs>`）、`<text>` 渲染斜体彩色标签（可用 `<textPath>` 贴曲线）；新增可交互 `<g>` 层（或把 `pointer-events` 改为 `auto` 并仅对连线路径生效），支持点选。**自检口径**：与 `styles.xml` 的 `arrow-end-class` / `line-pattern` / `shape-class` / `fo:font-style` 逐项对应 |
| P59 | 交互 | ① 创建：选中节点 A → 「添加关系线」→ 点节点 B（或拖拽端点）；② 编辑：选中连线后属性区出现「连线文字 / 连线备注 / 颜色 / 线型 / 删除关系线」；③ 撤销/重做历史栈（建议上限 50，**未实测**需基准）；④ 多选 `Set<string>` + 框选；⑤ 右键菜单；⑥ 自由摆放 `positions` 偏移（P1，独立开关） |
| P60 | 持久化与安全 | 走现有 `board.update()` → 600ms 防抖 → `upsertCreativeWorkspaceItem` → `state.json`；**必须在 `creative-workspace.cjs` 的 `mindMaps` 分支对 `relations`/`positions` 做显式白名单 + 值域校验**（F1 已证明 `{...base}` 会原样落盘，不校验即有注入风险）：`sourceId/targetId` 必须指向存在的节点、`label ≤500`、`note ≤2000`、`color` 限色值、`style` 限枚举、`relations ≤2000` 条；`positions` 的 key 必须是合法节点 id 且 `dx/dy` 为有限数 |
| P61 | 兼容与上限 | 旧 `mindMaps` 缺 `relations` → 读时默认 `[]`；保持 60 张 / 2000 主题 / 16MB / 20 画布上限不回退；新增关系线上限 2000 条（与 nodes 对齐） |
| P62 | 分发 | 不新增任何依赖、不改 IPC 契约、不改 preload、不改 Electron 主进程、不改打包白名单；**安装版/便携版下载即可编辑**（G09） |

### 5.2 推荐理由（三列对比）

| 维度 | B 图形库重写 | C 外部 XMind | **A 增量扩展** |
|---|---|---|---|
| 解决「任意连线备注」 | ✅ | ✅（由 XMind 提供） | ✅ |
| 下载即用 | ✅ | ❌ | ✅ |
| 零新增依赖 | ❌ | ✅（但不随包） | ✅ |
| 交换包/快照零改造 | ❌ | ❌ | ✅ |
| 既有 UI 断言零改动 | ❌ | ❌ | ✅ |
| 许可风险 | 低（需查库） | 高（Plus/Pro 专有） | 低（纯自研） |
| 工程量 | 大 | 中 | **中偏小** |
| 验收「完全一致」 | ❌ | ⚠️ 单机可达 | ❌（已明确放弃） |

**一句话**：只有方案 A 同时满足「解决核心痛点 + 下载即用 + 零新增依赖 + 交换包/快照/门禁零改造 + 许可干净」；方案 B 能做得更花哨但代价是全链路重写，方案 C 在分发目标下不成立。

### 5.3 为什么「任意连线」不需要重写布局引擎（核心可行性论证）

1. `layoutMindMap` 已输出每个节点的 `(x, y)`（`src/lib/mind-map.ts:157-161`），节点用绝对定位渲染（MindMaps.tsx:318）。
2. 现有 `.mind-map-links` SVG 已用这些坐标画三次贝塞尔（MindMaps.tsx:311-315）。
3. 因此 `relations` 只需存 `sourceId/targetId`，渲染时按 `layout.nodes` 查坐标画路径 —— **与自动布局解耦**，折叠/展开时端点自动跟随（或按 P59 规则隐藏）。
4. 自由摆放（P1）用 `positions.dx/dy` 作为渲染偏移叠加，不改变布局算法与 `nodes` 结构。
5. 结论：**改动集中在「数据层 + 一个 SVG 图层 + 交互命令」，不触碰布局/存储/交换/快照/IPC 主干**。

---

## 6. 一致性要求

| 维度 | 要求 | 判定对象 |
|---|---|---|
| 数据一致性 | `relations` 的 `sourceId/targetId` 必须指向当前 `nodes` 中存在的节点；删除节点时级联删除其关联关系线（或明确拒绝并提示）；不得产生悬空边 | `state.json` 的 `mindMaps[].relations` ↔ 画布渲染 ↔ 属性区 |
| 保存一致性 | 600ms 防抖 / `Ctrl+S` / 切换视图 / 关闭窗口 flush 行为与现状一致；关系线的新增/编辑/删除同样自动保存 | useWorkspaceDraft.ts:64-102 与 README.md:121-122 |
| 跨视图一致性 | 弹窗内外、列表切换、「从角色关系生成」、「导入 XMind 预览」看到的 `relations` 一致；`generateFromRelations` 生成的导图可继续加关系线 | MindMaps.tsx:173-234 |
| 既有契约兼容 | **保留** `.mind-map-panel` / `.mind-map-node` / `.mind-map-modal` / `.mind-map-canvas` DOM 类名与全部既有按钮名（`新建思维导图`、`导入 XMind`、`添加子主题`、`弹窗编辑`…） | test-ui-planning-boards.cjs:108-168 |
| 既有数据兼容 | 0.3.9 及更早的 `mindMaps` 无 `relations` 字段，读取时默认 `[]`，不丢既有节点与备注 | creative-workspace.cjs:184-200 |
| 安全一致性 | 新增字段必须显式白名单 + 值域校验，不得依赖 `{...base}` 直通；IPC 参数仍为纯对象 ≤16MB（`ipc-security.cjs:12-20` 现有约束不变） | creative-workspace.cjs mindMaps 分支 |
| 分发一致性 | 安装版与便携版行为一致；不读取本机 XMind 安装路径、不写绝对路径到项目文件 | package.json:100-105；release-privacy.cjs:9 |

---

## 7. 影响范围

### 7.1 需要修改/新增

| 层 | 文件 | 改动 |
|---|---|---|
| 类型 | `src/types/mindmap.ts` | 新增 `MindMapRelation`；`MindMap` 加 `relations` / 可选 `positions` |
| 类型兼容 | `src/types/workspace.ts`（:228 `mindMaps: MindMap[]`）、`src/types.ts`（:10 兼容导出） | 类型自动继承；**`src/types.ts` 有 30 行门槛**（check-module-boundaries.cjs:11），只做导出不改结构 |
| 布局辅助 | `src/lib/mind-map.ts` | 新增 `layoutRelations(map, layout)` 纯函数：按节点 id 查坐标生成连线路径；`layoutMindMap` 主体不改 |
| 前端组件 | `src/components/MindMaps.tsx` | 关系线 SVG 图层、连线选中/编辑属性区、创建连线交互、撤销/重做栈、多选、右键菜单、自由摆放（P1）；**保留既有按钮名与 DOM 类名** |
| 弹窗宿主 | `src/components/ProgressWorkspace.tsx` | 会话/编辑弹窗结构复用；若新增独立弹窗须用独立 class/按钮名、Esc 单入口（避免与既有 `.mind-map-modal` 断言冲突） |
| 草稿 | `src/hooks/useWorkspaceDraft.ts` | 无需改写入链；如需撤销栈与草稿协同，仅加 `board.update` 调用点 |
| 服务白名单 | `electron/services/creative-workspace.cjs`（:184-200） | **必须**：`relations`/`positions` 显式白名单 + 值域校验 + 悬空边拒绝 |
| 导入（P2） | `electron/services/mind-map-import.cjs` | 可选：解析 XMind 8 `content.xml` 的 `<relationships>` 生成 `relations`；有损项继续标注 |
| 样式 | `src/styles/core/planning-boards.css` | 关系线可交互层、连线标签、连线选中态、右键菜单、只读/多选态 |
| 测试 | `scripts/test-ui-planning-boards.cjs`、`scripts/test/services/mind-map-import.test.cjs`、`scripts/test/services/creative-workspace` 相关用例 | **既有断言保持**；新增关系线/备注/撤销/多选/兼容用例 |
| 文档 | `README.md`（:115-122 中文 / :325-334 英文）、`使用说明_请先看.md:46-78`、`方案P表_思维导图可编辑性改造.md`、`docs/` | 说明新交互与上限；同步中英双版 |

### 7.2 **明确不需要改**（这是相对 A′ 的最大简化）

| 层 | 原因 |
|---|---|
| IPC 契约 / preload / `vite-env.d.ts` | 沿用既有 `upsertCreativeWorkspaceItem` 通道，不新增通道，不触发 `gen-preload --verify` 链 |
| Electron 主进程 / `dependencies.cjs` / `register.cjs` | 全部为渲染层与既有服务内改动 |
| `electron/services/project-exchange.cjs` | 新字段在 `state.json` 内，`portableValue` 整体序列化（F2） |
| `electron/services/project-snapshots.cjs` / `project-archives.cjs` | `analysis` 已在 `MANAGED_ROOTS`/`DATA_ROOTS`（F3） |
| `package.json` 依赖与打包白名单 | 零新增依赖（F6）；`build.files` 不变 |
| `shared/contracts/ipc-channels.cjs` / `scripts/gen-preload.cjs` | 无新通道 |
| `scripts/check-service-map.cjs` 登记 | 不新增 `electron/services/*.cjs` 文件（只改既有文件） |

---

## 8. 风险

| 类别 | 风险项 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|---|
| 数据 | **未校验字段直通落盘** | F1：`{...base}` 保留顶层任意字段，若 `relations` 不做白名单 | 悬空边、超长文本、非法 id、任意字段写入 `state.json` | P60 显式白名单 + 值域 + 悬空边拒绝 + 负向单测 |
| 数据 | 删除节点后关系线悬空 | 用户删节点 | 画布报错/渲染异常 | 级联删除或明确拒绝 + 提示（须拍板选一种） |
| 交互 | 关系线与树边混淆 | 视觉样式接近 | 用户分不清父子关系与自由关系 | 虚线/不同色 + 图例 + 属性区明确标注 |
| 交互 | 折叠/自动布局后端点漂移 | 节点被折叠或重新布局 | 连线指向错误位置 | P59 明确「端点跟随 / 随隐藏节点一并隐藏」规则并写进 AC |
| 性能 | 2000 节点 + 2000 关系线的 SVG 路径渲染 | 大图 | 卡顿（**未实测 / 待基准**） | 按需渲染/虚拟化、连线分层；用 `test:save-performance` 思路做合成基准，禁止手填数字 |
| 工程 | `MindMaps.tsx` 膨胀、hooks 依赖复杂度上升 | 交互命令增多 | lint/hooks 警告、`check:quality` 失败 | 拆分为 `mind-map/` 子模块（组件/hooks/命令），保持 `npm run lint` 0 错误 |
| 门禁 | 新增弹窗撞既有 `.mind-map-modal` / 「关闭弹窗」/ Esc | 复用既有类名 | `test-ui-planning-boards.cjs:143-151` 失败 | 独立 class/按钮名、Esc 单入口 |
| 兼容 | 旧项目无 `relations` | 打开 0.3.9 项目 | 读取异常 | 默认 `[]` + 迁移测试 |
| 许可 | 照抄 XMind 按钮文案/图标/布局 | 追求「像 XMind」 | Plus/Pro 专有界面与商标风险 | 明确不复制文案/图标/布局；只用通用编辑术语 |
| 验收 | 真实桌面 UI 测试在 agent 环境不可执行 | CDP 界面测试 | `test:ui-planning-boards` 等无法在本环境判定 | 引用既有登记 `更新日志_0.3.9.md:24`、`docs/模块化验收_2026-10-12.md:47`，标注「需用户终端或 CI 复跑」 |
| 交互/几何 | **自定义弯曲控制点在布局变化后失真** | `controlPoints` 存绝对坐标，节点折叠/自动布局/缩放后曲线形状错位（XMind 用 `amount/angle` + 相对 `position` 存，见 M10） | 连线形状与用户预期不符 | 控制点**按相对量存**（`amount`/`angle` + 相对端点偏移），渲染时按当前布局坐标重算；写进 AC-S06 |
| 导入 | **XMind 关系线当前会被整段丢弃** | `mind-map-import.cjs:42-56`（`xmlTopic`）与 `:73-84`（`jsonTopic`）只解析 `title/notes/children`；实测 XMind 8 的关系线在 `content.xml` 的 `<relationships><relationship end1 end2><title>…</title><control-points>…` 且**视觉样式在 `styles.xml` 的 `<relationship-properties>`**（M10） | 从 XMind 导入的导图丢失全部箭头联系、标签与虚线样式 | P2 扩展导入器：**同时解析 `content.xml` 关系线 + `styles.xml` 样式表**（`end1/end2→sourceId/targetId`、`<title>→label`、`arrow-end-class/line-pattern/shape-class→样式字段`）；未实现前 UI 必须**显式标注「导入不含关系线」**，不得静默丢失 |
| 范围 | 与 A′ 路线同时实施 | 两套权威源 | 数据分叉、交换包冲突 | **二选一**；若保留 A′ 作为可选增强，须另立需求并明确权威源唯一 |

---

## 9. 验收标准（AC-S01～AC-S18）

> 图例：✅ 可自动/静态判定｜⚠️ 需真机人工或用户终端｜❌ 当前环境不可判定。未实测项逐条标注。

| 编号 | 检查对象 / 方法 | 通过判据 |
|---|---|---|
| AC-S01 | 任意两节点建立关系线（跨分支、跨层级、同层、含根）：DOM 点击 + `state.json` 回读 | `relations` 新增 1 条，`sourceId/targetId` 均指向现存节点；画布出现虚线连线 |
| AC-S02 | 连线文字标签 + 备注（≤500/≤2000 字）：属性区输入 → 自动保存 → 重开 | 标签与备注完整落盘并显示；超长被明确截断或拒绝（与既有 `cleanText` 一致） |
| AC-S03 | 连线选中 / 改色 / 改线型 / **箭头方向** / 删除 | 各操作有可见反馈且落盘；删除后 `relations` 不含该 id；`arrowEnd="triangle"` 时 SVG `marker-end` 可见且指向 `targetId`，`arrowBegin` 可独立设置（单向/双向/无箭头三种形态均可） |
| AC-S04 | 连线可交互（`pointer-events` 调整后） | 点击连线能选中；点击树边/空白处不误选 |
| AC-S05 | 关系线与父子树边视觉区分；**截图样式还原** | 实线 vs 虚线/不同色 + 图例；属性区明确标注类型；用一张参考图（虚线曲线 + 末端三角箭头 + 斜体标签「看作同时进行」）做逐要素比对：曲线形状、虚线间隔、箭头方向、标签位置与字形、连线颜色均可在属性区调整并落盘 |
| AC-S06 | 折叠/展开/重新布局后端点跟随或隐藏规则 | 无悬空坐标、无指向已隐藏节点的连线；规则与文档一致 |
| AC-S07 | 撤销/重做覆盖节点与连线操作（含删除） | 连续 20 步可完整回退/重做；历史栈上限明确 |
| AC-S08 | 多选/框选 + 批量删除/改色 | 多选态可见；批量操作正确落盘 |
| AC-S09 | 右键菜单 | 节点/连线/空白处三类上下文菜单可用且命令正确 |
| AC-S10 | 自由摆放（P1，若纳入） | 拖拽后 `positions` 落盘，重开位置保持；关闭自由摆放时回到自动布局 |
| AC-S11 | 保存一致性 | 600ms 防抖 / `Ctrl+S` / 切换视图 / 关闭窗口 flush 均不丢连线与备注；弹窗内外一致 |
| AC-S12 | 跨视图一致性 | 弹窗/内嵌/列表切换/角色关系生成/导入预览看到同一份 `relations` |
| AC-S13 | 容量与值域 | 60 张 / 2000 主题 / 2000 关系线 / 16MB / 20 画布不回退；负向用例（悬空边、非法 id、超长文本、非有限 `dx/dy`）被拒且 `state.json` 不落脏值 |
| AC-S14 | 既有数据兼容 | 旧 `mindMaps`（无 `relations`）可打开、可继续编辑；`nodes` 8 字段不变 |
| AC-S15 | 快照/备份/项目交换回迁 | 导出→导入后关系线、标签、备注完整；**交换包与快照代码零改动**（静态复核） |
| AC-S16 | 既有 UI 门禁 | `test-ui-planning-boards.cjs:108-168` 既有断言**零改动通过**；新增关系线断言补齐；双路径 `NOVEL_TEST_EXECUTABLE` 分别过 |
| AC-S17 | 质量门禁 | `build`（含 `tsc --noEmit`）/ `test:regression` / `test:services` / `check:quality`（0 错误）/ `check:services` / `check:modules` / `scan:privacy` / `gen:preload --verify` 全通过；**UI 桌面测试与 `dist` 需用户终端或 CI 复跑**（❌ 当前环境不可判定） |
| AC-S18 | 安全与分发 | 沙箱三开关 / CSP 不变；`state.json` 与发布输入无本机绝对路径；**安装版与便携版在不安装 XMind 的机器上仍可创建/编辑关系线与备注**（⚠️ 需真机验证） |

---

## 10. 实施任务分解（仅规划，未执行）

| 任务 | 名称 | 主要文件 | 依赖 | 验证方式 |
|---|---|---|---|---|
| **T01** | 数据模型与服务白名单 | `src/types/mindmap.ts`、`src/types/workspace.ts`、`electron/services/creative-workspace.cjs`（:184-200）、`src/lib/mind-map.ts`（`layoutRelations` 纯函数） | 无 | `npm run build`（`tsc --noEmit`）；服务单测含负向值域用例；旧数据读取默认 `[]` |
| **T02** | 关系线渲染与创建交互 | `src/components/MindMaps.tsx`（SVG 图层 + 创建/选中/编辑）、`src/styles/core/planning-boards.css` | T01 | 静态：`relations` 路径按布局坐标生成；真机：跨分支连线、标签/备注显示、折叠跟随 |
| **T03** | 基础编辑命令 | `MindMaps.tsx`（撤销/重做栈、多选、右键菜单、复制粘贴）；必要时拆 `src/components/mind-map/` 子模块 | T02 | 命令回归；`npm run lint` 0 错误；`check:modules` 通过 |
| **T04** | 自由摆放与导入兼容（P1/P2，可分期） | `MindMaps.tsx`（`positions` 偏移）、`electron/services/mind-map-import.cjs`（**同时解析 `content.xml` 的 `<relationships>` 与 `styles.xml` 的 `<relationship-properties>`**，见 M10） | T02 | `mind-map-import.test.cjs` 增加含 relationship 的 XMind 8 样例（含箭头/虚线/斜体标签断言）；官方模板语料可复用 **7/26** 含 `<relationship ` 元素（本轮实测，语料仅留本机、不进发布输入）。⚠️ **硬约束（§12.1.1 / K4，2026-11-09 终裁）**：XMind 8 `<position svg:x/svg:y>` 是**绝对像素**，而本平台 `controlPoints.x/y` 是按连线长度缩放的**相对量**；导入阶段没有布局端点距离、无法可靠换算，且绝对像素直写已被 N1 证实会让曲线飞出画布 ⇒ **终裁：丢弃 `svg:x/svg:y`，只保留 `amount/angle`（本就是相对量），`controlPoints.x/y` 恒置 0**，并在导入预览显式标注「导入的关系线使用默认曲线 + 相对量控制点，绝对像素位置不导入」。§12.1.1 早期的「须先按端点距离换算」表述**已被本终裁取代** |
| **T05** | 测试、文档与集成 | `scripts/test-ui-planning-boards.cjs`、服务测试、`README.md` 中英双版、`使用说明_请先看.md`、本 P 表、`docs/` | T01–T04 | 全量门禁（AC-S17）；既有断言零改动通过；新增断言；文档一致性人工核对 |

**共享知识（工程师必读）**：`nodes` 8 字段与 `parentId` 树结构**保持不变**；`relations` 是独立边集合，端点只引用 `node.id`；保留全部既有按钮名与 DOM 类名；新增字段必须在 `creative-workspace.cjs` 显式白名单 + 值域校验（F1）；不新增 IPC 通道/依赖/服务文件；日期 ISO 8601 UTC；错误中文明确提示；未实测项一律标注。
**依赖包**：零新增第三方依赖（React 18 / zustand 5 / 现有 SVG 与 Pointer Events 即可）。

---

## 11. 与 A′ P 表的关系 / 待用户拍板

| # | 事项 | 建议默认值 |
|---|---|---|
| 1 | **是否放弃「与 XMind 完全一致」验收目标**，改为「类似 XMind 核心交互 + 可编辑性达标」？ | **放弃**（这是本方案可行的前提；若坚持，回到 A′ 路线） |
| 2 | **自研路线 A 与外部 XMind 路线 A′ 二选一**，还是 A′ 作为可选增强保留？ | **单选 A**（自研）；A′ 若保留须另立需求并明确权威源唯一 |
| 3 | 自由摆放节点（P1）与 XMind `relationship` 导入兼容（P2）是否纳入首期？ | **首期只做 P0（连线/备注/基础编辑/保存/兼容/门禁）**，P1/P2 分期 |
| 4 | 删除节点时关联关系线：**级联删除**还是**拒绝删除并提示**？ | **级联删除**（并在撤销栈中可回退） |
| 5 | 关系线数量上限与历史栈深度 | **2000 条 / 50 步**（与 nodes 对齐；性能基准**未实测**，实施前用合成项目测） |

> **闭合顺序**：用户确认上述 5 条 → 按 §9 冻结 AC → 按 §10 的 T01–T05 实施 → 真机 UI 回归 → 交付。**在确认前不修改任何项目代码。**

---

## 12. 实施就绪状态与 T01 精确改动规格

### 12.1 当前状态（2026-11-09）

| 项 | 状态 |
|---|---|
| 可行性判定 | ✅ 可行（§0） |
| 方案定稿 | ✅ **方案 A（增量扩展）为唯一推荐**；方案 B（图形库重写）可行但代价高；A′ 外部 XMind 路线退为备选/互斥 |
| 截图箭头联系 | ✅ 已纳入 P57 / P58 / G01 / G02 / AC-S03 / AC-S05，并附 XMind 8 属性逐项对照（M10） |
| 语料数字 | ✅ 两份 P 表统一为 **7/26** |
| §11 五条拍板 | ✅ 用户已明确「采纳默认值，开工」，五条按建议默认值锁定 |
| **依赖环境** | ✅ `npm ci --no-audit --no-fund` 已完成（exit 0），`node_modules` 就绪，门禁可执行 |
| **T01 + T02 核心实施** | ✅ 已落地 6 个文件：`src/types/mindmap.ts`、`electron/services/creative-workspace.cjs`、`src/lib/mind-map.ts`、`src/components/MindMaps.tsx`、`src/styles/core/planning-boards.css`、新增 `scripts/test/services/creative-workspace-relations.test.cjs`；另修 `scripts/gen-preload.cjs` 换行符归一化、登记 `scripts/test/service-coverage-map.json` |
| **T03 + T04 实施（用户「继续完成T3和T4」）** | ✅ 已落地 7 修改 + 3 新增。T03：撤销/重做（栈深 50 + `commit` 统一入口 + mergeKey 合并）、多选 + Shift 框选、批量删除/改色、右键菜单（文案去重避免 UI 审计 WARN）、复制粘贴子树（内部剪贴板，relations 两端都在子树内才复制）；命令层拆到新增 `src/lib/mind-map-commands.ts`(176 行) 与 `src/components/mind-map/useMindMapCommands.ts`(127 行)，`MindMaps.tsx` 855 行。T04-A：新增 `applyPositions()` 叠加偏移（**`layoutMindMap` 主体零改动**），节点/树边/关系线端点统一用偏移后 layout，拖拽按 `delta/scale`、mouseUp 才 commit、「重置位置」。T04-B：`mind-map-import.cjs`(161→308 行) 解析 `content.xml` `<relationships>` + `styles.xml` `<relationship-properties>`，XMind topic id → 新 node id 映射（含 root），悬空边/自环丢弃、先过滤再截断；K4 终裁见 §12.1.1 |
| **最终全量门禁（主理人对 20:08 最终态独立复跑，全部 exit 0）** | `build`(1724 modules) / `lint`(0 error, **0 warning**) / `check:quality`(0/0) / `test:services`(**183 tests, 182 pass, 1 skipped, 0 fail**) / 两个新单测(**19 tests, 18 pass, 1 skip**) / `test:regression`(PASS，11/11 + UI 按钮审计 9 PASS、0 WARN) / `check:services`(59 服务) / `check:modules`(PASS) / `scan:privacy`(84 文件) / `gen-preload --verify`(124 通道 PASS) |
| **T03+T04 独立复核（Round 1）** | ❌ `VERDICT: FAIL` —— 19 项逐项复验中 17 项通过，发现 **2 阻塞**：①导入层 `xmlRelationships()` 的解析期 `.slice(0, MAX_RELATIONS)` 导致「2000 悬空 + 5 合法 → **0 条**」（P7 教训在导入层复发、静默丢数据）；②UI 测试 seed 主样例含 relationships，使既有 `some(m=>relations.length===1)` / `find(...)` 抢先命中导入图，`:218` 级联删除断言会 12s 超时、破坏 designated 真机验证脚本本身。另报 7 项低危 N1–N7 |
| **2 阻塞修复（20:08，工程师完成）** | ✅ ①删掉 `mind-map-import.cjs:96` 解析期 slice，过滤后截断交由 `toMindMap:253` 的 break（8 MB 文本上限仍在），并补 `mind-map-import.test.cjs:231` 用例「2000 悬空 + 5 合法 → 5 条」；②`test-ui-planning-boards.cjs` 的 seed 主样例**恢复到 HEAD 原样无 relationships**，另建独立 `关系线样例.xmind`（含 relationships + styles.xml），bootstrap 用 `xmindCalls++` 按调用次数返回不同文件，T04-B 断言走第二次导入。**既有 10 条 checks 与 13 个 `await button()` 零删除零改写**。仅改 3 个文件：`mind-map-import.cjs`、`mind-map-import.test.cjs`、`test-ui-planning-boards.cjs` |
| **N1–N7 低危裁决（待定点复核意见）** | 倾向「**修 N1–N4、登记 N5–N7**」：N1 `snapshotMindMap` 对 `__proto__` key 赋值会改快照对象原型（服务端 positions 白名单已跳过该键，仅 MCP 直写可达）；N2 `applyPositions` 用 `split(">")` 解析 `LaidMindEdge.id`，节点 id 含 `>` 时父 id 被截（建议 `lastIndexOf(">")`）；N3 undo/redo 未收敛 `editingId`/`relationSourceId`、剪贴板跨图不清空；N4 拖拽 mousemove 未限幅、仅 mouseUp clamp。N5（mergePositions 恒返回新对象，措辞已限定）/ N6（门禁盲区，T05 处理）/ N7（脏剪贴板端点回退，正常路径不可达）登记不改 |
| **⚠️ 用户终端真机回归的副本差异（2026-11-09 实测）** | 用户在 `E:\小说\创作平台` 跑 `npm run test:ui-planning-boards` 得到 PASS，但实测该副本 HEAD 虽同为 `dd404a8`，**关系线改动 0 处、UI 断言仅 10 条**；本次实施工作区为 `C:\Users\wk\WorkBuddy\Worktrees\创作平台\main-19f29284`，UI 断言 16 条（T03/T04 后又纯新增 141 行）。⇒ 该 PASS 只证明旧代码未坏，**新功能的真机断言尚未覆盖**；放行前须把改动同步到用户终端副本再跑一次 |
| **`test:regression` 偶发 FAIL 记录** | 并发批次中曾出现一次 `FAIL: 创作 Agent 与数据保护 / expected: /已保留的部分结果/`（`scripts/test-agent-platform.cjs:135`）；**单独重跑 PASS（EXIT=0，11/11 + 9 UI PASS）**，判定为并发时序问题、非代码回归，已如实登记 |
| **lint 修复** | 首轮 `lint` 报 `src/lib/mind-map.ts:105 no-useless-assignment`（`let d = ""` 初值未使用），改为 `let d: string;` 后复跑 0 warning |
| **gen-preload 基线修复** | 首轮 `--verify` FAIL：仓库检出为 CRLF（161 个 CR），生成器输出 LF，`current !== rendered` 严格比较失败，**与本次改造无关**。已恢复原 `preload.cjs`（不产生 161 行纯换行符 diff），并在 `scripts/gen-preload.cjs` 的 `--verify` 加换行符归一化（不掩盖真实契约差异），复跑 PASS |
| **Round 1 独立验证** | ❌ `VERDICT: FAIL` —— 同一套 28 组边界用例发现 **2 阻塞 + 9 缺陷**：箭头被节点遮挡、`1e308` 控制点产出 NaN path、脏类型崩溃、Esc 双触发、自环/重复 id、折叠按钮误触、先截断后过滤丢合法边、controlPoints 相对量不符 |
| **修复轮** | ✅ 2 阻塞 + 7 缺陷按 `文件:行号` 修根因：端点改节点矩形边界交点、控制点加 `|v|≤1e4` 与输出有限性回落、`Array.isArray` 全链路兜底、`onRelationModeChange` + `relationModeRef` 短路关窗、自环/重复 id 拒绝去重、先过滤后截断、`x/y` 改真相对量；测试 8 → **13** 个，UI 断言**纯新增 50 行**（既有断言零删除） |
| **Round 2 独立复验** | ✅ **`VERDICT: PASS（有条件放行）`** —— 同一套脚本零改动重跑，42 个用例段全部执行、24 段逐字节一致（无回归）、18 段变化全落在修复点上；两阻塞均闭环；无新自动化可复现 bug。Round 2 为验证硬上限，不再开第 3 轮完整验证 |
| **收口修补（已完成）** | ✅ K5 `layout.nodes` 加 `Array.isArray`、K6 `ratio` 上限 0.5 防端点交叉、K8 补自环 UI 断言（累计纯新增 67 行 / 0 删除）；P6 折叠按钮**维持规格**并由验证者撤回「残留缺陷」定性；K5/K6 经主理人定点复核闭环 |
| **N1（新发现并修复）** | ✅ 独立验证者发现：`controlPoints` 的 `\|v\|<=10000` 是照搬 positions 绝对像素上限，与 P10 相对量语义不同步；`amount=10000` → 偏移约 **144 万像素**，但 `d` 全为有限数，所以**所有有限性断言都通过、曲线却飞出画布**。修复：服务端收紧 `\|v\|<=8`（`creative-workspace.cjs:221`）+ 前端 `resolveControlPoints` 加两端点包围盒钳制（`mind-map.ts:86-95`）；新增服务用例断言「d 坐标落在包围盒内」而非只查 `Number.isFinite` |
| **N1 定点复核（主理人独立，5 条链路）** | ✅ 临时脚本 `.test-runs/lead-n1-verify.cjs` 读真实 TS/服务模块：A 全链路 `serverRejected:true`、B 绕过服务端直喂回落默认、C 旧语义像素值回落（K4 已登记）、**D 真·小相对量 `d='M 238 132 C 387.04 134.16, 382 132, 526 132'`、`differsFromFallback:true`（钳制未误伤正常弯曲）**、E 服务端保留小相对量 `kept:true`；全部 `allFinite:true` / `withinBBox:true` |
| **F1 / F2 裁决（归档，不修）** | F1：包围盒按两端点 span 外扩、不等于画布视口，中等控制点仍可能**有界**越界（≤一个 span）；F2：自定义弯曲仅在小相对量区间生效，与 K4 同根因。裁决**不收紧**：剩余越界有界而非无限飞出、当前 UI 无 controlPoints 写入口正常路径不可达、收紧会超出 Round 2 验证硬上限且收益有限，留待 T04 随 XMind 8 绝对像素换算一并处理。**措辞更正**：不写「曲线不再飞出画布」，改写「消除非有限与极端量级坐标（144 万像素级 → 画布量级），剩余越界为有界（≤一个 span）」。**覆盖口径并列注明**：新增服务用例 `:324-352` 只覆盖 fallback 分支（单测覆盖缺口），但 `inRange===true` 的**接受分支已由主理人定点脚本 D/E 实测通过**（`differsFromFallback:true` / `withinBBox:true` / `kept:true`），不得记为「该分支未验证」 |
| **N3 登记** | 原始 `state.json` 中关系线缺 `id` → `id:undefined`、React key `undefined-0`；低危、正常 UI 路径不可达、下一次保存自愈。**不补占位 id**：会把占位 id 写进草稿并覆盖服务端 `stableId` 兜底语义 |
| **验证者确认成立的部分** | 悬空边校验顺序、`__proto__` 防护、枚举/颜色/线宽回落完备、旧数据兼容、`board.update` 写入形状不被清洗、`removeNode` 级联覆盖子树、既有 UI 断言 `button()` 精确匹配不受影响、CSS `pointer-events` 方案、不新增 IPC 通道与第三方依赖 |
| **登记为已知限制（不改）** | P8 `...base` 直通额外顶层字段（改造前既有）、P9 `positions` 存而不用（T04 分期）、P11 重复 node id（既有）、颜色仅 6 位 hex、P6 连线模式下折叠按钮无响应、T03 未做（撤销/多选/右键/复制粘贴）、2000+2000 大图性能未实测 |
| **待真机/CI（放行条件）** | ⚠️ **K1 箭头视觉可见性需截图确认**（几何层已把 marker 移到节点边界外，但 SVG 仍在节点 div 之前、节点背景不透明；新增 UI 断言只查 marker 属性存在，不能证明可见）；`test:ui-planning-boards` 全量 CDP 断言、双向箭头 `auto-start-reverse` 朝向、命中路径点选 vs 画布平移、完整交互链路、打包版 marker `url(#id)` 兼容性、`dist` 打包链 |

### 12.1.1 设计约束登记（Round 2 K4，实施时必须遵守）

`controlPoints.x/y` 在 P10 修复后**由绝对像素改为按连线长度缩放的相对量**（`along=(amount+x)*length*0.25`、`across=(angle+y)*length*0.25`）；N1 修复后服务端限 **`|v|≤8`**，前端另有包围盒钳制。当前 UI 无控制点写入口，故无存量数据回归。XMind 8 `content.xml` 的 `<control-point><position svg:x="129" svg:y="-154"/></control-point>` 是**绝对像素**，若直写会按 length 放大数十倍（验证者实测放大 72×、30px → 2160px，A5 c1x `677 → 1366`、A10 `2827.6`）。

> **2026-11-09 终裁（取代本节早期「须按端点距离换算」表述）**：导入阶段**没有布局端点距离**，无法可靠换算；且绝对像素直写正是 N1 「d 全有限但曲线飞出画布」的成因。故 T04-B 实现为：**完全不读取 `svg:x/svg:y`，只保留 `amount/angle`（本就是相对量，XMind 8 实测约 0.3 / 0.26），`controlPoints.x/y` 恒置 0**；`amount/angle` 须有限且 `|v|≤8`、最多 2 个，否则丢弃回落默认曲线。导入预览通过 `XMindImportSheet.relationNote` 显式标注「导入的关系线使用默认曲线 + 相对量控制点，绝对像素位置不导入（K4）」。新版 `content.json` 关系线结构未实测，relations 恒为 `[]` 并标注「暂不导入」，不猜字段。落地位置：`electron/services/mind-map-import.cjs` 的 `xmlRelationships()` / `toControlPoints()` / `XML_RELATION_NOTE`；单测断言序列化后不含 `129` / `-154`。此终裁同步写入 §10 T04 验收口径。

### 12.1.2 Known Issues 汇总（放行前需知悉）

| # | 项 | 状态 |
|---|---|---|
| K1 / N4 | **箭头屏幕可见性**：几何层已把 marker 移到节点边界外，但 SVG 仍在节点 div 之前、节点背景不透明；UI 断言只查 `marker` 元素与 `marker-end` 属性存在，**不证明可见** | ⚠️ **唯一放行条件，需真机截图** |
| K2 | P4 弹窗 Esc、P6 折叠按钮、命中路径点选 vs 画布平移、完整交互链路、双向箭头 `auto-start-reverse` 朝向、打包版 marker `url(#id)` | 需用户终端 / CI 跑 `test:ui-planning-boards` |
| K4 / F2 | `controlPoints.x/y` 为相对量；XMind 8 `<position svg:x/svg:y>` 绝对像素须先换算（见 §12.1.1） | 登记，T04 处理 |
| F1 | 包围盒钳制后仍有界越界可能（≤一个 span） | 登记，不修 |
| N3 | 原始 state.json 关系线缺 id | 登记，低危 |
| P6 / N2 | 连线模式下点折叠按钮 `−/+` 无响应 | **规格内行为**（点节点矩形其他区域可选点） |
| P8 / P9 / P11 | `...base` 直通额外顶层字段（改造前既有）、`positions` 存而不用（T04 分期）、重复 node id（既有） | 明确不改 |
| 性能 | 2000 节点 + 2000 关系线 SVG 渲染 | 未实测 |
| 范围 | T03 撤销/重做/多选/右键/复制粘贴、颜色仅 6 位 hex | 分期 / 与 `<input type="color">` 一致 |

> **结论**：方案层、数据层、渲染层已落地；静态门禁全绿，Round 2 独立复验 **`VERDICT: PASS（可交付真机验证）`**，N1 经主理人 5 条链路定点复核闭环，代码冻结。**唯一放行条件是真机/CI 跑通桌面断言并截图确认终点三角箭头可见**，在此之前不得宣称全量验收通过。T03（撤销/多选/右键）、T04（自由摆放 + XMind relationship 导入，含 K4 换算）、T05（文档与 UI 断言收口）待用户指令后按顺序推进。

### 12.2 实施前准备（用户终端一行）

```powershell
npm ci
npm run build
```

装好依赖后**先跑一次基线门禁**，确认 `tsc --noEmit` 0 错误、`npm run lint` 0 错误，再开始 T01，避免把存量问题误判为改造引入。若 `npm ci` 受网络影响，按既有环境约定检查代理配置。

### 12.3 T01 精确改动规格（可直接消费，勿凭摘要猜参数）

| 文件 | 改动 |
|---|---|
| `src/types/mindmap.ts` | 新增 `MindMapRelation`（字段见 P57）；**全部新字段设为可选**（`relations?: MindMapRelation[]`、`positions?: Record<string,{dx:number;dy:number}>`），以免破坏 `src/lib/mind-map.ts:37-52` `createMindMap()`、`src/components/MindMaps.tsx:219-222` `nextMap` 与 `mind-map-import.cjs:118-124` `toMindMap` 等既有构造点；读取统一用 `map.relations ?? []`。**`MindMapNode` 8 字段与 `parentId` 树结构不动** |
| `electron/services/creative-workspace.cjs`（:184-200） | 在 mindMaps 分支 `return { ...base, title, rootId, nodes }` 前构造 `relations` / `positions` 两个**显式白名单**字段；在 `nodes` 组装完成后做悬空边校验；返回时一并带上。**不要删除 `base` 里其他顶层字段**（旧数据可能含兼容字段，删除会改变既有行为） |
| `src/lib/mind-map.ts` | 新增导出纯函数 `layoutRelations(map: MindMap, layout: MindMapLayout): LaidMindRelation[]`；按 `layout.nodes` 建 `id → {x,y}` 映射；端点不在可见节点集合的关系线**跳过**；按 `shape`/`controlPoints` 生成三次贝塞尔 `d`、标签锚点 `(lx,ly)`；`layoutMindMap` 主体与 `LaidMindEdge` 不变 |
| `scripts/test/services/creative-workspace-relations.test.cjs`（新增） | 正向：合法 `relations` 与 `positions` 落盘并可回读；负向：悬空边、非法 id、超长 `label`/`note`、越界枚举、非有限 `dx/dy`/`amount`、>2000 条被拒或清洗；旧数据无 `relations` 时默认 `[]` |
| **明确不改** | `shared/contracts/ipc-channels.cjs`、`electron/preload.cjs`、`src/vite-env.d.ts`、Electron 主进程、`project-exchange.cjs`、`project-snapshots.cjs`、`package.json` 依赖与 `build.files`、打包白名单 |

**校验规则（工程师按此实现）**

1. `relations` 上限 **2000** 条；每条 `id` 用 `cleanText(id,120)` 或 `stableId` 兜底。
2. `sourceId` / `targetId` 必须 ∈ `nodes[].id`，否则**丢弃该条**（不写入悬空边）。
3. `label ≤500`、`note ≤2000`；`lineColor` 限 `#RRGGBB` 或空串；`lineWidth` 限 1–8 的有限数。
4. `shape`（curved/straight/elbow）、`linePattern`（solid/dash/dot）、`arrowBegin`/`arrowEnd`（none/triangle）、`labelFontStyle`（normal/italic）**限枚举**，越界回落默认值。
5. `controlPoints` 最多 2 项，`amount`/`angle`/`x`/`y` 必须为有限数，按**相对量**存（见风险表「控制点在布局变化后失真」）。
6. `positions` 的 key 必须是现存节点 id，`dx`/`dy` 为有限数且 `|value| ≤ 10000`。
7. 返回 `{ ...base, title, rootId, nodes, relations, positions }`。

### 12.4 验收方式（依赖就绪后）

`npm run build`（含 `tsc --noEmit`）→ `node --test --test-concurrency=1 scripts/test/services/*.test.cjs` → `npm run lint` → `npm run check:quality` → `npm run check:services`。
`test:ui-planning-boards` 等真实桌面测试与 `dist` 需**用户终端或 CI 复跑**（既有登记见 `更新日志_0.3.9.md:24`、`docs/模块化验收_2026-10-12.md:47`）。

---

## 附录 实测证据清单

| 编号 | 证据 | 来源 |
|---|---|---|
| M1 | 现有模型 8 字段 / 布局常量 / SVG 连线层 / 节点绝对定位 / `pointer-events:none` / 画布事件显式排除节点 | src/types/mindmap.ts:1-21；src/lib/mind-map.ts:3-7/:77-163；MindMaps.tsx:244-253/:306-327；planning-boards.css:38-46 |
| M2 | `creative-workspace.cjs:64-71/:184-200` 顶层 `{...base}` 保留、`nodes` 内部逐字段白名单 | 本轮 Read 实测 |
| M3 | `check-module-boundaries.cjs:8-16` 门槛清单**不含 `MindMaps.tsx`** | 本轮 Read 实测 |
| M4 | `project-exchange.cjs:106-108` 整体 `portableValue(workspace)` → `state.json`；`project-snapshots.cjs:5` `MANAGED_ROOTS` 含 `analysis` | 本轮 Bash 只读实测 |
| M5 | `test-ui-planning-boards.cjs:108-168` 硬编码断言清单（按钮名 / DOM 类名 / `mindMaps[0].nodes`） | 本轮 grep 逐行复核 |
| M6 | `package.json:46-91` 无任何图形/拖拽库；`build.files:100-105` 白名单 | 本轮 grep + Read 实测 |
| M7 | 自动保存 `useWorkspaceDraft.ts:64-75` 600ms 防抖 + flush | 本轮 Read 实测 |
| M8 | 官方 XMind 8 模板中 **7/26** 含 `<relationship ` 元素（本轮三种 grep 口径均得 7：`<relationships` / `<relationship ` / `<relationship`；前序记录 8/26 属统计口径差异，本 P 表以 7 为准） | 本轮 Bash 只读实测 |
| M9 | 既有 agent 环境 CDP 界面测试登记 | `更新日志_0.3.9.md:24`、`docs/模块化验收_2026-10-12.md:47` |
| **M10** | **XMind 8 关系线（＝用户截图中的箭头联系）实测结构** —— `content.xml`：`<relationships><relationship end1="…" end2="…" id="…"><title>Equal</title><control-points><control-point amount="0.3" angle="0.2617993877991494" index="0"><position svg:x="129" svg:y="-154"/></control-point>…</control-points></relationship></relationships>`；`styles.xml`：`<style type="relationship"><relationship-properties arrow-begin-class="org.xmind.arrowShape.none" arrow-end-class="org.xmind.arrowShape.triangle" fo:color="#0A5CB9" fo:font-family="Verdana" fo:font-size="11pt" fo:font-style="italic" line-color="#0A5CB9" line-pattern="dash" line-width="2pt" shape-class="org.xmind.relationshipShape.curved"/></style>`。抽样文件 `business/Balance Sheet.xmt`；`styles.xml` 中 `arrow` 4 处 / `dash` 2 处 / `line-color` 10 处 / `line-width` 13 处 | 本轮 `grep -o` + `head -c` 只读实测 |
| M11 | 关系线视觉样式与数据**分离存放**：`<relationship>` 元素本身无 `arrow` / 颜色属性（grep 计数 0），全靠 `style-id` 引用 `styles.xml` | 本轮 grep 实测；导入兼容须同时读两个文件 |
| 未实测 | 大图（2000 节点 + 2000 连线）渲染性能、撤销栈深度手感、真机桌面交互、安装版/便携版在无 XMind 机器上的行为、XMind 新版 `content.json` 关系线字段结构 | 标注「未实测 / 待验证」，不做数字估算 |
