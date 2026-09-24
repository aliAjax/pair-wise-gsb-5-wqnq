import {Fragment, useEffect, useMemo, useState} from 'react';
import {AlertTriangle, ArrowRight, Check, ChevronDown, Download, FileCode2, GitBranch, Info, Layers3, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, X} from 'lucide-react';
import {computeGraph, isRiskLicense, isWarnLicense, MANIFEST, pathStats, trailKey} from './graph';
import type {Decision, Dep, Edge, Graph, Trail, Verdict} from './graph';

type Status = 'ok' | 'warn' | 'risk' | 'cleared';
type Notice = { depId: number; oldVer: string; newVer: string; expired: number; decided: number; added: number; manual: number };

const initialDeps: Dep[] = [
  {id: 1, name: 'react', version: '18.3.1', license: 'MIT', source: 'npm', note: '宽松许可，可商用'},
  {id: 2, name: 'lodash', version: '4.17.21', license: 'MIT', source: 'npm', note: '宽松许可，可商用'},
  {id: 3, name: 'chart.js', version: '4.4.4', license: 'MIT', source: 'npm', note: '宽松许可，可商用'},
  {id: 4, name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause', source: 'npm', note: '再发布需保留版权声明'},
  {id: 5, name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', source: 'npm', note: '可能与闭源分发冲突'},
  {id: 6, name: 'micromatch', version: '4.0.7', license: 'MIT', source: 'npm', note: '传递依赖'},
  {id: 7, name: 'dom-serializer', version: '2.0.0', license: 'MIT', source: 'npm', note: '传递依赖'},
  {id: 8, name: 'brace-expansion', version: '2.0.1', license: 'MIT', source: 'npm', note: '传递依赖'},
  {id: 9, name: 'entities', version: '4.5.0', license: 'BSD-3-Clause', source: 'npm', note: '传递依赖'},
];
// 人工补充的引用关系：lodash 旧版本锁文件外的依赖，扫描器没扫到
const seedManual: Edge[] = [{id: 'm|seed-1', kind: 'manual', from: 2, ver: '4.17.21', to: 5}];

const colors: Record<string, string> = {MIT: '#35b995', 'BSD-3-Clause': '#6d9ee8', 'GPL-3.0': '#ec8c75', 'Apache-2.0': '#b18ee4'};
const VERDICTS: { v: Verdict; label: string }[] = [
  {v: 'replace', label: '替换上游'},
  {v: 'isolate', label: '隔离使用'},
  {v: 'approve', label: '例外批准'},
];
const verdictLabel = (v: Verdict) => VERDICTS.find(x => x.v === v)!.label;
const STORE_KEY = 'license-lens-v2';

function loadState(): { deps: Dep[]; manual: Edge[]; decisions: Record<string, Decision> } {
  try {
    const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem('license-lens');
    if (raw) {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return {deps: j as Dep[], manual: seedManual, decisions: {}}; // 旧版本数据迁移
      if (j && j.v === 2 && Array.isArray(j.deps)) return {deps: j.deps, manual: j.manual ?? [], decisions: j.decisions ?? {}};
    }
  } catch { /* 损坏的缓存回退到初始数据 */ }
  return {deps: initialDeps, manual: seedManual, decisions: {}};
}

function PillChain({trail, target, depById, onRemoveEdge}: {
  trail: Trail; target: number; depById: Map<number, Dep>;
  onRemoveEdge?: (e: Edge) => void;
}) {
  return (
    <div className="chain">
      <span className="pill proj">项目</span>
      {trail.nodes.map((nid, i) => {
        const d = depById.get(nid)!;
        const e = trail.edges[i - 1];
        return (
          <Fragment key={i}>
            <span className="link">
              <ArrowRight size={12}/>
              {e?.kind === 'manual' && (
                <button className="hop manual" title="删除这条人工引用" onClick={() => onRemoveEdge?.(e)}>
                  人工 <Trash2 size={9}/>
                </button>
              )}
            </span>
            <span className={'pill' + (nid === target ? ' risk' : '')}>
              {d.name}<em>@{d.version}</em>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

export default function App() {
  const initial = useMemo(loadState, []);
  const [deps, setDeps] = useState<Dep[]>(initial.deps);
  const [manual, setManual] = useState<Edge[]>(initial.manual);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(initial.decisions);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('全部');
  const [selected, setSelected] = useState<number>(initial.deps[0]?.id ?? 0);
  const [showAdd, setShowAdd] = useState(false);
  const [showRef, setShowRef] = useState(false);
  const [cv, setCv] = useState<{ id: number; ver: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('MIT');
  const [refParent, setRefParent] = useState(0);
  const [refError, setRefError] = useState('');

  const graph = useMemo(() => computeGraph(deps, manual), [deps, manual]);
  const depById = useMemo(() => new Map(deps.map(d => [d.id, d])), [deps]);

  // 图变化（换版本 / 删人工边）后，失效路径上的处理结论一并清除——旧路径不能残留
  useEffect(() => {
    setDecisions(prev => {
      const next: Record<string, Decision> = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev)) {
        if (graph.keys.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [graph]);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({v: 2, deps, manual, decisions}));
  }, [deps, manual, decisions]);

  const info = useMemo(() => pathStats(deps, graph, decisions), [deps, graph, decisions]);

  const rowStatus = (d: Dep): Status => {
    if (isRiskLicense(d)) return (info.get(d.id)?.pending ?? 0) > 0 ? 'risk' : 'cleared';
    return isWarnLicense(d) ? 'warn' : 'ok';
  };

  const totalPending = deps.reduce((s, d) => s + (info.get(d.id)?.pending ?? 0), 0);
  const riskPkgCount = deps.filter(d => isRiskLicense(d) && (info.get(d.id)?.pending ?? 0) > 0).length;
  const riskPathCount = deps.filter(isRiskLicense).reduce((s, d) => s + (info.get(d.id)?.total ?? 0), 0);
  const warnCount = deps.filter(isWarnLicense).length;
  const safeCount = deps.length - riskPkgCount - warnCount;

  const current = deps.find(d => d.id === selected);
  const currentTrails = current ? graph.paths.get(current.id) ?? [] : [];

  const filtered = useMemo(() => deps.filter(d =>
    (filter === '全部' || rowStatus(d) === filter) &&
    `${d.name}${d.license}`.toLowerCase().includes(query.toLowerCase())
  ), [deps, filter, query, decisions, graph]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    if (!name.trim()) return;
    const id = Date.now();
    setDeps(ds => [...ds, {
      id, name: name.trim(), version: '1.0.0', license, source: '手动',
      note: license === 'MIT' ? '宽松许可，可商用' : '请核对分发义务',
    }]);
    setSelected(id);
    setName('');
    setShowAdd(false);
  };

  const setVerdict = (key: string, v: Verdict | null) => {
    setDecisions(prev => {
      const next = {...prev};
      if (v === null) delete next[key];
      else next[key] = {v, note: prev[key]?.note ?? '', at: Date.now()};
      return next;
    });
  };
  const setNote = (key: string, note: string) =>
    setDecisions(prev => prev[key] ? {...prev, [key]: {...prev[key], note}} : prev);

  const addManualEdge = () => {
    if (!current || !refParent) return;
    const parent = depById.get(refParent)!;
    const exists = graph.edges.some(e => e.from === parent.id && e.ver === parent.version && e.to === current.id);
    if (exists) {
      setRefError(`${parent.name}@${parent.version} 已经引用了 ${current.name}，无需重复补充`);
      return;
    }
    setManual(ms => [...ms, {id: `m|${Date.now()}`, kind: 'manual', from: parent.id, ver: parent.version, to: current.id}]);
    setShowRef(false);
    setRefError('');
  };

  const removeEdge = (e: Edge) => setManual(ms => ms.filter(x => x.id !== e.id));

  // 换版本预览：算出旧图/新图差异，确认后一次性应用
  const preview = useMemo(() => {
    if (!cv) return null;
    const targetMeta = MANIFEST[depById.get(cv.id)!.name]?.find(m => m.version === cv.ver);
    const nextDeps = deps.map(d => {
      if (d.id !== cv.id) return d;
      // 新版本可能改变许可证（如 legacy-parser 3.0.0 已换 MIT）
      return targetMeta?.license ? {...d, version: cv.ver, license: targetMeta.license, note: '新版本许可证已变化，请重新评估'} : {...d, version: cv.ver};
    });
    const nextManual = manual.filter(e => !(e.from === cv.id && e.ver !== cv.ver));
    const nextGraph = computeGraph(nextDeps, nextManual);
    const expired = [...graph.keys.keys()].filter(k => !nextGraph.keys.has(k));
    const added = [...nextGraph.keys.keys()].filter(k => !graph.keys.has(k));
    const trailOf = (g: Graph, key: string): { child: number; trail: Trail } | null => {
      const child = g.keys.get(key);
      if (child == null) return null;
      const trail = (g.paths.get(child) ?? []).find(t => trailKey(t, child) === key);
      return trail ? {child, trail} : null;
    };
    return {
      nextDeps, nextManual, nextGraph,
      manualDropped: manual.filter(e => e.from === cv.id && e.ver !== cv.ver).length,
      expired: expired.map(k => trailOf(graph, k)).filter(Boolean) as { child: number; trail: Trail }[],
      added: added.map(k => trailOf(nextGraph, k)).filter(Boolean) as { child: number; trail: Trail }[],
      decidedExpired: expired.filter(k => decisions[k]).length,
    };
  }, [cv, deps, manual, graph, decisions]);

  const applyVersion = () => {
    if (!cv || !preview) return;
    setDeps(preview.nextDeps);
    setManual(preview.nextManual);
    setNotice({
      depId: cv.id, oldVer: depById.get(cv.id)!.version, newVer: cv.ver,
      expired: preview.expired.length, decided: preview.decidedExpired,
      added: preview.added.length, manual: preview.manualDropped,
    });
    setCv(null);
  };

  const exportMd = () => {
    const lines = ['# License Lens', '', '| 依赖 | 版本 | 许可证 | 状态 |', '|---|---|---|---|'];
    for (const d of deps) {
      const st = rowStatus(d);
      lines.push(`| ${d.name} | ${d.version} | ${d.license} | ${st === 'ok' ? '安全' : st === 'warn' ? '复核' : st === 'risk' ? '高风险' : '已处置'} |`);
    }
    const risks = deps.filter(isRiskLicense);
    if (risks.length) {
      lines.push('', '## 高风险引入路径', '');
      for (const d of risks) {
        lines.push(`### ${d.name}@${d.version} (${d.license})`, '');
        for (const t of graph.paths.get(d.id) ?? []) {
          const chain = ['项目', ...t.nodes.map(n => depById.get(n)!.name)].join(' → ');
          const dec = decisions[trailKey(t, d.id)];
          lines.push(`- ${chain} — ${dec ? `已处理：${verdictLabel(dec.v)}${dec.note ? `（${dec.note}）` : ''}` : '**待处理**'}`);
        }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], {type: 'text/markdown'}));
    a.download = 'license-report.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const score = deps.length ? Math.round(deps.filter(d => rowStatus(d) === 'ok').length / deps.length * 100) : 100;

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon"><ShieldCheck size={18}/></div>
          <div><b>License Lens</b><small>dependency clarity</small></div>
        </div>
        <div className="nav-title">WORKSPACE</div>
        <button className="nav active"><Layers3 size={16}/>依赖总览</button>
        <button className="nav"><FileCode2 size={16}/>许可证清单 <span>{deps.length}</span></button>
        <button className="nav"><AlertTriangle size={16}/>待处理风险 <span className="red">{totalPending}</span></button>
        <div className="aside-bottom">
          <div className="mini-card">
            <Sparkles size={16}/>
            <div><b>引用来源已接入</b><small>每条 GPL 路径都可独立处置</small></div>
          </div>
          <div className="user"><div className="avatar">ZL</div><span>Zen Li</span><ChevronDown size={14}/></div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">WORKSPACE / <b>PROJECT SCAN</b></div>
            <h1>许可证兼容性分析</h1>
            <p>检查依赖许可与其上游来源，放心发布你的项目。</p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={exportMd}><Download size={15}/>导出报告</button>
            <button className="primary" onClick={() => setShowAdd(true)}><Plus size={16}/>添加依赖</button>
          </div>
        </header>

        <section className="hero">
          <div>
            <span className="tag">PROJECT · AURORA-WEB</span>
            <h2>发布前，看清每个风险是谁带进来的。</h2>
            <p>
              我们扫描了 <b>{deps.length} 个依赖</b>，存在 <b className="warning">{totalPending} 条待处理的高风险引入路径</b>
              （跨 {riskPkgCount} 个包，共 {riskPathCount} 条路径），另有 <b>{warnCount} 个包</b>需要保留声明。
            </p>
          </div>
          <div className="scan-score">
            <div className="score-ring"><strong>{score}<small>%</small></strong></div>
            <div><span>兼容评分</span><b>{totalPending ? '需处理' : '良好'}</b><small>全部路径处置完毕后归零</small></div>
          </div>
        </section>

        <section className="summary">
          <div><span>全部依赖</span><b>{deps.length}</b><small>含传递依赖</small></div>
          <div><span>安全许可</span><b className="teal">{safeCount}</b><small>可直接分发</small></div>
          <div><span>需要复核</span><b className="orange">{warnCount}</b><small>保留声明即可</small></div>
          <div><span>待处理风险路径</span><b className="red">{totalPending}</b><small>跨 {riskPkgCount} 个包 · 全部处置才归零</small></div>
        </section>

        <section className="workspace">
          <div className="table-pane">
            <div className="pane-head">
              <div><h2>依赖清单</h2><p>点开任一包，查看全部上游引用路径</p></div>
              <div className="tools">
                <div className="search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索依赖"/></div>
                <select value={filter} onChange={e => setFilter(e.target.value)}>
                  <option value="全部">全部状态</option>
                  <option value="ok">安全</option>
                  <option value="warn">复核</option>
                  <option value="risk">高风险</option>
                  <option value="cleared">已处置</option>
                </select>
              </div>
            </div>
            <div className="table">
              <div className="tr th"><span>依赖名称</span><span>版本</span><span>许可证</span><span>状态</span></div>
              {filtered.map(d => {
                const st = rowStatus(d);
                const inf = info.get(d.id)!;
                return (
                  <button className={d.id === selected ? 'tr selected' : 'tr'} key={d.id} onClick={() => setSelected(d.id)}>
                    <span className="dep-name">
                      <span className="pkg-dot"/> {d.name}
                      {isRiskLicense(d) && (
                        <small className="dep-sub">
                          {inf.pending ? `${inf.pending}/${inf.total} 条路径待处理` : `${inf.total} 条路径均已处置`}
                        </small>
                      )}
                    </span>
                    <span className="muted">{d.version}</span>
                    <span><i className="license" style={{color: colors[d.license] || '#888', background: (colors[d.license] || '#888') + '18'}}>{d.license}</i></span>
                    <span className={'status ' + st}>
                      {st === 'risk' ? <AlertTriangle size={13}/> : <Check size={13}/>}
                      {st === 'ok' ? '安全' : st === 'warn' ? '复核' : st === 'risk' ? '高风险' : '已处置'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {current && (
            <div className="detail">
              <div className="detail-head">
                <div className="detail-icon" style={{background: (colors[current.license] || '#888') + '1c', color: colors[current.license]}}><FileCode2 size={20}/></div>
                <div><span>SELECTED DEPENDENCY</span><h2>{current.name}</h2></div>
                <button className="close" onClick={() => setSelected(0)}><X size={16}/></button>
              </div>

              <div className="detail-grid">
                <div>
                  <label>版本</label>
                  {MANIFEST[current.name] && MANIFEST[current.name].length > 1 ? (
                    <select className="version-select" value={current.version} onChange={e => setCv({id: current.id, ver: e.target.value})}>
                      {MANIFEST[current.name].map(m => <option key={m.version} value={m.version}>{m.version}{m.version === current.version ? '（当前）' : ''}</option>)}
                    </select>
                  ) : <b>{current.version}</b>}
                </div>
                <div><label>来源</label><b>{current.source}</b></div>
                <div><label>许可证</label><b>{current.license}</b></div>
              </div>

              {notice && notice.depId === current.id && (
                <div className="banner">
                  <RotateCcw size={14}/>
                  <div>
                    <b>版本已从 {notice.oldVer} 切换到 {notice.newVer}</b>
                    <p>
                      {notice.expired} 条旧路径已失效并按新版本重算（新增 {notice.added} 条
                      {notice.manual ? `，移除 ${notice.manual} 条绑定旧版本的人工引用` : ''}）
                      {notice.decided ? `，其中 ${notice.decided} 条路径上的处理结论随旧路径一并失效。` : '。'}
                    </p>
                  </div>
                  <button onClick={() => setNotice(null)}><X size={13}/></button>
                </div>
              )}

              <div className={'finding ' + (rowStatus(current) === 'cleared' ? 'ok' : rowStatus(current))}>
                <div className="finding-icon">{rowStatus(current) === 'risk' ? <AlertTriangle size={16}/> : <Check size={16}/>}</div>
                <div>
                  <b>
                    {isRiskLicense(current)
                      ? (info.get(current.id)!.pending
                        ? `存在分发限制：${info.get(current.id)!.pending}/${info.get(current.id)!.total} 条引入路径待处理`
                        : `${info.get(current.id)!.total} 条引入路径均已处置`)
                      : isWarnLicense(current) ? '需要保留声明' : '可以放心使用'}
                  </b>
                  <p>{current.note}。处置结论按引用路径分别保留，处理一条不会影响其他路径。</p>
                </div>
              </div>

              <div className="sources">
                <div className="sources-head">
                  <div><GitBranch size={14}/><b>引用来源</b><span>{currentTrails.length} 条上游路径</span></div>
                  <button className="mini-btn" onClick={() => { setRefParent(deps.find(d => d.id !== current.id)?.id ?? 0); setRefError(''); setShowRef(true); }}>
                    <Plus size={12}/>人工补充
                  </button>
                </div>

                {currentTrails.length === 0 && (
                  <p className="src-empty">当前没有任何活动路径引用该包；若它来自私有源或锁文件之外，可人工补充引用关系。</p>
                )}

                {currentTrails.map(trail => {
                  const key = trailKey(trail, current.id);
                  const dec = decisions[key];
                  const parentEdge = trail.edges[trail.edges.length - 1];
                  const parent = parentEdge ? depById.get(parentEdge.from)! : null;
                  const manualHops = trail.edges.filter(e => e.kind === 'manual').length;
                  return (
                    <div key={key} className={'path-card' + (dec ? ' done' : '')}>
                      <div className="path-top">
                        {parent ? (
                          <span><GitBranch size={11}/> 最上层直接引入：<b>{parent.name}@{parent.version}</b>
                            {parentEdge.kind === 'manual' && <i className="tag-manual">人工补充</i>}
                          </span>
                        ) : <span><GitBranch size={11}/> 项目直接依赖，无上游引入者</span>}
                        {manualHops > 0 && <i className="tag-manual ghost">含 {manualHops} 条人工引用</i>}
                      </div>
                      <PillChain trail={trail} target={current.id} depById={depById} onRemoveEdge={removeEdge}/>
                      {isRiskLicense(current) ? (
                        <div className="verdict">
                          <div className="verdict-row">
                            {dec
                              ? <span className="chip done"><Check size={11}/> 已处理 · {verdictLabel(dec.v)}</span>
                              : <span className="chip todo"><AlertTriangle size={11}/> 该路径待处理</span>}
                            <div className="vbtns">
                              {VERDICTS.map(opt => (
                                <button key={opt.v} className={dec?.v === opt.v ? 'active' : ''}
                                  onClick={() => setVerdict(key, dec?.v === opt.v ? null : opt.v)}>
                                  {opt.label}
                                </button>
                              ))}
                              {dec && <button className="undo" title="撤销处理结论" onClick={() => setVerdict(key, null)}><RotateCcw size={12}/></button>}
                            </div>
                          </div>
                          <input className="note-input" placeholder="处理备注，例如：已升级到 3.0.0 的 MIT 分支，下个迭代移除"
                            value={dec?.note ?? ''} disabled={!dec}
                            onChange={e => setNote(key, e.target.value)}/>
                        </div>
                      ) : (
                        <div className="verdict"><span className="chip safe"><Check size={11}/> 许可证合规路径，无需处置</span></div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="full-license">
                <div><Info size={15}/><span>许可证摘要</span></div>
                <p>{current.license} 允许在满足其条款的前提下使用和分发代码。GPL 类许可证的义务沿上述每条引用路径分别传导，请逐条确认处置结论。详细义务请参考项目仓库中的 LICENSE 文件。</p>
                <button>查看原文 <ChevronDown size={14}/></button>
              </div>
            </div>
          )}
        </section>
      </main>

      {showAdd && (
        <div className="backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>添加依赖</h2><button onClick={() => setShowAdd(false)}>×</button></div>
            <label>依赖名称<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="例如 date-fns"/></label>
            <label>许可证
              <select value={license} onChange={e => setLicense(e.target.value)}>
                <option>MIT</option><option>BSD-3-Clause</option><option>Apache-2.0</option><option>GPL-3.0</option>
              </select>
            </label>
            <button className="primary full" onClick={add}>加入扫描</button>
          </div>
        </div>
      )}

      {showRef && current && (
        <div className="backdrop" onClick={() => setShowRef(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>人工补充引用关系</h2><button onClick={() => setShowRef(false)}>×</button></div>
            <p className="modal-tip">扫描器可能漏掉私有源或锁文件之外的依赖。指定一个父包，它将作为新的上游路径引入 <b>{current.name}</b>，引用绑定父包当前版本。</p>
            <label>父包（直接引入 {current.name} 的包）
              <select value={refParent} onChange={e => { setRefParent(Number(e.target.value)); setRefError(''); }}>
                <option value={0}>请选择父包</option>
                {deps.filter(d => d.id !== current.id).map(d => <option key={d.id} value={d.id}>{d.name}@{d.version}</option>)}
              </select>
            </label>
            <label>被引用包<b className="readonly-pill">{current.name}@{current.version}</b></label>
            {refError && <p className="form-error">{refError}</p>}
            <button className="primary full" onClick={addManualEdge}>补充引用路径</button>
          </div>
        </div>
      )}

      {cv && preview && (
        <div className="backdrop" onClick={() => setCv(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>切换 {depById.get(cv.id)!.name} 版本：{depById.get(cv.id)!.version} → {cv.ver}</h2><button onClick={() => setCv(null)}>×</button></div>
            <p className="modal-tip">父包换版本后，绑定旧版本的引用路径（含人工补充）将全部失效，并按新版本的依赖清单重新计算；旧路径上的处理结论不会保留。</p>
            <div className="diff-grid">
              <div className="diff-col expire">
                <b>将失效的旧路径 · {preview.expired.length}</b>
                <div className="diff-list">
                  {preview.expired.length === 0 && <small>无</small>}
                  {preview.expired.map((x, i) => (
                    <PillChain key={i} trail={x.trail} target={x.child} depById={depById}/>
                  ))}
                </div>
                {preview.decidedExpired > 0 && <small className="form-error">其中 {preview.decidedExpired} 条已有处理结论，将随路径失效</small>}
                {preview.manualDropped > 0 && <small className="form-error">将移除 {preview.manualDropped} 条绑定旧版本的人工引用</small>}
              </div>
              <div className="diff-col add">
                <b>新版本将出现的路径 · {preview.added.length}</b>
                <div className="diff-list">
                  {preview.added.length === 0 && <small>无新增路径</small>}
                  {preview.added.map((x, i) => {
                    const nextById = new Map(preview.nextDeps.map(d => [d.id, d]));
                    return <PillChain key={i} trail={x.trail} target={x.child} depById={nextById}/>;
                  })}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="outline" onClick={() => setCv(null)}>取消</button>
              <button className="primary" onClick={applyVersion}>确认切换并重算</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
