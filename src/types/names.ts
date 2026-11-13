// 起名助手（P90）渲染层契约类型。
export interface NameGenResult {
  type: string;
  style: string;
  seed: string;
  names: string[];
}