const ts = require("typescript");

// Use the JSX tree: braces and inline callbacks are not HTML text.
function extractButtonElements(source) {
  const tree = ts.createSourceFile("audit.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const items = [];
  function textInfo(node) {
    if (ts.isJsxText(node)) return { text: node.text.trim(), dynamic: false };
    if (ts.isJsxExpression(node)) {
      const expr = node.expression;
      if (!expr) return { text: "", dynamic: false };
      if (ts.isStringLiteral(expr)) return { text: expr.text, dynamic: false };
      if (ts.isConditionalExpression(expr)) {
        const a = expr.whenTrue, b = expr.whenFalse;
        if (ts.isStringLiteral(a) && ts.isStringLiteral(b)) return { text: "", dynamic: Boolean(a.text.trim() && b.text.trim()) };
        return { text: "", dynamic: false };
      }
      return { text: "", dynamic: ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr) || ts.isTemplateExpression(expr) };
    }
    if (ts.isJsxElement(node)) {
      const children = node.children.map(textInfo);
      return { text: children.map((item) => item.text).filter(Boolean).join(" "), dynamic: children.some((item) => item.dynamic) };
    }
    return { text: "", dynamic: false };
  }
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "button") {
      const opening = node.openingElement;
      const texts = node.children.map(textInfo);
      const staticText = texts.map((item) => item.text).filter(Boolean).join(" ");
      const aria = opening.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(tree) === "aria-label");
      const ariaText = aria?.initializer && ts.isStringLiteral(aria.initializer) ? aria.initializer.text.trim() : "";
      const dynamicAria = Boolean(aria?.initializer && ts.isJsxExpression(aria.initializer));
      let parent = node.parent;
      while (parent && !(ts.isJsxElement(parent) && parent.openingElement.tagName.getText(tree) === "form")) parent = parent.parent;
      items.push({ tag: opening.getText(tree), body: source.slice(opening.end, node.closingElement.pos), index: opening.getStart(tree), line: tree.getLineAndCharacterOfPosition(opening.getStart(tree)).line + 1,
        label: ariaText || staticText, dynamicLabel: dynamicAria || texts.some((item) => item.dynamic), insideForm: Boolean(parent) });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return items;
}
module.exports = { extractButtonElements };
