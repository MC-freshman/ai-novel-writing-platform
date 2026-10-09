import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "release/**", "node_modules/**", ".test-runs/**", "发布包/**", "小说1材料/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["electron/**/*.cjs", "scripts/**/*.cjs", "shared/**/*.cjs"],
    languageOptions: { globals: globals.node },
    rules: {
      // 这些文件就是 CommonJS，require 是正常写法。
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    rules: {
      // 存量代码先以警告为主，避免一次性大改 2.7 万行；真正的问题规则保持 error。
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "no-control-regex": "warn",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/no-this-alias": "warn",
    },
  },
);
