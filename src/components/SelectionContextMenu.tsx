import { Boxes, MessageSquarePlus, Save, Sparkles, Wand2 } from "lucide-react";

const TEXT_ACTIONS = ["改写", "润色", "扩写", "总结"] as const;

export function SelectionContextMenu({
  menu,
  onAsk,
  onEdit,
  onExtractWorld,
  onOpenWorkspace,
}: {
  menu: { x: number; y: number; text: string };
  onAsk: (text: string) => void;
  onEdit: (action: (typeof TEXT_ACTIONS)[number], text: string) => void;
  onExtractWorld: (text: string) => void;
  onOpenWorkspace: (tab: "revisions" | "annotations", text: string) => void;
}) {
  return (
    <div
      className="context-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="context-menu-note">{menu.text.length} 字</div>
      <button onClick={() => onAsk(menu.text)}>
        <Wand2 size={15} />向 AI 提问
      </button>
      {TEXT_ACTIONS.map((action) => (
        <button key={action} onClick={() => onEdit(action, menu.text)}>
          <Sparkles size={15} />
          {action}
        </button>
      ))}
      <button onClick={() => onExtractWorld(menu.text)}>
        <Boxes size={15} />
        提取设定
      </button>
      <button onClick={() => onOpenWorkspace("revisions", menu.text)}>
        <Save size={15} />
        生成安全修订
      </button>
      <button onClick={() => onOpenWorkspace("annotations", menu.text)}>
        <MessageSquarePlus size={15} />
        添加批注
      </button>
    </div>
  );
}
