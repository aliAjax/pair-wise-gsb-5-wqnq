import {Fragment,useEffect,useMemo,useState} from 'react';
import {AlertTriangle,Check,ChevronDown,ChevronRight,Download,FileCode2,GitBranch,Info,Layers3,Pencil,Plus,RotateCw,Search,ShieldCheck,Sparkles,Trash2,X} from 'lucide-react';

type Dep={id:number;name:string;version:string;license:string;source:string;status:'ok'|'warn'|'risk';note:string};
type PathNode={name:string;version:string};
type Conclusion=''|'replace'|'upgrade'|'keep'|'exempt';
// 一条引用路径：chain 从“直接引入它的包”开始逐级向下，最后一跳指向 targetId 对应的包
type DepPath={id:number;targetId:number;chain:PathNode[];conclusion:Conclusion;note:string;stale:boolean};

const initial:Dep[]=[
  {id:1,name:'react',version:'18.3.1',license:'MIT',source:'npm',status:'ok',note:'宽松许可，可商用'},
  {id:2,name:'lodash',version:'4.17.21',license:'MIT',source:'npm',status:'ok',note:'宽松许可，可商用'},
  {id:3,name:'chart.js',version:'4.4.4',license:'MIT',source:'npm',status:'ok',note:'宽松许可，可商用'},
  {id:4,name:'highlight.js',version:'11.10.0',license:'BSD-3-Clause',source:'npm',status:'warn',note:'再发布需保留版权声明'},
  {id:5,name:'legacy-parser',version:'2.1.0',license:'GPL-3.0',source:'手动',status:'risk',note:'可能与闭源分发冲突'},
  {id:6,name:'report-exporter',version:'3.2.1',license:'MIT',source:'npm',status:'ok',note:'报表导出组件'},
  {id:7,name:'ui-kit',version:'5.0.0',license:'MIT',source:'npm',status:'ok',note:'内部组件库'},
];

// 种子引用关系：同一个包可被多条路径引入，各自独立处理
const seedChains:Record<string,PathNode[][]>={
  'legacy-parser':[
    [{name:'report-exporter',version:'3.2.1'}],
    [{name:'ui-kit',version:'5.0.0'},{name:'table-render',version:'1.4.2'}],
  ],
  'highlight.js':[
    [{name:'report-exporter',version:'3.2.1'}],
  ],
};

const buildPaths=(deps:Dep[]):DepPath[]=>{
  let id=1;
  const out:DepPath[]=[];
  for(const d of deps){
    for(const chain of seedChains[d.name]??[])out.push({id:id++,targetId:d.id,chain,conclusion:'',note:'',stale:false});
    out.push({id:id++,targetId:d.id,chain:[],conclusion:'',note:'',stale:false});
  }
  return out;
};

const colors:Record<string,string>={MIT:'#35b995','BSD-3-Clause':'#6d9ee8','GPL-3.0':'#ec8c75','Apache-2.0':'#b18ee4'};
const conclusionLabels:Record<string,string>={replace:'替换依赖',upgrade:'升级版本',keep:'保留使用',exempt:'申请豁免'};
const isUnhandled=(p:DepPath)=>p.stale||!p.conclusion;

const load=<T,>(key:string,fallback:()=>T):T=>{
  try{
    const v=JSON.parse(localStorage.getItem(key)||'') as T|null;
    return v??fallback();
  }catch{
    return fallback();
  }
};

// 解析 “ui-kit@5.0.0 > table-render@1.4.2”；末尾若写成目标包本身则去掉
const parseChain=(text:string,targetName:string):PathNode[]=>{
  const nodes=text.split(/[>›→]/).map(s=>s.trim()).filter(Boolean).map(s=>{
    const i=s.lastIndexOf('@');
    return i>0?{name:s.slice(0,i).trim(),version:s.slice(i+1).trim()||'?'}:{name:s,version:'?'};
  });
  if(nodes.length&&nodes[nodes.length-1].name===targetName)nodes.pop();
  return nodes;
};

