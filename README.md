# AI小说创作平台 · AI Novel Writing Platform

面向长篇小说创作的 Windows 桌面软件。把正文、大纲、人物、世界观、进度和 AI 辅助放在同一个本地项目中，让作者在安静的界面里持续写作，并在需要时查阅资料、梳理剧情。

A Windows desktop application for long-form fiction. Keep manuscripts, outlines, characters, worldbuilding, progress, and AI assistance in one local project, with a quiet writing workspace and tools for checking story continuity.

**当前版本 / Current release: 0.3.7 · Windows x64**

软件界面目前使用中文；本 README 提供完整的中文和英文操作说明，英文部分保留实际中文按钮名称，方便对照界面。

The application uses Chinese interface labels. This README includes complete Chinese and English instructions; the English guide quotes the actual Chinese labels so you can find each control.

---

## 中文说明

### 1. 这个软件适合做什么

适合需要长期维护大量章节、大纲、人物关系和世界设定的小说作者。你可以直接在软件里写正文，也可以导入已有 Word、Markdown 或文本资料，把它们整理到同一个小说项目。写作、导入、保存、资料整理和本地进度管理可以在没有 AI 接口的情况下使用。

AI 功能用于检索相关资料、讨论情节、生成规划和提出修订候选。使用云端模型时，问题、相关资料片段以及必要的上下文会发送到你配置的模型服务；生成结果仍需要作者判断和确认。软件不会因为开启创作 Agent 就自动覆盖正文。

### 2. 下载、安装与升级

