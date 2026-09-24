import {computeGraph, isRiskLicense, pathStats, trailKey} from './src/graph.js';
import type {Decision, Dep, Edge} from './src/graph.js';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
};

const deps: Dep[] = [
  {id: 1, name: 'react', version: '18.3.1', license: 'MIT', source: 'npm', note: ''},
  {id: 2, name: 'lodash', version: '4.17.21', license: 'MIT', source: 'npm', note: ''},
  {id: 3, name: 'chart.js', version: '4.4.4', license: 'MIT', source: 'npm', note: ''},
  {id: 4, name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause', source: 'npm', note: ''},
  {id: 5, name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', source: 'npm', note: ''},
  {id: 6, name: 'micromatch', version: '4.0.7', license: 'MIT', source: 'npm', note: ''},
  {id: 7, name: 'dom-serializer', version: '2.0.0', license: 'MIT', source: 'npm', note: ''},
  {id: 8, name: 'brace-expansion', version: '2.0.1', license: 'MIT', source: 'npm', note: ''},
  {id: 9, name: 'entities', version: '4.5.0', license: 'BSD-3-Clause', source: 'npm', note: ''},
];
const seedManual: Edge[] = [{id: 'm|seed-1', kind: 'manual', from: 2, ver: '4.17.21', to: 5}];
const byId = new Map(deps.map(d => [d.id, d]));
const chainStr = (t: { nodes: number[] }, child: number) =>
  ['项目', ...t.nodes.map(n => byId.get(n)!.name)].join(' → ');

console.log('1. 点开 GPL 包能看到所有上游路径，最上层标明直接引入者');
let graph = computeGraph(deps, seedManual);
let lp = graph.paths.get(5)!;
assert(lp.length === 4, `legacy-parser 有 4 条路径，实际 ${lp.length}`);
console.log(lp.map(t => '     ' + chainStr(t, 5)).join('\n'));
const directParents = lp.map(t => t.edges[t.edges.length - 1]?.from ?? null).sort();
assert(JSON.stringify(directParents) === JSON.stringify([2, 4, 6, 7].sort()), '四条路径的直接引入者分别是 lodash / highlight.js / micromatch / dom-serializer');
assert(lp.some(t => t.edges.some(e => e.kind === 'manual')), 'lodash 路径含人工补充边');

console.log('2. 同一包多条路径分别保留处理结论：处理一条不能让其他路径消失');
const keys = lp.map(t => trailKey(t, 5));
assert(new Set(keys).size === 4, '四条路径生成四个不同的路径键');
const decisions: Record<string, Decision> = {[keys[0]]: {v: 'replace', note: '升级 lodash 分支', at: 1}};
let stats = pathStats(deps, graph, decisions);
assert(stats.get(5)!.pending === 3, `处置 1 条后还剩 3 条待处理，实际 ${stats.get(5)!.pending}`);
assert(graph.paths.get(5)!.length === 4, '处置一条后另外三条路径仍在（不消失）');
decisions[keys[1]] = {v: 'isolate', note: '进程隔离', at: 2};
decisions[keys[2]] = {v: 'approve', note: '法务批准', at: 3};
decisions[keys[3]] = {v: 'replace', note: '换用 prism', at: 4};
stats = pathStats(deps, graph, decisions);
assert(stats.get(5)!.pending === 0, '四条全部处置后，该包待处理数为 0');
const totalPending = deps.reduce((s, d) => s + stats.get(d.id)!.pending, 0);
assert(totalPending === 0, `全部处理完风险计数归零，实际 ${totalPending}`);

console.log('3. 父包换版本：旧路径失效、按新版本重算');
// highlight.js 11.10.0 → 11.9.0：不再依赖 legacy-parser，该路径消失
let nextDeps = deps.map(d => d.id === 4 ? {...d, version: '11.9.0'} : d);
let nextGraph = computeGraph(nextDeps, seedManual);
const expiredViaHighlight = !nextGraph.paths.get(5)!.some(t => t.nodes.includes(4));
assert(expiredViaHighlight, 'highlight.js 降级后，经它的旧路径消失');
// 注意：highlight.js 直接依赖 legacy-parser，初始图里它本身是根 → 路径 项目→highlight.js→legacy-parser
assert(graph.paths.get(5)!.some(t => t.nodes.includes(4)), '切换前该路径确实存在');

console.log('4. 人工边绑定父包版本：父包版本变化后人工路径失效');
// 给 lodash 制造一个"新版本"场景：手动改 deps 版本（manifest 无此版本 → 无扫描边）
nextDeps = deps.map(d => d.id === 2 ? {...d, version: '5.0.0'} : d);
nextGraph = computeGraph(nextDeps, seedManual);
assert(!nextGraph.edges.some(e => e.id === 'm|seed-1'), '旧版本上的人工边不再活动');
assert(!nextGraph.paths.get(5)!.some(t => t.nodes.includes(2)), '经 lodash 的人工路径失效');

console.log('5. 换 dom-serializer 2.0.0→1.4.2：旧路径键消失，旧结论随之失效，按新版本重算');
graph = computeGraph(deps, seedManual);
lp = graph.paths.get(5)!;
const domTrail = lp.find(t => t.edges[t.edges.length - 1].from === 7)!;
const domKey = trailKey(domTrail, 5);
nextDeps = deps.map(d => d.id === 7 ? {...d, version: '1.4.2'} : d);
nextGraph = computeGraph(nextDeps, seedManual);
assert(!nextGraph.keys.has(domKey), '旧路径键在新图中不存在（结论剪枝依据）');
const stillOthers = nextGraph.paths.get(5)!;
assert(stillOthers.length === 3, `另三条路径仍保留，实际 ${stillOthers.length} 条`);
assert(stillOthers.some(t => t.edges[t.edges.length - 1].ver === '4.17.21') && stillOthers.some(t => t.edges.some(e => e.from === 6)), 'lodash / highlight.js / micromatch 路径不受影响');

console.log('6. legacy-parser 升级到 3.0.0(MIT)：许可证覆盖，风险消失');
nextDeps = deps.map(d => d.id === 5 ? {...d, version: '3.0.0', license: 'MIT'} : d);
nextGraph = computeGraph(nextDeps, seedManual);
const lp3 = nextDeps.find(d => d.id === 5)!;
assert(!isRiskLicense(lp3), '新版本 MIT 不再是风险许可证');
stats = pathStats(nextDeps, nextGraph, {});
const totalPending2 = nextDeps.reduce((s, d) => s + stats.get(d.id)!.pending, 0);
assert(totalPending2 === 0, '风险计数归零');

console.log('7. 删除人工边后对应路径消失（剪枝同样靠 keys 比对）');
nextGraph = computeGraph(deps, []);
assert(nextGraph.paths.get(5)!.length === 3, `删除人工边后剩 3 条扫描路径，实际 ${nextGraph.paths.get(5)!.length}`);

console.log('8. 人工边与扫描边重复时去重，不产生虚假路径');
const dup: Edge[] = [...seedManual, {id: 'm|dup', kind: 'manual', from: 4, ver: '11.10.0', to: 5}];
nextGraph = computeGraph(deps, dup);
assert(nextGraph.paths.get(5)!.length === 4, `重复边不新增路径，仍为 4 条，实际 ${nextGraph.paths.get(5)!.length}`);
assert(!nextGraph.edges.some(e => e.id === 'm|dup'), '重复人工边被扫描边合并');

console.log('9. 直接依赖无上游引入者时给出根路径');
const reactTrails = graph.paths.get(1)!;
assert(reactTrails.length === 1 && reactTrails[0].nodes.join() === '1', 'react 是直接依赖：根路径只有自身');
assert(trailKey(reactTrails[0], 1) === 'root:1', '根路径键稳定');

declare const process: { exit(code: number): void };
if (failures) { console.error(`\n${failures} 个断言失败`); process.exit(1); }
console.log('\n全部通过');
