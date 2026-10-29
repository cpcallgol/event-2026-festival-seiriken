import {useCallback,useEffect,useRef,useState} from 'react';
import {Trophy,Clock3,ChevronRight,RefreshCw,TriangleAlert,ArrowLeft,Info,CheckCircle2,Vote as VoteIcon} from 'lucide-react';
import {ApiError,newId,clockSeconds} from './lib/api';
import {backend,MODE} from './lib/backend';
import type {Contest,ContestState,Vote} from './lib/types';
import {CONTEST_STATUS_LABELS} from './lib/types';
import {content} from './content';
import {Dialog,Toast} from './ui';
import {deviceId} from './visitor';

const RANKS=['1位','2位','3位'];
function device(){try{return deviceId();}catch{return undefined;}}
const entryText=(c:Contest,n:number)=>{const e=c.entries.find(x=>x.number===n);return e?`No.${e.number} ${e.name}`:`No.${n}`;};

export default function VotePage({contestId}:{contestId:number|null}){
  const [state,setState]=useState<ContestState|null>(null);
  const [connection,setConnection]=useState<'loading'|'ok'|'error'>('loading');
  const [offset,setOffset]=useState(0),[now,setNow]=useState(Date.now());
  const [justVoted,setJustVoted]=useState<Record<number,Vote>>({});
  const [picks,setPicks]=useState<(number|null)[]>([null,null,null]);
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
  const [toast,setToast]=useState<{text:string;error?:boolean}|null>(null);
  const request=useRef<{key:string;id:string}|null>(null),toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

  const notify=useCallback((text:string,error=false)=>{setToast({text,error});if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(null),error?9000:5000);},[]);
  const refresh=useCallback(async()=>{
    try{const s=await (await backend()).contestState(device());setState(s);setJustVoted({});setOffset(Date.parse(s.now)-Date.now());setConnection('ok');}
    catch{setConnection('error');}
  },[]);
  useEffect(()=>{
    refresh();
    const poll=setInterval(()=>{if(document.visibilityState==='visible')refresh();},20000);
    const tick=setInterval(()=>setNow(Date.now()),1000);
    return()=>{clearInterval(poll);clearInterval(tick);if(toastTimer.current)clearTimeout(toastTimer.current);};
  },[refresh]);
  useEffect(()=>{setPicks([null,null,null]);request.current=null;},[contestId]);

  const serverNow=now+offset;
  const contests=state?.contests??[];
  const current=contestId!==null?contests.find(c=>c.id===contestId)??null:contests.length===1?contests[0]:null;
  const need=current?Math.min(3,current.entries.length):0;
  const chosen=picks.slice(0,need);
  const ready=need>0&&chosen.every(n=>n!==null);
  const done=current?current.my_vote??justVoted[current.id]??null:null;

  async function cast(){
    if(!current||!ready)return;
    const id=device();
    if(!id){notify('このブラウザーでは投票できません。シークレットモードやプライベートブラウズを解除してから、もう一度開いてください。',true);return;}
    const numbers=chosen as number[],key=`${current.id}:${numbers.join(',')}`;
    if(request.current?.key!==key)request.current={key,id:newId()};
    setBusy(true);
    try{
      const r=await (await backend()).vote({contestId:current.id,numbers,deviceId:id,requestId:request.current.id});
      setJustVoted(v=>({...v,[current.id]:r.vote}));setConfirm(false);request.current=null;
      notify('投票しました。ありがとうございました。');
    }catch(e){
      setConfirm(false);
      if(e instanceof ApiError&&e.code==='voted')request.current=null;
      if(e instanceof ApiError&&['voted','entries','before','closed'].includes(e.code))refresh();
      notify(e instanceof Error?e.message:'投票できませんでした。',true);
    }finally{setBusy(false);}
  }

  const header=<header className="v-header">
    <a className="v-brand" href="#/"><span className="brand-icon small"><Trophy size={20} strokeWidth={1.8}/></span><span><strong>{content.eventName}</strong><small>投票</small></span></a>
    <span className="v-clock" aria-label="現在時刻"><Clock3 size={14}/>{clockSeconds(serverNow)}</span>
  </header>;
  const banners=<>
    {MODE!=='supabase'&&<div className="banner warning"><Info size={20}/><div><strong>投票はインターネット版だけで使えます</strong><p>このページはWi-Fi版では使えません。</p></div></div>}
    {connection==='error'&&<div className="banner danger"><TriangleAlert size={20}/><div><strong>通信を確認できません</strong><p>インターネットにつながっているか確かめてください。</p></div><button className="button small" onClick={()=>refresh()}><RefreshCw size={15}/>再読み込み</button></div>}
  </>;

  return <div className="v-shell">
    {header}
    <main className="v-main">
      {current?<>
        {contests.length>1&&<a className="back-link" href="#/vote"><ArrowLeft size={17}/>コンテストの一覧へ戻る</a>}
        <section className="v-hero"><span className="eyebrow">{content.eventName} 投票</span><h1>{current.label}</h1><p className="v-venue"><Clock3 size={16}/>投票できる時間：{current.opens_time}〜{current.closes_time}</p></section>
        {banners}
        {current.description&&<section className="panel notices event-notice"><h2><Info size={17}/>ご案内</h2><p>{current.description}</p></section>}
        {done?<section className="panel vote-done"><CheckCircle2 size={34} strokeWidth={1.6}/><h2>投票ありがとうございました</h2>
          {done.picks.length>0?<ol className="vote-picks">{done.picks.map(p=><li key={p.rank}><span className="vote-rank">{RANKS[p.rank-1]}</span><strong>No.{p.number}</strong>{p.name}</li>)}</ol>:<p>このスマホからは、すでに投票しています。</p>}
          <p className="muted">投票は1回だけです。結果の発表をお楽しみに。</p></section>
        :current.status!=='open'?<div className="v-empty"><Clock3 size={32} strokeWidth={1.4}/><strong>{current.status==='before'?`投票は ${current.opens_time} から始まります`:'投票は終了しました'}</strong><p>{current.status==='before'?'時間になったら、このページを開き直してください。':'ご協力ありがとうございました。結果の発表をお楽しみに。'}</p></div>
        :!need?<div className="v-empty"><Clock3 size={32} strokeWidth={1.4}/><strong>出場者を準備しています</strong><p>しばらくしてから、もう一度開いてください。</p></div>
        :<>
          <h2 className="v-section-title">出場者<span>{current.entries.length} 組</span></h2>
          <div className="entry-list">{current.entries.map(e=>{const rank=chosen.indexOf(e.number);return <div key={e.number} className={`entry-card ${rank>=0?'picked':''}`}>
            <span className="entry-no"><small>No.</small>{e.number}</span>
            <span className="entry-main"><strong>{e.name}</strong>{e.team&&<small>{e.team}</small>}{e.theme&&<span>{e.theme}</span>}</span>
            {rank>=0&&<span className="vote-rank">{RANKS[rank]}</span>}
          </div>;})}</div>
          <section className="panel vote-form"><h2><VoteIcon size={18}/>エントリー番号を選んでください</h2>
            <p className="muted">{need===3?'いちばん良かった仮装を1位に、次に良かったものを2位・3位に選びます。':`1位から${need}位まで選びます。`}同じ出場者は1回だけ選べます。</p>
            {chosen.map((value,i)=><label key={i} className="vote-row"><span className="vote-rank">{RANKS[i]}</span>
              <select className="filter-select full" value={value??''} disabled={busy} onChange={e=>{const v=e.target.value?Number(e.target.value):null;setPicks(p=>p.map((x,j)=>j===i?v:x===v&&v!==null?null:x));}} aria-label={`${RANKS[i]}のエントリー番号`}>
                <option value="">選んでください</option>
                {current.entries.map(e=><option key={e.number} value={e.number} disabled={chosen.includes(e.number)&&value!==e.number}>No.{e.number} {e.name}</option>)}
              </select></label>)}
            <button className="button primary full" disabled={busy||!ready||MODE!=='supabase'} onClick={()=>setConfirm(true)}><VoteIcon size={17}/>投票する</button>
          </section>
          <p className="v-hint"><Info size={14}/>投票は1台のスマホで1回だけです。投票したあとは変えられません。</p>
        </>}
      </>:<>
        <section className="v-hero"><span className="eyebrow">VOTE</span><h1>{content.eventName}の投票</h1></section>
        {banners}
        {!state&&connection==='loading'&&<div className="table-loading"><RefreshCw size={16} className="spin"/>読み込み中</div>}
        {state&&contestId!==null&&<div className="v-empty"><TriangleAlert size={32} strokeWidth={1.4}/><strong>このコンテストは見つかりません</strong><p>一覧から選び直してください。</p></div>}
        {state&&!contests.length&&<div className="v-empty"><Trophy size={32} strokeWidth={1.4}/><strong>いま投票できるコンテストはありません</strong></div>}
        {state&&contests.length>0&&<><h2 className="v-section-title">コンテストを選んでください</h2>
          <div className="event-list">{contests.map(c=><a key={c.id} className="event-card" href={`#/vote/${c.id}`}>
            <span className={`round-tone tone-${c.id%6}`}/>
            <div className="event-main"><h3>{c.label}</h3><p><Clock3 size={14}/>投票 {c.opens_time}〜{c.closes_time}</p>
              <div className="event-chips"><span className={`status-chip ${c.status==='open'&&!c.my_vote?'status-open':'neutral'}`}><span/>{c.my_vote?'投票済み':CONTEST_STATUS_LABELS[c.status]}</span></div></div>
            <ChevronRight size={20}/>
          </a>)}</div></>}
      </>}
      <p className="v-hint"><a className="text-link" href="#/">整理券のページへ<ChevronRight size={14}/></a></p>
    </main>
    <footer className="v-footer">{content.footer}</footer>
    {confirm&&current&&<Dialog title="投票の確認" busy={busy} onClose={()=>setConfirm(false)}>
      <span className="dialog-symbol"><Trophy size={24}/></span>
      <h2>この内容で投票しますか？</h2>
      <div className="confirm-values">{chosen.map((n,i)=><div key={i}><span>{RANKS[i]}</span><strong>{n!==null?entryText(current,n):''}</strong></div>)}</div>
      <p className="dialog-description">投票は1回だけです。投票したあとは変えられません。</p>
      <div className="dialog-buttons"><button className="button" disabled={busy} onClick={()=>setConfirm(false)}>選び直す</button><button className="button primary" disabled={busy} onClick={cast}>{busy&&<RefreshCw size={16} className="spin"/>}投票する</button></div>
    </Dialog>}
    <Toast toast={toast} onClose={()=>setToast(null)}/>
  </div>;
}
