const path = require("node:path");
const mammothRoot = path.dirname(require.resolve("mammoth"));
const { DOMParser } = require(require.resolve("@xmldom/xmldom", { paths: [mammothRoot] }));
const xmlAdapter = require("mammoth/lib/xml/xmldom");

// Mammoth 1.12 omits the required MIME type and uses a deprecated error hook
// with xmldom 0.9 (upstream issue #478). Adapt only its XML entry point;
// keep the installed parser and reject malformed XML before conversion.
xmlAdapter.parseFromString = (xml) => {
  let failure;
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") failure = new Error(`Word XML ${level}: ${message}`);
    },
  });
  const document = parser.parseFromString(xml, "application/xml");
  if (failure) throw failure;
  return document;
};

module.exports = require("mammoth");
