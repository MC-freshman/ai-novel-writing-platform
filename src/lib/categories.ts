export const DEFAULT_CATEGORY_LABEL = "未分类";
export function normalizeCategoryLabel(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, 40) || DEFAULT_CATEGORY_LABEL;
}

export type CategoryGroup<T> = {
  key: string;
  category: string;
  items: T[];
  children: Array<CategoryGroup<T>>;
  count: number;
};

export function splitCategoryPath(value?: string) {
  const category = normalizeCategoryLabel(value);
  const segments = category
    .split(/[\\/|｜>＞]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return segments.length ? segments : [DEFAULT_CATEGORY_LABEL];
}

export function sortCategoryGroups<T extends { name?: string; title?: string }>(groups: Array<CategoryGroup<T>>) {
  groups.sort((a, b) => {
    if (a.category === DEFAULT_CATEGORY_LABEL && b.category !== DEFAULT_CATEGORY_LABEL) return 1;
    if (b.category === DEFAULT_CATEGORY_LABEL && a.category !== DEFAULT_CATEGORY_LABEL) return -1;
    return a.category.localeCompare(b.category, "zh-CN");
  });
  groups.forEach((group) => {
    group.items.sort((a, b) => (a.name || a.title || "").localeCompare(b.name || b.title || "", "zh-CN"));
    sortCategoryGroups(group.children);
    group.count = group.items.length + group.children.reduce((sum, child) => sum + child.count, 0);
  });
}

export function groupByCategory<T extends { category?: string; name?: string; title?: string }>(items: T[]) {
  const roots: Array<CategoryGroup<T>> = [];
  items.forEach((item) => {
    const segments = splitCategoryPath(item.category);
    let siblings = roots;
    let current: CategoryGroup<T> | null = null;
    const pathParts: string[] = [];
    for (const segment of segments) {
      pathParts.push(segment);
      const key = pathParts.join("/");
      let group = siblings.find((candidate) => candidate.key === key);
      if (!group) {
        group = { key, category: segment, items: [], children: [], count: 0 };
        siblings.push(group);
      }
      current = group;
      siblings = group.children;
    }
    if (current) current.items.push(item);
  });
  sortCategoryGroups(roots);
  return roots;
}
