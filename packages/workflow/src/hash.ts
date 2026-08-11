/**
 * 内容哈希 —— contentHash 只覆盖**执行语义**。
 *
 * 给人看的元数据（description / tags / owner / 节点 label）不参与哈希，
 * 因为它们不影响"一个用户会走哪条路"：
 * - 改一句描述不该让在途用户 pin 的版本失效；
 * - 也不该在 plan 里报出一条"有变更"的噪音。
 *
 * 与之相对，**存储永远存完整 IR**（含最新描述）。contentHash 只承担两个
 * 职责：判定语义是否变化（plan / 迁移），以及给在途实例 pin 版本。所以
 * 改描述后：UI 立刻显示新描述、plan 显示无变更、在途用户不受影响。
 */

/**
 * 不参与哈希的键。
 * - meta：workflow 级元数据（description / tags / owner）
 * - label：节点名与分支臂名（UI 标题 / 观测定位，不改变执行路径）
 * - contentHash：哈希自身
 *
 * 注意 cohort 臂的 `name` **参与**哈希：它进节点 id（`{id}.{armName}.{j}`），
 * 而节点 id 就是 durable step 名——改它会改变执行身份。
 */
const UNHASHED_KEYS = new Set(['meta', 'label', 'contentHash']);

/** 递归剥离元数据字段，得到纯执行语义的结构。 */
export function stripMeta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMeta);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (UNHASHED_KEYS.has(key)) continue;
      out[key] = stripMeta(item);
    }
    return out;
  }
  return value;
}

/** canonical JSON：键排序、无空白——哈希的稳定输入。 */
export function canonicalJSON(value: unknown): string {
  // JSON.stringify(undefined) 返回 undefined 而非字符串；缺省字段统一记作 null
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJSON((value as Record<string, unknown>)[key])}`
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 稳定内容哈希。当前为 FNV-1a 64（同步、零依赖）；生产可换 SHA-256 截断。 */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** 执行语义的内容哈希（剥元数据 → canonical JSON → FNV-1a 64）。 */
export function semanticHash(value: unknown): string {
  return fnv1a64(canonicalJSON(stripMeta(value)));
}

/** 完整内容的 canonical 形式——用于区分"语义没变、只改了元数据"。 */
export function fullHash(value: unknown): string {
  return fnv1a64(canonicalJSON(value));
}
