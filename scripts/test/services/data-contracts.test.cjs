// These are direct service/IPC contract tests with synthetic projects, not desktop UI runs.
// Reuse their fault-injection fixtures through the services entry point instead of duplicating assertions.
require("../../test-safety-regression.cjs");
require("../../test-plan-regression.cjs");
require("../../test-novel-network.cjs");
