import type { ComponentType } from "react";
import type { CreativeWorkspaceState, MindMap } from "../../types";
import type { PageSaveHandle, PageSaveKind } from "../../hooks/useEntityDraft";

export const MIND_MAP_CONTRACT_VERSION = 1;

export type MindMapCapability =
  | "tree-edit"
  | "relations"
  | "notes"
  | "layout"
  | "xmind-import"
  | "fullscreen";

export interface MindMapModuleDescriptor {
  id: string;
  name: string;
  contractVersion: number;
  capabilities: MindMapCapability[];
}

export interface MindMapModuleProps {
  workspace: CreativeWorkspaceState;
  onWorkspace: (value: CreativeWorkspaceState) => void;
  onRegisterSave: (kind: PageSaveKind, handle: PageSaveHandle | null) => void;
  onStatus: (message: string) => void;
  fullscreen: boolean;
  onRelationModeChange?: (active: boolean) => void;
}

export interface MindMapModule {
  descriptor: MindMapModuleDescriptor;
  Component: ComponentType<MindMapModuleProps>;
}

export const MIND_MAP_REQUIRED_CAPABILITIES: MindMapCapability[] = [
  "tree-edit",
  "relations",
  "notes",
  "layout",
  "xmind-import",
  "fullscreen",
];

export function missingCapabilities(
  descriptor: MindMapModuleDescriptor,
  required: MindMapCapability[],
): MindMapCapability[] {
  const available = new Set(descriptor.capabilities);
  return required.filter((capability) => !available.has(capability));
}

/** 返回空字符串表示可挂载；否则给出宿主可直接显示的拒绝原因。 */
export function describeMindMapModuleProblem(
  module: MindMapModule | null,
  required: MindMapCapability[] = MIND_MAP_REQUIRED_CAPABILITIES,
): string {
  if (!module) return "思维导图模块未安装，正文和其他规划功能不受影响。";
  if (module.descriptor.contractVersion !== MIND_MAP_CONTRACT_VERSION)
    return `思维导图模块契约版本不兼容（模块 ${module.descriptor.contractVersion} / 宿主 ${MIND_MAP_CONTRACT_VERSION}），正文和其他规划功能不受影响。`;
  const missing = missingCapabilities(module.descriptor, required);
  if (missing.length)
    return `思维导图模块缺少能力：${missing.join("、")}；正文和其他规划功能不受影响。`;
  return "";
}

export function isMindMapDocument(value: unknown): value is MindMap {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<MindMap>;
  return (
    typeof doc.id === "string" &&
    typeof doc.title === "string" &&
    typeof doc.rootId === "string" &&
    Array.isArray(doc.nodes) &&
    doc.nodes.every((node) => Boolean(node) && typeof node.id === "string")
  );
}
