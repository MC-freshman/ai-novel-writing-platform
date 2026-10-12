module.exports = async function* coverageReporter(source) {
  for await (const event of source)
    if (event.type === "test:coverage")
      yield JSON.stringify(event.data.summary) + "\n";
};
