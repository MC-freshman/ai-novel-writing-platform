const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
process.env.NOVEL_PLATFORM_TEST = "1";
const mock = new Module("service-electron-mock");
mock.exports = {
  app: { getVersion: () => "0.3.7", getPath: () => os.tmpdir(), whenReady: async () => {}, setName() {}, on() {} },
  dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }), showMessageBox: async () => ({ response: 0 }) },
  shell: { openPath: async () => "", openExternal: async () => {} },
  ipcMain: { handle() {}, on() {} }, BrowserWindow: class {}, Menu: { buildFromTemplate() {}, setApplicationMenu() {} },
};
require.cache[require.resolve("electron")] = mock;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-services-"));
  t.after(async () => {
    const relative = path.relative(path.resolve(os.tmpdir()), root);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
module.exports = { fixture, electron: mock.exports };
