"use strict";

const { ipcMain } = require("electron");
const { assertTrustedSender, validateIpcArguments } = require("../services/ipc-security.cjs");
const { log } = require("../services/logger.cjs");
const { state } = require("../services/runtime-state.cjs");
const { verifyIpcContract } = require("../services/ipc-contract.cjs");
const { channelsRequiringHandler } = require("../../shared/contracts/ipc-channels.cjs");

module.exports = {
  assertTrustedSender,
  channelsRequiringHandler,
  ipcMain,
  log,
  state,
  validateIpcArguments,
  verifyIpcContract,
};