export default function App(){
  const [deps,setDeps]=useState<Dep[]>(()=>load('license-lens',()=>initial));
  const [paths,setPaths]=useState<DepPath[]>(()=>load('license-lens-paths',()=>buildPaths(deps)));
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('全部');
  const [selected,setSelected]=useState(1);
  const [showAdd,setShowAdd]=useState(false);
  const [name,setName]=useState('');
  const [version,setVersion]=useState('1.0.0');
  const [license,setLicense]=useState('MIT');
  const [verEdit,setVerEdit]=useState<{id:number;v:string}|null>(null);
  const [addPathFor,setAddPathFor]=useState<number|null>(null);
  const [chainText,setChainText]=useState('');

  const current=deps.find(d=>d.id===selected);

  useEffect(()=>localStorage.setItem('license-lens',JSON.stringify(deps)),[deps]);
  useEffect(()=>localStorage.setItem('license-lens-paths',JSON.stringify(paths)),[paths]);

  const filtered=useMemo(()=>deps.filter(d=>(filter==='全部'||d.status===filter)&&`${d.name}${d.license}`.toLowerCase().includes(query.toLowerCase())),[deps,filter,query]);

  const pathStats=useMemo(()=>{
    const m:Record<number,{total:number;unhandled:number}>={};
    for(const p of paths){
      const s=m[p.targetId]??(m[p.targetId]={total:0,unhandled:0});
      s.total++;
      if(isUnhandled(p))s.unhandled++;
    }
    return m;
  },[paths]);

  // 风险计数 = 高风险包未处理的引用路径数，全部处理完才归零
  const pendingRisk=useMemo(()=>deps.filter(d=>d.status==='risk').reduce((n,d)=>{
    const s=pathStats[d.id];
    return n+(s?s.unhandled:1);
  },0),[deps,pathStats]);

  const add=()=>{
    if(!name.trim())return;
    const id=Date.now();
    setDeps(ds=>[...ds,{id,name:name.trim(),version:version.trim()||'1.0.0',license,source:'手动',status:license.startsWith('GPL')?'risk':license==='MIT'?'ok':'warn',note:license==='MIT'?'宽松许可，可商用':'请核对分发义务'}]);
    setPaths(ps=>[...ps,{id:id+1,targetId:id,chain:[],conclusion:'',note:'',stale:false}]);
    setSelected(id);
    setName('');setVersion('1.0.0');setShowAdd(false);
  };

  // 父包换版本：所有经过该包旧版本的路径失效，等待按新版本重算
  const changeVersion=(id:number,v:string)=>{
    const dep=deps.find(d=>d.id===id);
    v=v.trim();
    setVerEdit(null);
    if(!dep||!v||dep.version===v)return;
    setDeps(ds=>ds.map(d=>d.id===id?{...d,version:v}:d));
    setPaths(ps=>ps.map(p=>p.chain.some(n=>n.name===dep.name&&n.version!==v)?{...p,stale:true}:p));
  };

  // 按当前版本重算失效路径：链路更新到新版本，结论清空需重新处理
  const recalc=(pid:number)=>setPaths(ps=>ps.map(p=>{
    if(p.id!==pid)return p;
    return{...p,stale:false,conclusion:'',chain:p.chain.map(n=>{
      const d=deps.find(x=>x.name===n.name);
      return d?{...n,version:d.version}:n;
    })};
  }));

  const setConclusion=(pid:number,conclusion:Conclusion)=>setPaths(ps=>ps.map(p=>p.id===pid?{...p,conclusion}:p));
  const setPathNote=(pid:number,note:string)=>setPaths(ps=>ps.map(p=>p.id===pid?{...p,note}:p));
  const removePath=(pid:number)=>setPaths(ps=>ps.filter(p=>p.id!==pid));

  const addPath=()=>{
    if(!current)return;
    const chain=parseChain(chainText,current.name);
    const stale=chain.some(n=>{const d=deps.find(x=>x.name===n.name);return!!d&&d.version!==n.version});
    setPaths(ps=>[...ps,{id:Date.now(),targetId:current.id,chain,conclusion:'',note:'',stale}]);
    setChainText('');setAddPathFor(null);
  };

  const exportMd=()=>{
    const body=deps.map(d=>{
      const ps=paths.filter(p=>p.targetId===d.id);
      const rows=ps.map((p,i)=>{
        const chain=p.chain.length?[...p.chain.map(n=>`${n.name}@${n.version}`),`${d.name}@${d.version}`].join(' → '):`项目直接引入 → ${d.name}@${d.version}`;
        const state=p.stale?'已失效，待重算':p.conclusion?`结论：${conclusionLabels[p.conclusion]}`:'待处理';
        return `  ${i+1}. ${chain}｜${state}${p.note?`｜备注：${p.note}`:''}`;
      }).join('\n');
      return `### ${d.name}@${d.version}（${d.license}）\n${rows||'  （暂无引用路径记录）'}`;
    }).join('\n\n');
    const text=`# License Lens 许可证报告\n\n待处理风险路径：${pendingRisk} 条\n\n${body}\n`;
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([text],{type:'text/markdown'}));
    a.download='license-report.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const curPaths=current?paths.filter(p=>p.targetId===current.id):[];
  const curUnhandled=curPaths.filter(isUnhandled).length;

  return <div className="shell">
    <aside>
      <div className="brand"><div className="brand-icon"><ShieldCheck size={18}/></div><div><b>License Lens</b><small>dependency clarity</small></div></div>
      <div className="nav-title">WORKSPACE</div>
      <button className="nav active"><Layers3 size={16}/>依赖总览</button>
      <button className="nav"><FileCode2 size={16}/>许可证清单 <span>{deps.length}</span></button>
      <button className="nav"><AlertTriangle size={16}/>待处理风险 <span className="red">{pendingRisk}</span></button>
      <div className="aside-bottom">
        <div className="mini-card"><Sparkles size={16}/><div><b>扫描已更新</b><small>刚刚完成 {deps.length} 个依赖的分析</small></div></div>
        <div className="user"><div className="avatar">ZL</div><span>Zen Li</span><ChevronDown size={14}/></div>
      </div>
    </aside>
    <main>
      <header>
        <div>
          <div className="crumb">WORKSPACE / <b>PROJECT SCAN</b></div>
          <h1>许可证兼容性分析</h1>
          <p>检查依赖许可，放心发布你的项目。</p>
        </div>
        <div className="head-actions">
          <button className="outline" onClick={exportMd}><Download size={15}/>导出报告</button>
          <button className="primary" onClick={()=>setShowAdd(true)}><Plus size={16}/>添加依赖</button>
        </div>
      </header>
      <section className="hero">
        <div>
          <span className="tag">PROJECT · AURORA-WEB</span>
          <h2>发布前，再确认一次。</h2>
          <p>我们扫描了 <b>{deps.length} 个依赖</b>，发现 <b className="warning">{deps.filter(d=>d.status!=='ok').length} 个项目</b>需要你的关注。</p>
        </div>
        <div className="scan-score">
          <div className="score-ring"><strong>{Math.round(deps.filter(d=>d.status==='ok').length/deps.length*100)}<small>%</small></strong></div>
          <div><span>兼容评分</span><b>良好</b><small>上次扫描 2 分钟前</small></div>
        </div>
      </section>
      <section className="summary">
        <div><span>全部依赖</span><b>{deps.length}</b><small>+2 本次新增</small></div>
        <div><span>安全许可</span><b className="teal">{deps.filter(d=>d.status==='ok').length}</b><small>可直接分发</small></div>
        <div><span>需要复核</span><b className="orange">{deps.filter(d=>d.status==='warn').length}</b><small>保留声明即可</small></div>
        <div><span>高风险</span><b className="red">{pendingRisk}</b><small>未处理路径，处理完归零</small></div>
      </section>
      <section className="workspace">
        <div className="table-pane">
          <div className="pane-head">
            <div><h2>依赖清单</h2><p>逐项查看许可证义务</p></div>
            <div className="tools">
              <div className="search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索依赖"/></div>
              <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="全部">全部状态</option><option value="ok">安全</option><option value="warn">复核</option><option value="risk">高风险</option></select>
            </div>
          </div>
          <div className="table">
            <div className="tr th"><span>依赖名称</span><span>版本</span><span>许可证</span><span>状态</span></div>
            {filtered.map(d=><button className={d.id===selected?'tr selected':'tr'} key={d.id} onClick={()=>setSelected(d.id)}>
              <span className="dep-name"><span className="pkg-dot"/> {d.name}
                {pathStats[d.id]&&<small className="p-count">{pathStats[d.id].total} 条来源{pathStats[d.id].unhandled>0&&d.status!=='ok'?` · ${pathStats[d.id].unhandled} 待处理`:''}</small>}
              </span>
              <span className="muted">{d.version}</span>
              <span><i className="license" style={{color:colors[d.license]||'#888',background:(colors[d.license]||'#888')+'18'}}>{d.license}</i></span>
              <span className={'status '+d.status}>{d.status==='ok'?<Check size={13}/>:<AlertTriangle size={13}/>} {d.status==='ok'?'安全':d.status==='warn'?'复核':'高风险'}</span>
            </button>)}
          </div>
        </div>
        {current&&<div className="detail">
          <div className="detail-head">
            <div className="detail-icon" style={{background:(colors[current.license]||'#888')+'1c',color:colors[current.license]}}><FileCode2 size={20}/></div>
            <div><span>SELECTED DEPENDENCY</span><h2>{current.name}</h2></div>
            <button className="close" onClick={()=>setSelected(0)}><X size={16}/></button>
          </div>
          <div className="detail-grid">
            <div>
              <label>版本</label>
              {verEdit?.id===current.id
                ?<input className="ver-input" autoFocus value={verEdit.v} onChange={e=>setVerEdit({id:current.id,v:e.target.value})} onBlur={()=>changeVersion(current.id,verEdit.v)} onKeyDown={e=>{if(e.key==='Enter')changeVersion(current.id,verEdit.v);if(e.key==='Escape')setVerEdit(null)}}/>
                :<b className="ver" title="点击修改版本；父包换版本后，经过它的旧路径会失效" onClick={()=>setVerEdit({id:current.id,v:current.version})}>{current.version} <Pencil size={11}/></b>}
            </div>
            <div><label>来源</label><b>{current.source}</b></div>
            <div><label>许可证</label><b>{current.license}</b></div>
          </div>
          <div className={'finding '+current.status}>
            <div className="finding-icon">{current.status==='ok'?<Check size={16}/>:<AlertTriangle size={16}/>}</div>
            <div><b>{current.status==='ok'?'可以放心使用':current.status==='warn'?'需要保留声明':'存在分发限制'}</b><p>{current.note}。扫描结果基于 package 元数据，请在发布前查看完整许可证文本。</p></div>
          </div>
          <div className="paths">
            <div className="paths-head">
              <div className="paths-title"><GitBranch size={14}/><b>引用来源</b><span>{curPaths.length} 条上游路径{curPaths.length>0&&(curUnhandled>0?` · ${curUnhandled} 条待处理`:' · 全部已处理')}</span></div>
              <button className="mini-btn" onClick={()=>{setAddPathFor(addPathFor===current.id?null:current.id);setChainText('')}}><Plus size={13}/>补充路径</button>
            </div>
            {addPathFor===current.id&&<div className="add-path">
              <input autoFocus value={chainText} onChange={e=>setChainText(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addPath()} placeholder="上游链，如 ui-kit@5.0.0 > table-render@1.4.2；留空表示项目直接引入"/>
              <button onClick={addPath}>添加</button>
            </div>}
            {curPaths.length===0&&<p className="paths-empty">暂无引用路径记录，可点击“补充路径”人工添加。</p>}
            {curPaths.map(p=><div className={p.stale?'path-card stale':'path-card'} key={p.id}>
              <div className="chain">
                {p.chain.length===0
                  ?<span className="node root"><em>直接引入</em>项目本体</span>
                  :p.chain.map((n,i)=>{
                    const d=deps.find(x=>x.name===n.name);
                    const changed=!!(p.stale&&d&&d.version!==n.version);
                    return <Fragment key={i}>
                      {i>0&&<ChevronRight size={12} className="arrow"/>}
                      <span className={i===0?'node root':'node'}>
                        {i===0&&<em>直接引入</em>}
                        {n.name}@{changed?<><s>{n.version}</s><i className="to">→ {d?.version}</i></>:n.version}
                      </span>
                    </Fragment>;
                  })}
                <ChevronRight size={12} className="arrow"/>
                <span className="node target">{current.name}@{current.version}</span>
              </div>
              <div className="path-foot">
                <span className={'p-badge '+(p.stale?'stale':p.conclusion?'done':'todo')}>{p.stale?'已失效':p.conclusion?`已处理 · ${conclusionLabels[p.conclusion]}`:'待处理'}</span>
                {p.stale
                  ?<button className="recalc" onClick={()=>recalc(p.id)}><RotateCw size={12}/>按新版本重算</button>
                  :<select value={p.conclusion} onChange={e=>setConclusion(p.id,e.target.value as Conclusion)}>
                    <option value="">选择处理结论…</option>
                    <option value="replace">替换依赖</option>
                    <option value="upgrade">升级版本</option>
                    <option value="keep">保留使用</option>
                    <option value="exempt">申请豁免</option>
                  </select>}
                <input className="p-note" value={p.note} placeholder="备注：处理人、原因…" onChange={e=>setPathNote(p.id,e.target.value)}/>
                <button className="p-del" title="删除该路径" onClick={()=>removePath(p.id)}><Trash2 size={13}/></button>
              </div>
            </div>)}
          </div>
          <div className="full-license">
            <div><Info size={15}/><span>许可证摘要</span></div>
            <p>{current.license} 允许在满足其条款的前提下使用和分发代码。详细义务请参考项目仓库中的 LICENSE 文件。</p>
            <button>查看原文 <ChevronDown size={14}/></button>
          </div>
        </div>}
      </section>
    </main>
    {showAdd&&<div className="backdrop" onClick={()=>setShowAdd(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-head"><h2>添加依赖</h2><button onClick={()=>setShowAdd(false)}>×</button></div>
        <label>依赖名称<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="例如 date-fns"/></label>
        <label>版本<input value={version} onChange={e=>setVersion(e.target.value)} placeholder="例如 1.0.0"/></label>
        <label>许可证<select value={license} onChange={e=>setLicense(e.target.value)}><option>MIT</option><option>BSD-3-Clause</option><option>Apache-2.0</option><option>GPL-3.0</option></select></label>
        <button className="primary full" onClick={add}>加入扫描</button>
      </div>
    </div>}
  </div>;
}
