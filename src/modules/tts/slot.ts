// TTS 模块槽声明（P84）：朗读校对。内置引擎=系统语音（Web Speech API）；
// 替换路径见模块替换指南（构建期替换/外部引擎经本地 HTTP 适配列二期）。
import { declareModuleSlot } from "../core/registry";

declareModuleSlot({
  id: "tts",
  label: "朗读校对",
  description: "编辑器朗读当前章节（系统语音，离线）；停用后入口隐藏，不影响正文。",
  toggleLabel: "启用朗读校对模块",
});