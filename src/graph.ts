// 引用关系图的纯逻辑：扫描依赖清单、人工边、上游路径枚举、路径键
export type Dep = { id: number; name: string; version: string; license: string; source: string; note: string };
export type Edge = { id: string; kind: 'scan' | 'manual'; from: number; ver: string; to: number };
export type Trail = { nodes: number[]; edges: Edge[] };
export type Verdict = 'replace' | 'isolate' | 'approve';
export type Decision = { v: Verdict; note: string; at: number };

// 各版本的扫描依赖清单（模拟 lockfile 扫描结果）；换版本后按它重算上游路径
export type VersionMeta = { version: string; deps: string[]; license?: string };
export const MANIFEST: Record<string, VersionMeta[]> = {
  react: [
    {version: '18.3.1', deps: ['micromatch']},
    {version: '19.0.0', deps: ['micromatch', 'chart.js']},
  ],
  lodash: [{version: '4.17.21', deps: []}],
  'chart.js': [{version: '4.4.4', deps: ['dom-serializer']}],
  'highlight.js': [
    {version: '11.10.0', deps: ['legacy-parser']},
    {version: '11.9.0', deps: []},
  ],
  micromatch: [{version: '4.0.7', deps: ['brace-expansion', 'legacy-parser']}],
  'dom-serializer': [
    {version: '2.0.0', deps: ['entities', 'legacy-parser']},
    {version: '1.4.2', deps: ['entities']},
  ],
  'brace-expansion': [{version: '2.0.1', deps: []}],
  entities: [{version: '4.5.0', deps: []}],
  'legacy-parser': [
    {version: '2.1.0', deps: []},
    {version: '3.0.0', deps: [], license: 'MIT'},
  ],
};

export const isRiskLicense = (d: Dep) => d.license.startsWith('GPL') || d.license.startsWith('AGPL');
export const isWarnLicense = (d: Dep) => ['BSD-3-Clause', 'Apache-2.0', 'LGPL-3.0', 'MPL-2.0'].includes(d.license);

export type Graph = { edges: Edge[]; out: Map<number, Edge[]>; paths: Map<number, Trail[]>; keys: Map<string, number> };

export const trailKey = (t: Trail, child: number) =>
  t.edges.length ? t.edges.map(e => `${e.from}@${e.ver}>${e.to}`).join('‖') : `root:${child}`;

export function computeGraph(deps: Dep[], manual: Edge[]): Graph {
  const idByName = new Map<string, number>();
  deps.forEach(d => { if (!idByName.has(d.name)) idByName.set(d.name, d.id); });

  const edges: Edge[] = [];
  const seenKey = new Set<string>();
  const push = (e: Edge) => {
    const k = `${e.from}|${e.ver}|${e.to}`;
    if (seenKey.has(k)) return; // 扫描边与人工边重复时只保留扫描边
    seenKey.add(k);
    edges.push(e);
  };

  for (const d of deps) {
    const meta = MANIFEST[d.name]?.find(x => x.version === d.version);
    for (const childName of meta?.deps ?? []) {
      const to = idByName.get(childName);
      if (to != null) push({id: `s|${d.id}|${d.version}|${to}`, kind: 'scan', from: d.id, ver: d.version, to});
    }
  }
  for (const m of manual) {
    const parent = deps.find(d => d.id === m.from);
    // 人工边绑定父包版本：父包换版本后旧边立即失效
    if (parent && parent.version === m.ver && deps.some(d => d.id === m.to) && m.from !== m.to) push(m);
  }

  const out = new Map<number, Edge[]>();
  const incoming = new Set<number>();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
    incoming.add(e.to);
  }
  const roots = deps.filter(d => !incoming.has(d.id)).map(d => d.id);

  const paths = new Map<number, Trail[]>();
  const keys = new Map<string, number>();
  for (const target of deps) {
    const found: Trail[] = [];
    const dfs = (cur: number, nodes: number[], es: Edge[], visited: Set<number>) => {
      if (cur === target.id) {
        found.push({nodes: [...nodes], edges: [...es]});
        return;
      }
      for (const e of out.get(cur) ?? []) {
        if (visited.has(e.to)) continue;
        visited.add(e.to);
        nodes.push(e.to);
        es.push(e);
        dfs(e.to, nodes, es, visited);
        nodes.pop();
        es.pop();
      }
    };
    for (const r of roots) dfs(r, [r], [], new Set([r]));
    paths.set(target.id, found);
    for (const t of found) keys.set(trailKey(t, target.id), target.id);
  }
  return {edges, out, paths, keys};
}

// 统计每个风险包的路径总数 / 待处理路径数（按路径键分别记账）
export function pathStats(deps: Dep[], graph: Graph, decisions: Record<string, Decision>) {
  const m = new Map<number, { total: number; pending: number }>();
  for (const d of deps) {
    const trails = graph.paths.get(d.id) ?? [];
    const pending = isRiskLicense(d) ? trails.filter(t => !decisions[trailKey(t, d.id)]).length : 0;
    m.set(d.id, {total: trails.length, pending});
  }
  return m;
}
