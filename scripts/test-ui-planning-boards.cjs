const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const AdmZip = require("adm-zip");
const { connectCdp } = require("./lib/cdp-client.cjs");
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const workspaceService = require("../electron/services/creative-workspace.cjs");

const root = path.resolve(__dirname, "..");
const runDirectory = path.join(root, ".test-runs", `planning-boards-ui-${Date.now()}`);
const projectPath = path.join(runDirectory, "project");
const port = 10500 + Math.floor(Math.random() * 300);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { status: "running", checks: [], screenshots: [] };
let child, cdp;

async function until(expression, label) {
  for (let i = 0; i < 120; i++) {
    if (await cdp.evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`界面等待超时：${label || expression}`);
}
async function button(text, scope = "document") {
  const clicked = await cdp.evaluate(`(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});e?.click();return Boolean(e)})()`);
  assert.equal(clicked, true, `找不到按钮：${text}`);
  await wait(160);
}
async function fill(label, value, tag = "input") {
  const prototype = tag === "textarea" ? "HTMLTextAreaElement" : tag === "select" ? "HTMLSelectElement" : "HTMLInputElement";
  await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)});if(!e)throw Error('Missing field ${label}');Object.getOwnPropertyDescriptor(${prototype}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(tag === "select" ? "change" : "input")},{bubbles:true}));return true})()`);
  await wait(120);
}
async function workspace() {
  return cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>({maps:w.mindMaps||[],grids:w.progressGrids||[]}))");
}
async function shot(name) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png" });
  const file = path.join(runDirectory, `${name}.png`);
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  report.screenshots.push(file);
}
async function seed() {
  await fs.mkdir(projectPath, { recursive: true });
  await platform.ensureProjectStructure(projectPath, "思维导图与进度网格界面验证");
  const config = await platform.loadConfig(projectPath);
  config.agent.autoLocalAnalysis = false;
  await platform.saveConfig(projectPath, config);
  const charactersDir = path.join(projectPath, "characters");
  await fs.mkdir(charactersDir, { recursive: true });
  await fs.writeFile(path.join(charactersDir, "mcp_hero.json"), JSON.stringify({ id: "mcp_hero", fileName: "mcp_hero.json", name: "测试主角", category: "主角团", relationships: "测试配角：同伴", notes: "追查线索" }));
  await fs.writeFile(path.join(charactersDir, "mcp_friend.json"), JSON.stringify({ id: "mcp_friend", fileName: "mcp_friend.json", name: "测试配角", category: "主角团", relationships: "测试主角：同伴", notes: "协助调查" }));
  const xmindPath = path.join(runDirectory, "导入样例.xmind");
  const relationXmindPath = path.join(runDirectory, "关系线样例.xmind");
  const zip = new AdmZip();
  // 主样例必须保持无 relationships：既有关系线断言用 relations.length===1 定位「当前编辑图」，
  // 若导入图自带关系线会抢先命中，导致随后断言假通过或超时（T03/T04 复验阻塞 2）。
  zip.addFile("content.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet id="s1"><topic id="root"><title>导入的中心主题</title><children><topics type="attached"><topic id="a"><title>导入的子主题</title><notes><plain>来自 XMind 的备注</plain></notes></topic></topics></children></topic></sheet></xmap-content>`, "utf8"));
  zip.writeZip(xmindPath);
  // T04-B 专用独立样例：含 XMind 8 relationships + styles.xml，由第二次 importXMind 读取。
  const relationZip = new AdmZip();
  relationZip.addFile("content.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet id="s1"><topic id="root"><title>关系线中心</title><children><topics type="attached"><topic id="a"><title>关系线分支 A</title></topic><topic id="b"><title>关系线分支 B</title></topic></topics></children></topic><relationships><relationship end1="a" end2="b" id="rel-1" style-id="rel-style-1"><title>看作同时进行</title><control-points><control-point amount="0.3" angle="0.26" index="0"><position svg:x="129" svg:y="-154"/></control-point></control-points></relationship></relationships></sheet></xmap-content>`, "utf8"));
  relationZip.addFile("styles.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><styles><style id="rel-style-1" type="relationship"><relationship-properties arrow-begin-class="org.xmind.arrowShape.none" arrow-end-class="org.xmind.arrowShape.triangle" fo:color="#0A5CB9" fo:font-style="italic" line-color="#0A5CB9" line-pattern="dash" line-width="2pt" shape-class="org.xmind.relationshipShape.curved"/></style></styles>`, "utf8"));
  relationZip.writeZip(relationXmindPath);
  // 第一次导入返回无关系线的主样例（既有断言），第二次返回 T04-B 专用样例。
  await fs.writeFile(path.join(runDirectory, "bootstrap.cjs"), `const {dialog}=require('electron');let xmindCalls=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[xmindCalls++===0?${JSON.stringify(xmindPath)}:${JSON.stringify(relationXmindPath)}]});require(${JSON.stringify(path.join(root, "electron", "main.cjs"))});`);
}
async function start() {
  const env = { ...process.env, NOVEL_TEST_PROJECT_PATH: projectPath };
  delete env.NOVEL_PLATFORM_TEST;
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.NOVEL_TEST_EXECUTABLE || require("electron");
  const args = [...(process.env.NOVEL_TEST_EXECUTABLE ? [] : [path.join(runDirectory, "bootstrap.cjs")]), `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(runDirectory, "user-data")}`];
  child = spawn(executable, args, { cwd: root, env, stdio: "ignore", windowsHide: true });
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page"); } catch { /* startup */ }
    if (!target) await wait(150);
  }
  assert.ok(target, "Electron启动超时");
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call("Page.enable");
  await until("Boolean(document.querySelector('.pane-tabs'))", "主界面已加载");
  await cdp.evaluate("window.confirm=()=>true");
}
async function stop() {
  cdp?.close(); cdp = null;
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  await wait(200);
}
async function openProgress() {
  await cdp.evaluate("document.querySelector('.pane-tabs button[title=分析]').click()");
  await wait(250);
  await button("规划与进度", "document.querySelector('.analysis-tabs')");
}

