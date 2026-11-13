"use strict";
const { registerIpcHandler } = require("../register.cjs");
const { externalMcp } = require("../domain-dependencies/external-mcp.cjs");

function registerDomain() {
  registerIpcHandler("mcp:get-status", async () => externalMcp.getIntegrationStatus());

  registerIpcHandler("mcp:pick-directory", async () => externalMcp.pickServerDirectory());

  registerIpcHandler("mcp:save-settings", async (_event, payload) => externalMcp.saveSettings(payload || {}));

  registerIpcHandler("mcp:build-config", async (_event, payload) => externalMcp.buildClientConfig(payload || {}));

  registerIpcHandler("mcp:self-test", async (_event, payload) => externalMcp.selfTest(payload || {}));
}

module.exports = { registerDomain };