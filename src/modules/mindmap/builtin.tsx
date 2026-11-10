import { MindMaps } from "../../components/MindMaps";
import { MIND_MAP_CONTRACT_VERSION, type MindMapModule } from "./contract";

export const builtinMindMapModule: MindMapModule = {
  descriptor: {
    id: "builtin.mindmap",
    name: "内置思维导图",
    contractVersion: MIND_MAP_CONTRACT_VERSION,
    capabilities: [
      "tree-edit",
      "relations",
      "notes",
      "layout",
      "xmind-import",
      "fullscreen",
    ],
  },
  Component: MindMaps,
};