在 [0.3.7 发布页](https://github.com/MC-freshman/ai-novel-writing-platform/releases/tag/v0.3.7) 下载适合自己的文件。下面的说明已经包含安装和升级步骤，不需要另找教程。

| 文件 | 用途 | 如何使用 |
| --- | --- | --- |
| [AI-Novel-Writing-Platform-Setup-0.3.7-x64.exe](https://github.com/MC-freshman/ai-novel-writing-platform/releases/download/v0.3.7/AI-Novel-Writing-Platform-Setup-0.3.7-x64.exe) | Windows 64 位安装版 | 运行安装向导，选择安装位置，之后从桌面或开始菜单打开。适合日常固定使用。 |
| [AI-Novel-Writing-Platform-Portable-0.3.7-x64.exe](https://github.com/MC-freshman/ai-novel-writing-platform/releases/download/v0.3.7/AI-Novel-Writing-Platform-Portable-0.3.7-x64.exe) | Windows 64 位便携版 | 下载后直接运行，程序包含所需运行环境，无需安装 Node.js。项目数据仍保存在独立项目目录。 |
| SHA256SUMS.txt | 文件校验 | 与程序一起下载，用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 对照其中的哈希值。 |
| latest.yml、`.blockmap` | 发布更新元数据 | 普通使用者不需要手动打开；它们用于记录发布包和更新信息。 |

本次发布提供 Windows x64 程序，已在 Windows 上执行实际 Electron 界面与写作操作检查。安装版和便携版使用同一套应用内容。本版本的程序未做 Authenticode 代码签名，Windows 首次运行可能显示安全提示；请从本仓库的正式发布页下载，并按需核对校验值。

**第一次使用：**

1. 打开安装版或便携版。软件会创建默认项目，通常位于系统“文档/AI小说创作平台/默认小说项目”。
2. 要使用自己的项目，在顶部点击“新建”创建小说，或点击“打开”选择已有项目目录。
3. 左侧“章节”展示项目中的文档。点击文档名称，正文会在中央打开；底部显示保存状态和字数。
4. 项目目录保存你的正文和资料。便携版并不意味着小说会写到下载的 `.exe` 内，也不意味着移动 `.exe` 就移动了小说。

**从旧版升级：**

1. 在旧版中保存当前章节及正在编辑的角色、世界观或小说统筹网。
2. 使用顶部“更多 → 备份项目”导出备份，保留原项目目录。
3. 关闭旧版，再运行 0.3.7 安装程序或新的便携程序。
4. 在新版中点击“打开”，选择原来的小说项目目录。无需把章节复制进软件安装目录。
5. 升级后可继续使用既有正文、资料、进度和小说统筹网。若界面仍显示旧样式，确认启动的是新的 0.3.7 文件，而不是旧快捷方式。

### 3. 五分钟开始写作

1. 创建或打开小说项目，在左侧“章节”中选择一章；点击目录树旁的“+”可创建新文档。
2. 在中央输入章节标题、所属分卷和正文。排版栏支持标题层级、粗体、斜体、下划线、列表、引用、对齐和表格。
3. 按 `Ctrl+S` 保存。软件也支持在设置中调整自动保存；底部“有未保存修改 / 保存中 / 已保存”反映实际状态。
4. 如果已经在 Word 中写了内容，点击顶部“导入文档”，选择 `.docx`、`.txt` 或 `.md`，也可以从分组旁导入到指定目录。导入 Word 时会尽量保留标题、图片和表格结构。
5. 想专心写作时，点击右上角“专注写作”；需要资料或 AI 时，退出专注或点击顶部“AI 对话”。
6. 在“分析 → 进度 → 章节进度”查看全书状态；需要排期、线索和世界钟时，切换到同一页的“小说统筹网”。

例如，你可以先新建“第一章 雨停之后”，写一段正文并保存，再到章节进度把它标为“写作中”。这是一条真实可完成的工作路径，不要求先配置模型或完成全书规划。

### 4. 安静的写作界面与专注模式

日间主题使用暖纸色和自然绿，夜间主题使用较低亮度的森林绿。中央正文采用本机可用的中文衬线字体；字号与行距仍由设置控制。顶部月亮/太阳按钮切换主题，左右分隔条可以拖动调整面板宽度，已有项目保存的侧栏宽度会继续沿用。

专注模式隐藏左侧目录和右侧 AI 面板，为正文留出更大空间。保存按钮、当前章节字数、退出入口以及底部的章节进度和任务说明仍然可用。任务条可以展开或收起；展开后可勾选场景/筹备任务，并使用“计划中、写作中、已完成、暂缓、自动”操作。退出专注后恢复两侧面板。

| 操作 | 入口或快捷键 |
| --- | --- |
| 保存当前编辑内容 | `Ctrl+S` |
| 进入/退出专注 | 写作页 `Ctrl+Shift+F`，右上角“专注写作 / 退出专注”，或原有 `F11` |
| 返回普通写作界面 | 专注时按 `Esc`；有弹窗时先关闭弹窗 |
| 从专注恢复 AI 面板 | 顶部“AI 对话” |
| 打开功能面板 | `Ctrl+K` |
| 发送 AI 问题 | AI 输入框中 `Ctrl+Enter` |

### 5. 章节进度怎么用

进入“分析 → 进度 → 章节进度”，软件按分卷显示文档网格。每个格子显示标题、字数、状态，以及可用的场景、筹备要点或大纲标题。

- 点击格子里的状态标签，可在“计划中、写作中、已完成、暂缓”之间循环切换。
- 双击格子可写进度备注；点击章节标题可打开正文。
- 点击“批量标记”，选择章节或全选本卷，再使用“设为……”批量修改状态。“恢复自动”清除手动标记。
- 未手动标记时，状态按场景完成情况和字数推导。自动推导是整理提示，作者仍可手动决定最终状态。
- “隐藏已完成”只过滤这个进度视图；格子上的移出按钮或分卷隐藏按钮也不会删除文档。移出的章节可以从“已移出”列表恢复，隐藏的分卷可以从工具栏按钮恢复。

0.3.7 把导航、模式切换、工具按钮、操作说明和分卷统计分开排布。长列表在进度区域内部滚动，紧凑窗口下统计与进度条自动换行，不再把上方导航挤在一起。编辑器底部的当前章进度条在普通写作和专注模式中都会出现。

### 6. 小说统筹网：线程、排期、世界钟与信息揭露

入口是“分析 → 进度 → 小说统筹网”。它用于维护计划表和正文之间的关系，与章节进度共享入口，但规划章号和实际正文编号分别管理。

1. 点击“新建小说网”，填写名称。默认提供 POV 线程、逐章排期、世界钟、信息台账和已写章节对齐等表，也可添加自定义表。
2. 选择一张表，点击“添加记录”，编辑事件、角色、线索或时间等列。“调整列与地区”可增删和改名列。
3. 使用“记录列表”在窄窗口中逐条编辑；使用“表格总览”按列对照记录，宽表在表格内部横向滚动。筛选可查事件文字或 T/R 标记，每页显示 40 条。
4. 在“关联已写正文”中手动绑定实际文档，再用“打开关联正文”回到章节。通过 `T1`、`R1` 等标记和计划章区间查看相关记录，自动关联用于导航，情节关系仍由作者判断。
5. 点击“保存小说网”或按 `Ctrl+S`。想单独留一份规划副本时可导出 JSON；小说网也随项目快照、备份和项目交换保存。

**导入已有规划：**“导入文件”支持 `.md`、`.markdown`、`.docx` 和平台导出的 `.json`，可多选；“导入目录”读取目录顶层的支持文件。导入先显示表格、记录和警告预览，确认后才创建新网或追加。完全相同的记录会去重，存在差异的内容保留供作者核对，原始文件不被改写。

可以导入 Markdown/Word 表格，也可使用逐章排期文本，例如：

```text
## 第一块
01｜T1｜修理路灯，留下线索｜埋R1
02｜T1｜核对公告｜验R1
```

导入文字保留在“说明与导入原文”。此功能提取 Word 的可编辑文字和表格，图片仍保留在原始 Word 文件中。跨项目导入 JSON 后，正文链接可能需要重新绑定；失效链接会提示检查。若保存遇到版本冲突，当前输入会保留为草稿，可先导出 JSON，再重新读取最新版本整理。

容量上限：每项目 20 个小说网；每网 80 张表、10,000 条记录、32 列、30 份原始说明，总文字数据 4 MB。每次导入 1–16 份资料，单文件上限 8 MB。超出上限会拒绝相应保存或导入，而不是截断现有规划。

### 7. AI 对话、模型设置与检索

点击顶部齿轮进入“设置”，选择接口提供商，填写自己的接口密钥、接口地址和模型名称，再保存设置。内置 DeepSeek、通义千问/Qwen、OpenAI、Kimi、Claude、Ollama 和自定义兼容接口配置；模型是否可用、额度和费用由所选服务决定。

| 设置示例 | 接口地址 | 聊天模型示例 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 / Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |

这些是应用配置示例，使用前应按服务账户实际支持的接口和模型填写。聊天接口与向量接口有各自的地址、模型和密钥设置；如果向量接口降级，界面会给出提示，可以到设置检查配置，并在知识库维护工具中重建索引。

右侧“对话”用于自由提问，“创作参谋”用于下一章、剧情推进和伏笔等规划。提问前会检索当前项目的资料；检索详情列出命中范围、发送片段、覆盖情况及暂未读取的资料。回答以流式显示，可以停止生成，已收到的内容会保留。每个项目保留最近的会话，AI 项目记忆可保存简短的背景和偏好。

空态中的示例会先把问题填入输入框，并不会自动发送。也可以选中正文后右键向 AI 提问。配置完成后，可以尝试“分析当前章节节奏，并指出哪里需要放慢或加速”，先核对回答引用的材料，再决定是否使用建议。

“候选扫描上限”和“发送片段上限”是两级限制，不代表每次全部发送。候选上限为 50,000，发送上限为 1,000；普通问题会先路由到相关文档，全书分析可能读取更多资料。增大上限可能提高请求体量和模型费用，不能保证模型读到所有章节。没有配置可用聊天接口时，本地写作和资料管理仍可使用。

### 8. 资料、剧情规划与数据保护

**人物与世界观：**左侧“角色”和“世界”维护人物卡、关系、地点、势力、物品和设定。支持多级分类与拖动整理；从资料提取或生成的候选仍应检查内容。

**知识库：**“知识库”整理文档归属，把资料标为大纲、正文或补充材料，并调整目录。保存和导入会更新索引与文档/分组/全书摘要。诊断工具可检查过期资料、索引新鲜度、中断任务和失效引用，并修复可处理的缓存问题。

**创作状态与工作台：**从 AI 标题栏“创作状态”入口管理有原文证据的剧情事实、角色位置/目标/知情/持有物、伏笔生命周期和下一章筹备。工作台还提供场景、剧情因果、角色弧线、分层项目记忆、章节质量诊断与项目交换。

**分析工具：**全局搜索、时间线、关系网、一致性检查、章节版本对比和导出/提取集中在“分析”。检查可以限定资料范围，结果供作者确认、忽略或修复。人物出场统计、地点/势力版图和素材库在导出/提取的试验功能中。

**安全修订：**选中正文后从右键菜单生成修订候选或添加批注。修订可整体或逐句采纳；应用前校验原文位置并保存历史版本，冲突时停止写入。批注独立保存。每章的撤销/重做历史独立，快速切章会丢弃迟到的加载结果。

**创作 Agent 与后台任务：**Agent 根据目标准备工具计划，执行前展示范围和权限。只读分析、创建规划和生成修订候选分别控制可执行内容，候选不会直接覆盖正文。后台任务中心可查看等待、运行、暂停、失败和中断状态，并按实际任务支持暂停、继续、停止或重试。

**快照和实验分支：**项目快照按内容哈希保存，可比较和恢复；恢复前创建安全快照。实验分支用于保留另一条创作路线，被使用的快照和当前分支有保护。快照不能替代项目外的备份副本。

### 9. 导出、备份、隐私与软件更新

- 顶部“导出正文”按目录逐篇生成 Word 文档。需要当前篇时用“更多”中的当前文档导出；带大纲、材料、角色或世界观的导出可在分析页选择范围。
- Word 导出尽量保留标题、图片、表格、批注和修订，但复杂 Word 布局仍应在导出后核对。
- “更多 → 备份项目”导出压缩备份；项目交换可选正文、人物、世界观、素材和分析数据，并支持设置密码。交换包排除接口设置、密钥、向量库、历史备份和本机导入路径。
- 正文、资料、规划、索引和备份主要存放在你的项目目录；程序安装目录与小说目录是两回事。请保留项目目录，并定期把备份复制到另一位置。
- Windows 正式版使用 Windows 凭据管理器保存聊天和向量密钥，项目配置保存凭据引用；旧配置中的兼容密钥在保存设置时迁移。不要把小说目录、备份或密钥文件提交到公开仓库。
- 本地保存不等于云端 AI 调用离线。调用远程模型时，问题和检索到的相关内容会按请求发送到该服务。可自行选择服务或配置本地 Ollama 接口。
- “设置 → 发布、密钥与软件更新”可以手动检查 GitHub 更新和密钥状态。软件在确认后才下载或打开更新程序，不会静默安装。

### 10. 常见问题

**打开后不是我的小说。** 可能打开了默认项目。点击顶部“打开”，选择保存原小说的项目目录，查看左侧底部路径确认位置。

**升级后界面没变。** 检查是否仍在运行旧程序或旧快捷方式。保存并关闭旧版，再打开 0.3.7 的安装版或便携版。

**想在专注模式里查看任务。** 底部仍显示当前章进度条，点击箭头展开任务说明。可勾选任务、切换状态；`Esc` 返回普通布局。

**进度页有很多章节，看不到后面的内容。** 在章节网格区域滚动；上方导航和模式切换保持独立。检查“隐藏已完成”、被隐藏的分卷和“已移出”筛选。

**AI 不能回答。** 先检查提供商、地址、模型、密钥及服务额度。索引问题可在知识库查看诊断；停止或失败后先保留已生成内容，再按错误提示修改配置或重试。

**保存提示冲突。** 当前输入可能仍在恢复草稿里。先保留或导出草稿，重新读取最新内容，再对照历史版本；不要通过删除项目文件来绕过保护。

### 11. 0.3.7 本次更新与验证

0.3.7 汇总了自 0.3.5 公开版本之后的写作界面更新：暖纸/自然绿与森林夜色、正文优先布局、清晰的专注入口、章节进度默认收起、可行动的 AI 示例；同时修复进度页拥挤重叠，并恢复专注模式中的完整进度与任务操作。

这次验证覆盖构建、自动回归、章节保存与撤销隔离、角色/世界表单、小说统筹网、现有界面回归，以及 37 章合成项目在 1440×900 和 1180×720 窗口中的进度布局。便携版经过实际启动、编辑保存、专注进入/退出、任务勾选和批量进度操作检查。测试使用合成资料，未调用用户的云端模型账户；界面走查不等于真人长期写作体验研究。

### 12. 开发与许可

源码使用 React、TypeScript、Vite、Electron 和 TipTap。开发需要 Node.js 22.12.0 或更新版本，以及 npm；下载正式程序的普通使用者不需要安装这些开发工具。

```powershell
git clone https://github.com/MC-freshman/ai-novel-writing-platform.git
cd ai-novel-writing-platform
npm ci
npm run start
```

`npm run dev` 只启动 Vite 前端；完整桌面功能依赖 Electron 的本地接口，日常开发和测试请使用 `npm run start`。项目未随源码包含作者的小说数据或接口密钥。

```powershell
npm run build
npm run test:regression
npm run lint
npm run test:ui-plan
npm run test:ui-novel-network
npm run test:ui-visual
npm run test:ui-serene
npm run scan:privacy
npm run dist
```

构建生成前端 `dist/`，打包生成 `release/` 中的安装版和便携版。GitHub Actions 在 Windows 上执行自动回归并保留测试证据；长篇项目与保存性能检查还可分别执行 `npm run test:long-project`、`npm run test:save-performance`。

提交时不要加入 `node_modules/`、`dist/`、`release/`、`.test-runs/`、`.private/`、小说目录、`novel.config.json`、向量库、备份、`.env` 或密钥文件。仓库已经提供相应忽略规则，提交前仍应检查实际文件。

本项目为 **源码可见、保留所有权利** 的软件。可以下载用于个人写作、学习和测试，也可以私下修改用于个人用途；未经作者明确书面许可，不得商业分发、改名发布、二次销售、移除版权信息或声称为自己的原创产品。完整许可条件见仓库根目录 `LICENSE`。

---

## English guide

### 1. What the application is for

The application is designed for writers who maintain many chapters, outlines, character relationships, and worldbuilding notes over a long project. Write in the editor or import existing Word, Markdown, and text documents into the same novel project. Writing, importing, saving, organizing local material, and tracking progress work without a configured AI service.

AI tools retrieve relevant material, discuss plot ideas, prepare plans, and propose revisions. When you use a remote model, your question, selected material, retrieved excerpts, and necessary context are sent to the service you configure. Review its output before adopting it. Enabling the creative Agent does not automatically replace manuscript text.

### 2. Download, install, and upgrade

Download the files from the [0.3.7 release](https://github.com/MC-freshman/ai-novel-writing-platform/releases/tag/v0.3.7). The installation and upgrade instructions are included below.

| File | Purpose | How to use it |
| --- | --- | --- |
| [AI-Novel-Writing-Platform-Setup-0.3.7-x64.exe](https://github.com/MC-freshman/ai-novel-writing-platform/releases/download/v0.3.7/AI-Novel-Writing-Platform-Setup-0.3.7-x64.exe) | Windows x64 installer | Run the wizard, choose an installation location, then launch from the desktop or Start menu. Suitable for regular use on one computer. |
| [AI-Novel-Writing-Platform-Portable-0.3.7-x64.exe](https://github.com/MC-freshman/ai-novel-writing-platform/releases/download/v0.3.7/AI-Novel-Writing-Platform-Portable-0.3.7-x64.exe) | Windows x64 portable application | Download and run it directly. The runtime is bundled; Node.js is not required. Your novel remains in a separate project directory. |
| SHA256SUMS.txt | Download verification | Download it alongside the application and compare its entries with PowerShell `Get-FileHash -Algorithm SHA256`. |
| latest.yml and `.blockmap` | Release/update metadata | Ordinary users do not need to open these files manually. They describe the release artifacts and update information. |

This release provides Windows x64 applications. Real Electron interface and writing checks were performed on Windows. The installer and portable application contain the same application payload. The executables do not have an Authenticode signature, so Windows may show a security prompt on first launch. Use this repository's official release and check the supplied hashes when needed.

**First launch:**

1. Open the installed or portable application. It creates a default project, normally under your Windows Documents folder at `AI小说创作平台/默认小说项目`.
2. Click `新建` (New) to create your own novel, or `打开` (Open) to select an existing project directory.
3. The `章节` (Chapters) panel lists the project documents. Click a document to open it in the central editor; the bottom bar shows its word count and save state.
4. The project directory contains your manuscripts and material. The portable executable does not contain your novel, and moving the `.exe` does not move the project.

**Upgrading from an earlier version:**

1. Save the current chapter and any character, worldbuilding, or planning-network edits in the old version.
2. Use `更多 → 备份项目` (More → Back up project) and keep the original project directory.
3. Close the old version, then run the 0.3.7 installer or the new portable executable.
4. Click `打开` (Open) in the new version and select the existing novel directory. You do not need to copy chapters into the application's installation directory.
5. Continue using your existing chapters, reference material, progress, and planning networks. If the old interface still appears, check that you launched the new file rather than an old shortcut.

### 3. Start writing in five minutes

1. Create or open a project, choose a chapter in `章节`, or use the `+` beside the document tree to create a document.
2. Enter the chapter title, volume, and text in the editor. The formatting toolbar supports heading levels, bold, italics, underline, lists, quotations, alignment, and tables.
3. Press `Ctrl+S` to save. Automatic saving can be adjusted in Settings. The bottom bar distinguishes unsaved changes (`有未保存修改`), saving (`保存中`), and saved (`已保存`).
4. To bring in existing material, click `导入文档` (Import documents) and choose `.docx`, `.txt`, or `.md` files. Import from a group in the tree to place files in that group. Word import attempts to retain headings, images, and table structure.
5. Click `专注写作` (Focus writing) at the upper right when you want more room for the manuscript. Exit focus or use `AI 对话` when you need the assistant.
6. Open `分析 → 进度 → 章节进度` (Analysis → Progress → Chapter progress) to track the book. Switch to `小说统筹网` in the same workspace for schedules, threads, information reveals, and the world clock.

A simple first task is to create a chapter, write a paragraph, save it, and mark it as `写作中` (Writing) on the progress page. You can complete this without configuring a model or planning the whole book.

### 4. The quiet workspace and focus mode

The daytime theme uses warm paper and natural green. The night theme uses darker forest colors. Manuscript text uses an available local Chinese serif font; Settings still controls font size and line spacing. The moon/sun button switches themes, and the vertical dividers resize the side panels. Existing saved panel widths continue to be used.

Focus mode hides the document tree and AI side panel to give the manuscript more space. Saving, the current chapter's word count, the exit control, and the chapter progress/task strip remain available. Expand or collapse the bottom strip; when expanded, check off scene/preparation tasks and use the planned, writing, completed, paused, or automatic status controls. Exiting focus restores the side panels.

| Action | Control or shortcut |
| --- | --- |
| Save current edits | `Ctrl+S` |
| Toggle focus | `Ctrl+Shift+F` while writing, `专注写作 / 退出专注`, or the existing `F11` menu shortcut |
| Return to the normal workspace | `Esc` in focus mode; close an open dialog first |
| Restore the AI panel from focus | `AI 对话` in the top bar |
| Open the feature panel | `Ctrl+K` |
| Send an AI question | `Ctrl+Enter` in the AI input box |

### 5. Chapter progress

Open `分析 → 进度 → 章节进度`. Documents are grouped by volume. Cards show the title, word count, status, and available scene, preparation, or outline information.

- Click a status label to cycle through `计划中` (Planned), `写作中` (Writing), `已完成` (Completed), and `暂缓` (Paused).
- Double-click a card to edit its progress note; click the chapter title to open the manuscript.
- Use `批量标记` (Batch mark), select chapters or all visible chapters in a volume, and apply a status. `恢复自动` clears manual overrides.
- Without an override, status is derived from scene completion and word count. This is an organizational aid; the author can set the intended status manually.
- `隐藏已完成` filters completed chapters out of the view. Hiding a volume or removing a card from the progress view does not delete its document. Restore removed chapters from `已移出`, or use the toolbar button for a hidden volume.

In 0.3.7, navigation, mode controls, action buttons, help text, and volume statistics have separate space. Long chapter lists scroll inside the progress area, and statistics/progress controls wrap in compact windows. They no longer compress the navigation into the content. The current chapter's progress strip appears in both normal writing and focus mode.

### 6. Novel planning networks

Open `分析 → 进度 → 小说统筹网` (Analysis → Progress → Novel planning network). This workspace relates planning tables to actual manuscript documents. Planned chapter numbers and written-document references are maintained separately.

1. Click `新建小说网` (New network) and enter a name. Default tables cover POV threads, chapter schedules, the world clock, information tracking, and written-chapter alignment; custom tables are also supported.
2. Select a table, click `添加记录` (Add record), and edit event, character, clue, or time columns. `调整列与地区` adds, renames, or removes columns.
3. Use the record list in narrow windows or `表格总览` (Table overview) to compare columns. Wide tables scroll horizontally inside their own area. Filtering accepts event text and T/R markers; each page contains up to 40 records.
4. Bind an actual document under `关联已写正文` (Link written text), then use `打开关联正文` to open it. Shared markers such as `T1` and `R1`, chapter ranges, and linked documents help you navigate related records. The author decides whether events are causally related.
5. Save with `保存小说网` (Save network) or `Ctrl+S`. Export JSON to keep a separate planning copy. Networks are also included in project snapshots, backups, and project exchange.

**Importing existing plans:** `导入文件` accepts `.md`, `.markdown`, `.docx`, and application-exported `.json`, including multiple files. `导入目录` reads supported files at the selected directory's top level. Inspect the tables, records, and warnings in the preview before confirming a new network or an append. Identical records are deduplicated; differing content is retained for review. Original files are not rewritten.

Markdown/Word tables and chapter-schedule text are supported. For example:

```text
## Opening sequence
01｜T1｜Repair the streetlight and leave a clue｜plant R1
02｜T1｜Check the notice｜verify R1
```

Imported text is retained in `说明与导入原文` (Notes and imported source). This feature extracts editable Word text and tables; images remain in the original Word file. After importing JSON into another project, manuscript links may need rebinding. Invalid links are flagged. If saving conflicts with a newer version, the current input remains as a draft; export it to JSON before reloading and reconciling changes.

Limits: 20 networks per project; 80 tables, 10,000 records, 32 columns, 30 imported source documents, and 4 MB of text data per network. Import 1–16 files at a time, with an 8 MB limit per file. Requests exceeding these limits are rejected rather than silently truncating the existing plan.

### 7. AI setup, conversation, and retrieval

Open the gear-shaped Settings control. Select a provider, enter your own API key, endpoint, and model name, then save. The application includes configurations for DeepSeek, Qwen, OpenAI, Kimi, Claude, Ollama, and custom compatible services. Model availability, quotas, and fees depend on your chosen service.

| Configuration example | Endpoint | Example chat model |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |

These are application configuration examples. Use the endpoints and models available to your service account. Chat and embedding services have separate endpoint, model, and key settings. If embedding falls back, the interface displays a warning; check its configuration and use knowledge-base maintenance tools to rebuild the index when appropriate.

`对话` (Conversation) handles free-form questions. `创作参谋` (Creative advisor) helps plan the next chapter, plot developments, and foreshadowing. Questions retrieve relevant material from the current project first. Retrieval details show the selected scope, excerpts, coverage, and material not yet read. Answers stream into the interface; Stop retains the text already received. Recent conversations are kept within the project, and project AI memory can store short background notes and preferences.

An empty-state example fills the input box without sending automatically. You can also select manuscript text and use its context menu to ask a question. After setup, try asking the assistant to assess the current chapter's pacing. Review the cited material before adopting the suggestion.

The candidate scan limit and sent-excerpt limit are separate ceilings, not an instruction to send everything. Their maximums are 50,000 candidates and 1,000 excerpts. Ordinary questions route to relevant documents; whole-book analysis can read more material. Larger limits can increase request size and service cost, and do not guarantee every chapter reaches the model. Local writing and organization remain usable without an available chat service.

### 8. Reference material, story planning, and protection

**Characters and worldbuilding:** `角色` and `世界` store character cards, relationships, locations, factions, items, and setting notes. Categories support multiple levels and drag organization. Review extracted or generated content before relying on it.

**Knowledge base:** `知识库` manages document roles—outline, manuscript, or supplementary material—and their groups. Saving/importing updates indexes and document/group/book summaries. Diagnostics check outdated material, index freshness, interrupted tasks, and invalid references, with repair tools for supported cache issues.

**Story state and workspace:** Use `创作状态` in the AI header to manage evidence-backed facts, character positions/goals/knowledge/items, foreshadowing lifecycles, and next-chapter preparation. The workspace also contains scenes, causal relationships, character arcs, layered project memory, chapter diagnostics, and project exchange.

**Analysis:** `分析` contains global search, timelines, relationship graphs, consistency checks, chapter-version comparison, and export/extraction. Checks can be scoped to selected material, and their findings can be confirmed, ignored, or addressed. Experimental tools cover appearances, location/faction maps, and a material library.

**Safe revisions:** Select manuscript text and use the context menu to propose a revision or add an annotation. Adopt revisions as a whole or sentence by sentence. Applying one checks the original location and saves history; conflicts stop the write. Annotations are stored separately. Undo/redo history is independent per chapter, and stale responses from rapid chapter switches are discarded.

**Creative Agent and background tasks:** The Agent prepares a tool plan and displays its scope and permissions before execution. Read-only analysis, planning creation, and revision-candidate generation have separate permissions. Candidates do not directly overwrite the manuscript. The task center shows queued, running, paused, failed, and interrupted work, with pause/resume/stop/retry controls where supported.

**Snapshots and creative branches:** Snapshots use content hashes and support comparison and restoration. Restoration first creates a safety snapshot. Creative branches preserve alternative directions, and referenced snapshots/current branches are protected. Keep an external backup in addition to snapshots.

### 9. Export, backup, privacy, and updates

- `导出正文` (Export manuscript) creates separate Word documents in document-tree order. Use More for the current document, or the analysis export options to include outlines, material, characters, or worldbuilding.
- Word export attempts to preserve headings, images, tables, annotations, and revisions. Check complex Word layouts after export.
- `更多 → 备份项目` exports a compressed backup. Project exchange supports selected manuscript, character, world, material, and analysis data, with optional password protection. Exchange excludes API settings, credentials, vector indexes, history backups, and local import paths.
- Manuscripts, reference material, plans, indexes, and backups are kept mainly in the project directory, separate from the installed application. Keep that directory and copy backups to another location regularly.
- Windows release builds store chat and embedding keys in Windows Credential Manager, with credential references in project configuration. Compatible keys in older configurations migrate when settings are saved. Do not publish novel directories, backups, or credential files.
- Local storage does not make remote AI calls offline. Questions and relevant retrieved content are sent to the configured remote service when a request is made. You can choose a provider or configure a local Ollama endpoint.
- Settings contains `发布、密钥与软件更新` (Release, credentials, and updates) for a manual GitHub update check and credential status. Downloads/opening an update require confirmation; the application does not silently install it.

### 10. Troubleshooting

**The application opened an unfamiliar novel.** It may be the default project. Use `打开` to select your existing novel directory and check the path displayed at the bottom of the left panel.

**The interface did not change after upgrading.** Check the executable and shortcut. Save and close the old application, then open the 0.3.7 installed or portable version.

**I need tasks in focus mode.** The chapter progress strip remains at the bottom. Expand it to read tasks, mark completion, and change status. `Esc` returns to the normal layout.

**I cannot find later chapters on the progress page.** Scroll within the chapter-card area. Navigation and mode controls have separate space. Check the completed filter, hidden-volume buttons, and removed-chapter list.

**AI cannot answer.** Check the provider, endpoint, model, key, and service quota. Inspect knowledge-base diagnostics for indexing issues. Retain any partial response, then correct the configuration or retry according to the reported error.

**Saving reports a conflict.** Current input may still be in a recovery draft. Preserve/export it, reload the latest content, and compare history. Do not delete project files to bypass the protection.

### 11. Changes and validation in 0.3.7

0.3.7 includes the writing-interface changes since the public 0.3.5 release: warm paper/natural green and forest-night themes, a manuscript-first layout, a clearer focus entry, a collapsed-by-default chapter strip, and editable AI examples. It also fixes crowded/overlapping progress navigation and keeps complete chapter/task controls available in focus mode.

Validation covered the build, automated regression suite, saving and undo isolation, character/world forms, planning networks, existing UI regression, and progress layout with 37 synthetic chapters at 1440×900 and 1180×720. The portable executable was exercised for startup, editing/saving, focus entry/exit, checking tasks, and batch progress operations. Tests use synthetic material and do not call a user's remote model account. These checks are not a long-term study with real writers.

### 12. Development and license

The application uses React, TypeScript, Vite, Electron, and TipTap. Development requires Node.js 22.12.0 or newer and npm. Release users do not need these development tools.

```powershell
git clone https://github.com/MC-freshman/ai-novel-writing-platform.git
cd ai-novel-writing-platform
npm ci
npm run start
```

`npm run dev` starts only the Vite frontend. Full desktop features use Electron's local bridge; use `npm run start` for desktop development and testing. Source does not include the author's novel projects or API credentials.

```powershell
npm run build
npm run test:regression
npm run lint
npm run test:ui-plan
npm run test:ui-novel-network
npm run test:ui-visual
npm run test:ui-serene
npm run scan:privacy
npm run dist
```

The frontend build goes to `dist/`; installers and portable packages go to `release/`. GitHub Actions runs regression on Windows and preserves test evidence. Additional long-project and save-performance checks are available through `npm run test:long-project` and `npm run test:save-performance`.

Do not commit dependencies, generated builds, release packages, `.test-runs/`, `.private/`, novel directories, `novel.config.json`, vector indexes, backups, `.env`, or key files. Ignore rules are supplied, but review the actual staged files before publishing.

This is **source-available software with all rights reserved**. You may download it for personal writing, learning, and evaluation, and privately modify it for personal use. Commercial distribution, rebranding/publishing modified builds, resale, removal of copyright notices, or claiming the product as your own requires the copyright holder's explicit written permission. The full terms are in the root `LICENSE` file.