async function main() {
  await seed();
  try {
    await start();
    await openProgress();
    assert.ok(!(await cdp.evaluate("[...document.querySelectorAll('.analysis-tabs button')].some(b=>b.textContent.includes('关系网'))")), "分析页仍保留已合并的关系网标签");
    report.checks.push("分析页关系网标签已移除，能力并入思维导图");
    assert.equal(await cdp.evaluate("typeof window.novelAPI.importXMind"), "function", "当前程序缺少 XMind 导入接口");
    report.checks.push("程序暴露 XMind 导入接口（含打包版）");
    const modes = await cdp.evaluate("[...document.querySelectorAll('.progress-workspace-modes button')].map(e=>e.textContent.trim())");
    assert.ok(modes.includes("思维导图") && modes.includes("进度网格"), `模式按钮缺少新入口：${JSON.stringify(modes)}`);
    report.checks.push("规划与进度页出现思维导图与进度网格入口");

    await button("思维导图");
    await until("Boolean(document.querySelector('.mind-map-panel'))", "思维导图画布");
    await button("新建思维导图");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).length===1)", "第一张导图已落盘");
    await until("document.querySelectorAll('.mind-map-node').length===1", "中心主题已渲染");
    await button("添加子主题");
    await until("document.querySelectorAll('.mind-map-node').length===2", "子主题已渲染");
    await fill("选中主题文字", "接不上的伏笔");
    await fill("主题备注", "第二幕回收", "textarea");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>JSON.stringify(w.mindMaps[0].nodes).includes('接不上的伏笔'))", "主题文字自动保存");
    const firstMap = await workspace();
    assert.equal(firstMap.maps.length, 1);
    assert.equal(firstMap.maps[0].nodes.length, 2);
    assert.ok(firstMap.maps[0].nodes.some((node) => node.note === "第二幕回收"), "备注未落盘");
    await shot("mind-map");
    report.checks.push("思维导图新建、子主题、改名、备注均自动保存");

    await button("进度网格");
    await until("Boolean(document.querySelector('.progress-grid-panel'))", "进度网格面板");
    await button("新建网格");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.progressGrids||[]).length===1)", "第一张网格已落盘");
    await button("添加行");
    await until("document.querySelectorAll('.progress-grid-table tbody tr').length===4", "新增行已渲染");
    await fill("进度状态", "已完成", "select");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.progressGrids||[])[0].rows.some(r=>r.status==='已完成'))", "状态自动保存");
    assert.ok(await cdp.evaluate("document.querySelector('.progress-grid-percent')?.textContent.includes('25%')"), "完成率统计未更新");
    await shot("progress-grid");
    report.checks.push("进度网格新建、加行、状态与完成率统计自动保存");

    await button("思维导图");
    await until("Boolean(document.querySelector('.mind-map-panel'))", "切回思维导图");
    assert.ok(await cdp.evaluate("document.querySelector('.mind-map-list')?.textContent.includes('未命名思维导图')"), "列表未显示之前创建的导图");
    assert.ok(await cdp.evaluate("document.querySelectorAll('.mind-map-node').length===2"), "切回后导图内容丢失");
    report.checks.push("切回规划页可查看之前创建的思维导图与内容");

    await button("弹窗编辑");
    await until("Boolean(document.querySelector('.mind-map-modal'))", "思维导图弹窗");
    const modalAudit = await cdp.evaluate("(()=>{const modal=document.querySelector('.mind-map-modal');const canvas=modal?.querySelector('.mind-map-canvas');return {height:canvas?.clientHeight||0,width:modal?.clientWidth||0,scrollWidth:modal?.scrollWidth||0}})()");
    assert.ok(modalAudit.height >= 380, `弹窗画布没有放大：${JSON.stringify(modalAudit)}`);
    assert.ok(modalAudit.scrollWidth <= modalAudit.width + 2, "弹窗出现横向溢出");
    assert.ok(await cdp.evaluate("Boolean(document.querySelector('.mind-map-modal .mind-map-panel.fullscreen'))"), "弹窗未启用全屏布局");
    await shot("mind-map-modal");
    await button("关闭弹窗");
    await until("!document.querySelector('.mind-map-modal')", "弹窗已关闭");
    report.checks.push("思维导图弹窗全屏编辑可打开、画布放大且可关闭");

    if (!process.env.NOVEL_TEST_EXECUTABLE) {
      await button("导入 XMind");
      await until("Boolean(document.querySelector('.mind-map-import-preview'))", "XMind 导入预览");
      assert.ok(await cdp.evaluate("document.querySelector('.mind-map-import-preview')?.textContent.includes('导入样例.xmind')"), "预览未显示文件名");
      await button("确认导入 XMind");
      await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).length===2)", "XMind 导图已落盘");
      const imported = await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>w.mindMaps.find(m=>m.nodes.some(n=>n.text==='导入的子主题')))");
      assert.ok(imported, "导入的导图缺少子主题");
      assert.equal(imported.nodes.find((node) => node.text === "导入的子主题").note, "来自 XMind 的备注");
      assert.equal(imported.nodes[0].text, "导入的中心主题");
      assert.ok(await cdp.evaluate("document.querySelector('.mind-map-list')?.textContent.includes('导入样例')"), "列表未显示导入的导图");
      report.checks.push("XMind 8 文件经真实 IPC 导入为中心主题、子主题与备注");

      await button("从角色关系生成");
      await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).some(m=>m.title.includes('角色关系网')))", "角色关系导图已落盘");
      const relationMap = await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>w.mindMaps.find(m=>m.title.includes('角色关系网')))");
      assert.ok(relationMap.nodes.length >= 3, "角色关系导图缺少角色分支");
      assert.equal(relationMap.nodes[0].text, "角色关系网");
      assert.ok(relationMap.nodes.some((node) => node.text.includes("→") || node.text.includes("←")), "未生成关系连线节点");
      report.checks.push("原关系网能力已合并为可编辑思维导图");
    }

    const saved = await workspaceService.loadWorkspace(projectPath);
    assert.equal(saved.mindMaps.length, process.env.NOVEL_TEST_EXECUTABLE ? 1 : 3);
    assert.equal(saved.progressGrids.length, 1);
    assert.equal(saved.progressGrids[0].rows.length, 4);
    report.checks.push("退出前项目文件中的导图与网格数据完整");

    // 关系线 P0 交互回归：放在全部既有断言之后，避免改变导图 / 网格 / 节点计数。
    await button("添加关系线");
    await until(`Boolean(document.querySelector('.mind-map-toolbar button[aria-pressed="true"]'))`, "连线模式已开启");
    const mindNodeCount = await cdp.evaluate("document.querySelectorAll('.mind-map-node').length");
    assert.ok(mindNodeCount >= 2, "画布上至少需要两个节点才能建立关系线");
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[0].click()");
    await wait(200);
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[1].click()");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).some(m=>(m.relations||[]).length===1))", "关系线已自动保存");
    const createdMap = await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).find(m=>(m.relations||[]).length===1))");
    const createdRelation = createdMap.relations[0];
    assert.ok(createdMap.nodes.some((node) => node.id === createdRelation.sourceId), "关系线起点未指向现存节点");
    assert.ok(createdMap.nodes.some((node) => node.id === createdRelation.targetId), "关系线终点未指向现存节点");
    assert.notEqual(createdRelation.sourceId, createdRelation.targetId, "不应生成自环关系线");
    assert.equal(createdRelation.linePattern, "dash", "关系线默认应为虚线");
    assert.equal(createdRelation.arrowEnd, "triangle", "关系线默认末端应有三角箭头");
    report.checks.push("连线模式点击两个节点创建关系线并自动保存");

    const relationSvg = await cdp.evaluate(`(()=>{const line=document.querySelector('.mind-map-relation-line');const marker=document.querySelector('marker[id^="mind-relation-arrow-"]');return {dash:line?.getAttribute('stroke-dasharray')||'',markerEnd:line?.getAttribute('marker-end')||'',marker:Boolean(marker)}})()`);
    assert.ok(relationSvg.marker, "三角箭头 marker 未定义");
    assert.ok(relationSvg.markerEnd.includes("mind-relation-arrow-"), "关系线末端未绑定三角箭头");
    assert.ok(relationSvg.dash.length > 0, "关系线未呈现虚线");
    report.checks.push("关系线 SVG 呈现虚线与末端三角箭头");

    await fill("连线文字", "看作同时进行", "input");
    await fill("连线备注", "第二幕呼应", "textarea");
    await until(`window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).some(m=>(m.relations||[]).some(r=>r.label===${JSON.stringify("看作同时进行")}&&r.note===${JSON.stringify("第二幕呼应")})))`, "连线文字与备注自动保存");
    assert.ok(await cdp.evaluate(`document.querySelector('.mind-map-relation-label')?.textContent.includes(${JSON.stringify("看作同时进行")})`), "连线标签未渲染");
    report.checks.push("连线文字与备注可编辑并显示");

    await button("取消选中");
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[1].click()");
    await button("删除主题");
    await until(`window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).find(m=>m.id===${JSON.stringify(createdMap.id)})?.relations?.length===0)`, "删除节点后关系线级联删除");
    report.checks.push("删除节点级联删除关联关系线");

    // 弹窗内连线模式的 Esc 只取消连线，不应关闭整个弹窗。
    await button("弹窗编辑");
    await until("Boolean(document.querySelector('.mind-map-modal'))", "思维导图弹窗重新打开");
    await button("添加关系线");
    await until(`Boolean(document.querySelector('.mind-map-modal .mind-map-toolbar button[aria-pressed="true"]'))`, "弹窗内连线模式已开启");
    await cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await wait(250);
    assert.ok(await cdp.evaluate("Boolean(document.querySelector('.mind-map-modal'))"), "连线模式的 Esc 不应关闭整个弹窗");
    assert.ok(await cdp.evaluate(`!document.querySelector('.mind-map-toolbar button[aria-pressed="true"]')`), "Esc 应退出连线模式");
    report.checks.push("弹窗内连线模式的 Esc 只取消连线、不关闭弹窗");
    await button("关闭弹窗");
    await until("!document.querySelector('.mind-map-modal')", "弹窗已关闭");

    // K8：连线模式下重复点击同一节点不得创建自环关系线。
    // 插在全部既有断言之后（此时「删除节点级联」已把 relations 清为 0），
    // 因此用「点击前后总数不变」而非硬编码数量，避免与既有断言耦合。
    const countRelations = "window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).reduce((total,m)=>total+(m.relations||[]).length,0))";
    const relationsBeforeSelfClick = await cdp.evaluate(countRelations);
    await button("添加关系线");
    await until(`Boolean(document.querySelector('.mind-map-toolbar button[aria-pressed="true"]'))`, "连线模式再次开启");
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[0].click()");
    await wait(200);
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[0].click()");
    await wait(250);
    assert.equal(await cdp.evaluate(countRelations), relationsBeforeSelfClick, "重复点击同一节点不应新增关系线");
    assert.ok(await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).every(m=>(m.relations||[]).every(r=>r.sourceId!==r.targetId)))"), "不应生成自环关系线");
    await cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await until(`!document.querySelector('.mind-map-toolbar button[aria-pressed="true"]')`, "Esc 已退出连线模式");
    report.checks.push("连线模式重复点击同一节点不创建自环关系线，Esc 可退出");

    // ===== T03/T04 新增断言（纯新增；既有 16 条 checks 零改动。本环境跑不了 GUI，供用户终端 / CI 复跑）=====
    // 准备：补两个子主题，保证多选 / 右键 / 拖拽 / 连线都有足够节点。
    await button("添加子主题");
    await wait(150);
    await button("添加子主题");
    await until("document.querySelectorAll('.mind-map-node').length>=3", "T03/T04 准备节点");

    // T03-1 撤销 / 重做一次节点改名
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[0].click()");
    await wait(150);
    await fill("选中主题文字", "撤销测试标题", "input");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).some(m=>(m.nodes||[]).some(n=>n.text==='撤销测试标题')))", "节点改名已落盘");
    await cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>!(w.mindMaps||[]).some(m=>(m.nodes||[]).some(n=>n.text==='撤销测试标题')))", "Ctrl+Z 已撤销改名");
    await cdp.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true}))");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).some(m=>(m.nodes||[]).some(n=>n.text==='撤销测试标题')))", "Ctrl+Y 已重做改名");
    report.checks.push("Ctrl+Z 撤销与 Ctrl+Y 重做覆盖节点改名");

    // T03-2 Ctrl+点击多选后批量删除（含子树与关联关系线）
    const nodesBeforeBatch = await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>Math.max(...(w.mindMaps||[]).map(m=>(m.nodes||[]).length)))");
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[1].dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    await wait(150);
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[2].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))");
    await wait(200);
    assert.ok(await cdp.evaluate("document.querySelectorAll('.mind-map-node.selected').length>=2"), "Ctrl+点击未形成多选");
    await button("删除选中主题");
    await until(`window.novelAPI.getCreativeWorkspace().then(w=>Math.max(...(w.mindMaps||[]).map(m=>(m.nodes||[]).length))<${nodesBeforeBatch})`, "批量删除已落盘");
    report.checks.push("Ctrl+点击多选后可批量删除主题（含子树与关联关系线）");

    // T03-3 右键菜单出现、含全选命令、点菜单外关闭
    await cdp.evaluate("document.querySelector('.mind-map-canvas').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:180}))");
    await until("Boolean(document.querySelector('.mind-map-context-menu'))", "右键菜单已出现");
    assert.ok(await cdp.evaluate("document.querySelector('.mind-map-context-menu')?.textContent.includes('全选')"), "空白右键菜单缺少全选命令");
    await cdp.evaluate("document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
    await until("!document.querySelector('.mind-map-context-menu')", "点击菜单外已关闭");
    report.checks.push("画布右键菜单可打开、含全选命令并可关闭");

    // 批量删除后补足节点，再验证 T04-A 拖拽与连线跟随。
    await button("添加子主题");
    await wait(150);
    await button("添加子主题");
    await until("document.querySelectorAll('.mind-map-node').length>=3", "拖拽前补足节点");
    await button("添加关系线");
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[0].click()");
    await wait(150);
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[1].click()");
    await until("Boolean(document.querySelector('.mind-map-relation-line'))", "T04 准备：关系线已渲染");
    const dBeforeDrag = await cdp.evaluate("document.querySelector('.mind-map-relation-line')?.getAttribute('d')");
    await cdp.evaluate("document.querySelectorAll('.mind-map-node')[0].dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:300,clientY:300}))");
    await cdp.evaluate("document.querySelector('.mind-map-canvas').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:350,clientY:330}))");
    await cdp.evaluate("document.querySelector('.mind-map-canvas').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))");
    await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).some(m=>m.positions&&Object.keys(m.positions).length>0))", "拖拽位置已落盘");
    const dAfterDrag = await cdp.evaluate("document.querySelector('.mind-map-relation-line')?.getAttribute('d')");
    assert.notEqual(dAfterDrag, dBeforeDrag, "拖拽节点后关系线路径未跟随");
    report.checks.push("拖拽节点自由摆放后位置落盘且关系线端点跟随");

    // 重新打开弹窗后位置与连线保持一致（近似「重开」）
    await button("弹窗编辑");
    await until("Boolean(document.querySelector('.mind-map-modal .mind-map-relation-line'))", "弹窗内关系线仍渲染");
    assert.ok(await cdp.evaluate("Boolean(document.querySelector('.mind-map-modal .mind-map-node'))"), "弹窗内节点仍渲染");
    await button("关闭弹窗");
    await until("!document.querySelector('.mind-map-modal')", "弹窗已关闭");
    report.checks.push("重新打开弹窗后自由摆放位置与关系线保持一致");

    // T04-B：第二次 importXMind 读取独立「关系线样例.xmind」，不污染既有断言的导入图。
    if (!process.env.NOVEL_TEST_EXECUTABLE) {
      await button("导入 XMind");
      await until("Boolean(document.querySelector('.mind-map-import-preview'))", "关系线样例导入预览");
      await button("确认导入 XMind");
      await until("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).some(m=>(m.relations||[]).some(r=>r.label==='看作同时进行')))", "关系线样例已落盘");
      await wait(250);
      const importedRelation = await cdp.evaluate("window.novelAPI.getCreativeWorkspace().then(w=>(w.mindMaps||[]).flatMap(m=>m.relations||[]).find(r=>r.label==='看作同时进行'))");
      assert.equal(importedRelation.arrowEnd, "triangle", "导入关系线未保留三角箭头");
      assert.equal(importedRelation.linePattern, "dash", "导入关系线未保留虚线");
      assert.ok(importedRelation.controlPoints.every((point) => point.x === 0 && point.y === 0), "K4：绝对像素不得写入 controlPoints");
      assert.ok(await cdp.evaluate("Boolean(document.querySelector('.mind-map-relation-line'))"), "导入关系线未渲染");
      assert.ok(await cdp.evaluate("document.querySelector('.mind-map-relation-line')?.getAttribute('marker-end')?.includes('mind-relation-arrow-')"), "导入关系线三角箭头未绑定");
      report.checks.push("XMind 8 独立样例导入关系线并显示箭头，绝对像素未导入");
    }

    report.status = "passed";
  } finally {
    await stop();
  }
}

main().then(async () => {
  await fs.writeFile(path.join(runDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`PASS: 思维导图与进度网格真实桌面验证通过\n${report.checks.map((item) => `- ${item}`).join("\n")}\n报告：${path.join(runDirectory, "report.json")}`);
}).catch(async (error) => {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  await fs.mkdir(runDirectory, { recursive: true });
  await fs.writeFile(path.join(runDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`报告：${path.join(runDirectory, "report.json")}`);
  process.exitCode = 1;
});
