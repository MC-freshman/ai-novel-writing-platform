const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { connectCdp } = require("./lib/cdp-client.cjs");
process.env.NOVEL_PLATFORM_TEST = "1";
const platform = require("../electron/main.cjs");
const workspace = path.resolve(__dirname, "..");
const directory = path.join(workspace, ".test-runs", "store-ui-" + new Date().toISOString().replace(/[:.]/g, "-"));
const project = path.join(directory, "project");
const secondProject = path.join(directory, "second-project");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { status: "running", syntheticLocalServer: true, checks: [] };
let requests = 0, child, cdp, mainCdp;
const server = http.createServer((request, response) => {
  request.resume(); requests++;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const token = (text) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  if (requests > 1) { token("第二次完整回答"); response.end("data: [DONE]\n\n"); return; }
  token("合成片段1");
  let count = 1;
  const timer = setInterval(() => { token("合成片段" + ++count); if (count >= 30) { clearInterval(timer); response.end("data: [DONE]\n\n"); } }, 80);
  response.on("close", () => clearInterval(timer));
});
async function until(expression) {
  for (let attempt = 0; attempt < 150; attempt++) { if (await cdp.evaluate(expression)) return; await wait(100); }
  throw new Error("界面等待超时: " + expression);
}
async function send(text) {
  await cdp.evaluate(`(()=>{const input=document.querySelector('.chat-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(100);
  await cdp.evaluate("document.querySelector('.chat-input button').click()");
}
async function heldRequest(question, destination, failOld = false) {
  await send(question);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await mainCdp.evaluate(`Boolean(globalThis.__heldAsks[${JSON.stringify(question)}])`)) break;
    await wait(100);
  }
  assert.ok(await mainCdp.evaluate(`Boolean(globalThis.__heldAsks[${JSON.stringify(question)}])`), "延迟请求已进入主进程");
  await mainCdp.evaluate(`globalThis.__testElectron.dialog.showOpenDialog = async () => ({canceled:false,filePaths:[${JSON.stringify(destination)}]})`);
  await cdp.evaluate("document.querySelector('button[title=\"打开小说项目\"]').click()");
  await until(`document.body.textContent.includes(${JSON.stringify(destination === project ? "Zustand合成流式验收" : "Zustand第二个合成项目")}) && !document.querySelector('.chat-input button.stop')`);
  await wait(1200);
  const next = question + "新项目";
  await send(next);
  for (let attempt = 0; attempt < 100 && !(await mainCdp.evaluate(`Boolean(globalThis.__heldAsks[${JSON.stringify(next)}])`)); attempt++) await wait(100);
  assert.ok(await mainCdp.evaluate(`Boolean(globalThis.__heldAsks[${JSON.stringify(next)}])`));
  await mainCdp.evaluate(`globalThis.__heldAsks[${JSON.stringify(question)}].${failOld ? "reject(new Error('旧项目延迟错误'))" : "resolve({answer:'旧项目迟到成功内容',context:[]})"}`);
  await wait(400);
  assert.equal(await cdp.evaluate("document.querySelector('.messages').textContent.includes('旧项目迟到成功内容') || document.querySelector('.messages').textContent.includes('旧项目延迟错误')"), false);
  assert.equal(await cdp.evaluate("Boolean(document.querySelector('.chat-input button.stop'))"), true, "旧请求完成不得清除新请求运行状态");
  await mainCdp.evaluate(`globalThis.__heldAsks[${JSON.stringify(next)}].resolve({answer:'新项目独立回答',context:[]})`);
  await until("document.querySelector('.messages').textContent.includes('新项目独立回答') && !document.querySelector('.chat-input button.stop')");
}
async function main() {
  await fs.mkdir(directory, { recursive: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await platform.ensureProjectStructure(project, "Zustand合成流式验收");
  const config = await platform.loadConfig(project);
  config.agent.autoLocalAnalysis = false;
  config.api = { ...config.api, provider: "custom", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, chatModel: "synthetic-local", apiKey: "", useApiEmbedding: false };
  await platform.saveConfig(project, config);
  await platform.ensureProjectStructure(secondProject, "Zustand第二个合成项目");
  const secondConfig = await platform.loadConfig(secondProject);
  secondConfig.agent.autoLocalAnalysis = false;
  secondConfig.api = { ...config.api };
  await platform.saveConfig(secondProject, secondConfig);
  const port = 9900 + Math.floor(Math.random() * 80);
  const mainPort = port + 200;
  const env = { ...process.env, NOVEL_TEST_PROJECT_PATH: project };
  delete env.NOVEL_PLATFORM_TEST; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.NOVEL_TEST_EXECUTABLE || require("electron");
  child = spawn(executable, [...(process.env.NOVEL_TEST_EXECUTABLE ? [] : ["."]), `--remote-debugging-port=${port}`, `--inspect=127.0.0.1:${mainPort}`, `--user-data-dir=${path.join(directory, "user-data")}`], { cwd: workspace, env, stdio: "ignore", windowsHide: true });
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())).find((item) => item.type === "page"); } catch { /* startup */ }
    if (!target) await wait(100);
  }
  assert.ok(target, "Electron启动超时");
  cdp = connectCdp(target.webSocketDebuggerUrl); await cdp.ready;
  await until("Boolean(document.querySelector('.chat-input textarea'))");
  await wait(1200);
  await send("合成测试：生成可取消回答");
  await until("document.querySelector('.messages')?.textContent.includes('合成片段1')");
  await cdp.evaluate("document.querySelector('.chat-input button.stop').click()");
  await until("!document.querySelector('.chat-input button.stop')");
  assert.match(await cdp.evaluate("document.querySelector('.messages').textContent"), /合成片段1[\s\S]*已保留/);
  report.checks.push("实际Electron流式追加、取消、部分内容保留");
  await send("合成测试：第二次请求");
  await until("document.querySelector('.messages')?.textContent.includes('第二次完整回答') && !document.querySelector('.chat-input button.stop')");
  assert.equal(requests, 2);
  report.checks.push("取消之后能继续新会话请求，旧内容保留");
  const mainTarget = (await fetch(`http://127.0.0.1:${mainPort}/json/list`).then((response) => response.json()))[0];
  assert.ok(mainTarget?.webSocketDebuggerUrl, "隔离测试主进程调试连接可用");
  mainCdp = connectCdp(mainTarget.webSocketDebuggerUrl); await mainCdp.ready;
  // Delay only the synthetic IPC response; project selection still runs the real
  // project:open handler. No test hooks or dialog overrides enter production code.
  await mainCdp.evaluate(`(() => {globalThis.__testElectron=process.getBuiltinModule('module').createRequire(process.execPath)('electron');const ipc=globalThis.__testElectron.ipcMain;const original=ipc._invokeHandlers.get('ai:ask');globalThis.__heldAsks={};ipc.removeHandler('ai:ask');ipc.handle('ai:ask',(event,payload)=>payload.question.startsWith('隔离竞态')?new Promise((resolve,reject)=>{globalThis.__heldAsks[payload.question]={resolve,reject}}):original(event,payload));return true;})()`);
  await heldRequest("隔离竞态旧成功", secondProject);
  await heldRequest("隔离竞态旧失败", project, true);
  report.checks.push("实际切换两个合成项目：旧成功/失败回包不污染新会话，不清除新请求运行状态（IPC延迟注入）");
  await mainCdp.evaluate(`(() => {const ipc=globalThis.__testElectron.ipcMain;const original=ipc._invokeHandlers.get('chapter:save');globalThis.__saveCalls=0;ipc.removeHandler('chapter:save');ipc.handle('chapter:save',async(event,payload)=>{const first=++globalThis.__saveCalls===1;const result=await original(event,payload);if(first)return new Promise(resolve=>{globalThis.__heldSave=()=>resolve(result)});return result;});return true;})()`);
  await cdp.evaluate("document.querySelector('.save-action').click()");
  for (let attempt = 0; attempt < 100 && !(await mainCdp.evaluate("Boolean(globalThis.__heldSave)")); attempt++) await wait(100);
  assert.ok(await mainCdp.evaluate("Boolean(globalThis.__heldSave)"));
  await until("document.querySelector('.save-state').textContent.includes('保存中')");
  await mainCdp.evaluate(`globalThis.__testElectron.dialog.showOpenDialog = async () => ({canceled:false,filePaths:[${JSON.stringify(secondProject)}]})`);
  await cdp.evaluate("document.querySelector('button[title=\"打开小说项目\"]').click()");
  await until("document.body.textContent.includes('Zustand第二个合成项目') && document.querySelector('.save-state').textContent==='已保存'");
  await cdp.evaluate("document.querySelector('.save-action').click()");
  await until("document.querySelector('.save-state').textContent==='已保存'");
  assert.equal(await mainCdp.evaluate("globalThis.__saveCalls"), 2, "新项目保存不得被旧项目的等待回包阻塞");
  await mainCdp.evaluate("globalThis.__heldSave()");
  await wait(300);
  assert.equal(await cdp.evaluate("document.querySelector('.save-state').textContent"), "已保存");
  report.checks.push("旧项目保存已落盘但回包延迟：新项目独立保存可用，旧回包不改变新项目状态");
  const tree = await cdp.call("Accessibility.getFullAXTree");
  const unnamed = tree.nodes.filter((node) => !node.ignored && node.role?.value === "button" && !String(node.name?.value || "").trim());
  assert.deepEqual(unnamed, []);
  report.checks.push("当前写作和对话界面的实际AX树按钮均有名称");
  report.status = "pass";
}
main().catch((error) => { report.status = "fail"; report.error = error.message; process.exitCode = 1; }).finally(async () => {
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, "store-ui-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, directory }, null, 2));
  await cdp?.call("Browser.close").catch(() => null); cdp?.close(); child?.kill();
  mainCdp?.close();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
});
