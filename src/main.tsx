import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { builtinMindMapModule } from "./modules/mindmap/builtin";
import { registerMindMapModule } from "./modules/mindmap/registry";
import "./styles.css";
import "./styles/plan-usability.css";
import "./styles/serene-writing.css";

if (import.meta.env.VITE_DISABLE_MINDMAP_MODULE !== "1") {
  registerMindMapModule(builtinMindMapModule);
  if (window.novelModules) {
    window.novelModules.registerBuiltinMindMapModule = () => registerMindMapModule(builtinMindMapModule);
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
