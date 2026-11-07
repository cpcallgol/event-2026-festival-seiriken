import {useCallback,useEffect,useState} from 'react';
import {Trophy,Plus,Pencil,Trash2,RefreshCw,Download,Printer,ShieldCheck,RotateCcw,Users,Clock3,TriangleAlert} from 'lucide-react';
import {ApiError,fmt} from './lib/api';
import {backend} from './lib/backend';
import type {AdminContestState,Contest,ContestEntry} from './lib/types';
import {CONTEST_STATUS_LABELS} from './lib/types';
import {content} from './content';
import {Dialog,useQr} from './ui';

type ContestForm={id?:number;label:string;description:string;opensTime:string;closesTime:string};
type EntryForm={id?:number;number:string;name:string;team:string;theme:string};
const isTime=(v:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const csvCell=(v:unknown)=>{const s=String(v??'');return /[",\r\n]/.test(s)||/^[=+\-@\t\r]/.test(s)?`"${(/^[=+\-@\t\r]/.test(s)?"'":'')+s.replace(/"/g,'""')}"`:s;};
const byRank=(a:ContestEntry,b:ContestEntry)=>(a.rank??0)-(b.rank??0)||a.number-b.number;
const votePoints=(e:ContestEntry)=>e.vote_points??e.points??0;
const signed=(n:number)=>n>0?`+${fmt(n)}`:n<0?`−${fmt(-n)}`:'0';

export default function ContestTab({notify,onLogin}:{notify:(text:string,error?:boolean)=>void;onLogin:()=>void}){
  const [state,setState]=useState<AdminContestState|null>(null);
  const [selected,setSelected]=useState<number|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [contestForm,setContestForm]=useState<ContestForm|null>(null),[entryForm,setEntryForm]=useState<EntryForm|null>(null);
  const [confirm,setConfirm]=useState<{kind:'contest_delete'|'contest_reset'|'entry_delete';contest:Contest;entry?:ContestEntry}|null>(null);
  const [adjustForm,setAdjustForm]=useState<{entry:ContestEntry;value:string;password:string}|null>(null);

  const refresh=useCallback(async()=>{
    try{setState(await (await backend()).adminContestState());}
    catch(e){if(e instanceof ApiError&&e.status===401)onLogin();}
  },[onLogin]);
  useEffect(()=>{
    refresh();
    const poll=setInterval(()=>{if(document.visibilityState==='visible')refresh();},10000);
    return()=>clearInterval(poll);
  },[refresh]);

  const contests=state?.contests??[];
  const contest=contests.find(c=>c.id===selected)??contests[0]??null;
  const url=contest?`${location.origin}${location.pathname}#/vote/${contest.id}`:'';
  const qr=useQr(url);
  const previewing=/^(localhost|127\.|\[::1\])/.test(location.hostname);

  async function run(body:Record<string,unknown>,done:string){
    setBusy(true);
    try{await (await backend()).adminContest(body);notify(done);await refresh();return true;}
    catch(e){if(e instanceof ApiError&&e.status===401)onLogin();const m=e instanceof Error?e.message:'保存できませんでした。';setError(m);notify(m,true);return false;}
    finally{setBusy(false);}
  }
  async function saveContest(){
    if(!contestForm)return;
    const label=contestForm.label.trim();
    if(!label){setError('コンテストの名前を入力してください。');return;}
    if(!isTime(contestForm.opensTime)||!isTime(contestForm.closesTime)){setError('時刻は「10:00」の形式で入力してください。');return;}
    if(contestForm.opensTime>=contestForm.closesTime){setError('投票の終了は、開始より後の時刻にしてください。');return;}
    setError('');
    if(await run({action:contestForm.id?'contest_update':'contest_create',id:contestForm.id,label,description:contestForm.description.trim(),opensTime:contestForm.opensTime,closesTime:contestForm.closesTime},contestForm.id?'コンテストを更新しました。':'コンテストを追加しました。'))setContestForm(null);
  }
  async function saveEntry(){
    if(!entryForm||!contest)return;
    if(!/^\d{1,3}$/.test(entryForm.number)||Number(entryForm.number)<1){setError('エントリー番号は1〜999の数字で入力してください。');return;}
    if(!entryForm.name.trim()){setError('名前を入力してください。');return;}
    setError('');
    if(await run({action:entryForm.id?'entry_update':'entry_create',id:entryForm.id,contestId:contest.id,number:Number(entryForm.number),name:entryForm.name.trim(),team:entryForm.team.trim(),theme:entryForm.theme.trim()},entryForm.id?'出場者を更新しました。':`No.${entryForm.number} を追加しました。`))setEntryForm(null);
  }
  async function doConfirm(){
    if(!confirm)return;
    const {kind,contest:c,entry}=confirm;
    const ok=kind==='entry_delete'?await run({action:kind,id:entry?.id},`No.${entry?.number} を削除しました。`)
      :kind==='contest_reset'?await run({action:kind,id:c.id},`${c.label}の投票をリセットしました。`)
      :await run({action:kind,id:c.id},`${c.label}を削除しました。`);
    if(ok){setConfirm(null);if(kind==='contest_delete')setSelected(null);}
  }
  async function saveAdjust(){
    if(!adjustForm)return;
    const {entry,value,password}=adjustForm;
    if(!/^-?\d{1,4}$/.test(value)){setError('調整点は -9999〜9999 の整数で入力してください。');return;}
    if(!/^\d{7}$/.test(password)){setError('取消用のパスワード（7桁）を入力してください。');return;}
    setError('');setBusy(true);
    try{await (await backend()).adminContestAdjust(entry.id!,Number(value),password);notify(`No.${entry.number} の調整点を ${signed(Number(value))} 点にしました。`);setAdjustForm(null);await refresh();}
    catch(e){if(e instanceof ApiError&&e.code==='password')setAdjustForm({...adjustForm,password:''});const m=e instanceof Error?e.message:'保存できませんでした。';setError(m);notify(m,true);}
    finally{setBusy(false);}
  }
  function downloadCsv(){
    if(!contest)return;
    const head=['順位','エントリー番号','名前','学年と学科','テーマ','投票の点','調整点','合計点','1位の票','2位の票','3位の票'];
    const lines=[...contest.entries].sort(byRank).map(e=>[e.rank,e.number,e.name,e.team,e.theme,votePoints(e),e.adjust??0,e.points,e.first,e.second,e.third].map(csvCell).join(','));
    const text='\uFEFF'+[`${csvCell(contest.label)},投票数,${contest.votes??0}`,head.join(','),...lines].join('\r\n')+'\r\n';
    const blob=new Blob([text],{type:'text/csv;charset=utf-8'}),href=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=href;a.download=`contest-${contest.id}-results.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);
    notify('順位をCSVで出力しました。');
  }
  const nextNumber=()=>String(Math.min(999,Math.max(0,...(contest?.entries??[]).map(e=>e.number))+1));

  if(!state)return <div className="table-loading"><RefreshCw size={16} className="spin"/>読み込み中</div>;
  return <>
    <section className="panel no-print"><div className="panel-heading"><h2><Trophy size={18}/>コンテスト</h2><div className="row-actions">
      {contests.length>1&&<select className="filter-select" value={contest?.id??''} onChange={e=>setSelected(Number(e.target.value))} aria-label="コンテストを選ぶ">{contests.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select>}
      <button className="button primary small" disabled={busy} onClick={()=>{setError('');setContestForm({label:'',description:'',opensTime:'10:00',closesTime:'15:00'});}}><Plus size={16}/>コンテストを追加</button>
    </div></div>
      {contest?<div className="contest-info">
        <div><span className={`status-chip ${contest.status==='open'?'status-open':'neutral'}`}><span/>{CONTEST_STATUS_LABELS[contest.status]}</span><h3>{contest.label}</h3><p className="muted"><Clock3 size={14}/>投票できる時間：開催日（{state.eventDate}）の {contest.opens_time}〜{contest.closes_time}</p>{contest.description&&<p className="contest-description">{contest.description}</p>}</div>
        <div className="contest-numbers"><div><span>投票数</span><strong>{fmt(contest.votes??0)}</strong></div><div><span>出場者</span><strong>{fmt(contest.entries.length)}</strong></div></div>
        <div className="row-actions">
          <button className="button small" disabled={busy} onClick={()=>{setError('');setContestForm({id:contest.id,label:contest.label,description:contest.description,opensTime:contest.opens_time,closesTime:contest.closes_time});}}><Pencil size={14}/>編集</button>
          <button className="button small" disabled={busy||!contest.votes} onClick={()=>setConfirm({kind:'contest_reset',contest})}><RotateCcw size={14}/>投票をリセット</button>
          <button className="icon-button" disabled={busy||!!contest.votes} title={contest.votes?'投票が入っているコンテストは削除できません':''} aria-label={`${contest.label}を削除`} onClick={()=>setConfirm({kind:'contest_delete',contest})}><Trash2 size={16}/></button>
        </div>
      </div>:<div className="empty"><div className="empty-icon"><Trophy size={26}/></div><strong>コンテストがありません</strong><p>「コンテストを追加」から登録してください。</p></div>}
    </section>

    {contest&&<>
      <section className="panel no-print"><div className="panel-heading"><div><h2><Trophy size={18}/>順位</h2><p className="muted tiny">合計点は、投票の点（1位＝3点・2位＝2点・3位＝1点）に調整点を足したものです。同じ点数なら、1位に選ばれた数が多い方が上になります。来場者には表示されません。</p></div><button className="button small" disabled={!contest.entries.length} onClick={downloadCsv}><Download size={16}/>CSVを出力</button></div>
        {contest.entries.length?<div className="table-scroll"><table><thead><tr><th>順位</th><th>エントリー</th><th>学年と学科</th><th className="right">投票の点</th><th className="right">調整点</th><th className="right">合計点</th><th className="right">1位</th><th className="right">2位</th><th className="right">3位</th></tr></thead><tbody>{[...contest.entries].sort(byRank).map(e=><tr key={e.number}>
          <td><strong className={`contest-rank rank-${e.rank}`}>{(contest.votes??0)||contest.entries.some(x=>x.adjust)?`${e.rank} 位`:'—'}</strong></td>
          <td><strong>No.{e.number}</strong> {e.name}{e.theme&&<span className="table-note">{e.theme}</span>}</td>
          <td>{e.team||<span className="muted">—</span>}</td>
          <td className="right mono">{fmt(votePoints(e))} 点</td>
          <td className="right mono">{e.adjust?`${signed(e.adjust)} 点`:<span className="muted">—</span>}</td>
          <td className="right mono"><strong>{fmt(e.points??0)}</strong> 点</td>
          <td className="right mono">{fmt(e.first??0)}</td><td className="right mono">{fmt(e.second??0)}</td><td className="right mono">{fmt(e.third??0)}</td>
        </tr>)}</tbody></table></div>:<div className="empty"><strong>出場者がまだいません</strong></div>}
        <div className="table-bottom"><ShieldCheck size={14}/>投票数 {fmt(contest.votes??0)} 票（1台のスマホで1回）<span>10秒ごとに更新</span></div>
      </section>

      <section className="panel no-print"><div className="panel-heading"><h2><Users size={18}/>出場者</h2><button className="button primary small" disabled={busy} onClick={()=>{setError('');setEntryForm({number:nextNumber(),name:'',team:'',theme:''});}}><Plus size={16}/>出場者を追加</button></div>
        {contest.entries.length?<div className="table-scroll"><table><thead><tr><th>エントリー番号</th><th>名前</th><th>学年と学科</th><th>テーマ</th><th className="right">調整点</th><th className="right">操作</th></tr></thead><tbody>{contest.entries.map(e=>{const voted=(e.first??0)+(e.second??0)+(e.third??0)>0;return <tr key={e.number}>
          <td><strong className="ticket-no">No.{e.number}</strong></td><td>{e.name}</td><td>{e.team||<span className="muted">—</span>}</td><td>{e.theme||<span className="muted">—</span>}</td>
          <td className="right"><button className="button small" disabled={busy} onClick={()=>{setError('');setAdjustForm({entry:e,value:String(e.adjust??0),password:''});}}><span className="mono">{signed(e.adjust??0)} 点</span><Pencil size={14}/></button></td>
          <td className="right"><div className="row-actions">
            <button className="icon-button" disabled={busy} aria-label={`No.${e.number}を編集`} onClick={()=>{setError('');setEntryForm({id:e.id,number:String(e.number),name:e.name,team:e.team,theme:e.theme});}}><Pencil size={16}/></button>
            <button className="icon-button" disabled={busy||voted} title={voted?'投票が入っている出場者は削除できません':''} aria-label={`No.${e.number}を削除`} onClick={()=>setConfirm({kind:'entry_delete',contest,entry:e})}><Trash2 size={16}/></button>
          </div></td>
        </tr>;})}</tbody></table></div>:<div className="empty"><div className="empty-icon"><Users size={26}/></div><strong>出場者を登録してください</strong><p>「出場者を追加」から、エントリー番号・名前・学年と学科・テーマを登録します。</p></div>}
        <div className="table-bottom"><ShieldCheck size={14}/>来場者には、エントリー番号の順に表示されます。<span>{contest.entries.length}組</span></div>
      </section>

      <div className="poster-layout">
        <section className="panel poster-settings"><div className="panel-heading"><h2><span className="heading-mark"/>投票用QR</h2></div>
          <div className="reconciliation-body">
            <label className="form-label" htmlFor="v-url">投票ページのURL</label>
            <input id="v-url" className="text-input mono" value={url} readOnly/>
            {previewing?<p className="field-hint negative">いまはこのPCでの試用（{location.host}）なので、このQRコードはスマホでは開けません。公開したURLで運営画面を開くと、掲示用のQRコードになります。</p>
            :<p className="field-hint">整理券の掲示用QRとは別のQRです。スタッフが持つ分と会場に貼る分は、同じものを印刷してください。</p>}
            <button className="button dark full" onClick={()=>window.print()} disabled={!qr}><Printer size={17}/>印刷する</button>
            <p className="field-hint">印刷ダイアログで「背景のグラフィック」をオンにすると、色も印刷されます。</p>
          </div>
        </section>
        <section className="poster" aria-label="投票用QRのプレビュー">
          <div className="poster-head"><span>{content.eventName}</span><h2>{contest.label}</h2><p>投票はこちらから</p></div>
          <div className="poster-codes"><div className="poster-code">{qr?<img src={qr} alt="投票ページのQRコード"/>:<div className="poster-placeholder"/>}<strong>スマホで読み取って投票</strong><small>投票できる時間 {contest.opens_time}〜{contest.closes_time}</small></div></div>
          <p className="poster-note">エントリー番号で1位・2位・3位を選んで投票します。投票は1台のスマホで1回だけです。</p>
        </section>
      </div>
    </>}

    {contestForm&&<Dialog title={contestForm.id?'コンテストを編集':'コンテストを追加'} busy={busy} onClose={()=>setContestForm(null)}>
      <span className="dialog-eyebrow">{contestForm.id?'EDIT CONTEST':'NEW CONTEST'}</span>
      <h2>{contestForm.id?'コンテストを編集':'コンテストを追加'}</h2>
      <p className="dialog-description">時刻は開催日（{state.eventDate}）の時刻として扱います。この時間の間だけ投票できます。</p>
      <label className="form-label" htmlFor="c-label">コンテストの名前</label>
      <input id="c-label" className="text-input" maxLength={40} value={contestForm.label} placeholder="例: 仮装コンテスト" onChange={e=>setContestForm({...contestForm,label:e.target.value})}/>
      <div className="form-three">
        <div><label className="form-label" htmlFor="c-opens">投票の開始</label><input id="c-opens" type="time" className="text-input" value={contestForm.opensTime} onChange={e=>setContestForm({...contestForm,opensTime:e.target.value})}/></div>
        <div><label className="form-label" htmlFor="c-closes">投票の終了</label><input id="c-closes" type="time" className="text-input" value={contestForm.closesTime} onChange={e=>setContestForm({...contestForm,closesTime:e.target.value})}/></div>
      </div>
      <label className="form-label" htmlFor="c-desc">説明<span className="muted tiny">投票ページに出る文章（1000文字まで）</span></label>
      <textarea id="c-desc" className="text-input textarea" maxLength={1000} rows={3} value={contestForm.description} onChange={e=>setContestForm({...contestForm,description:e.target.value})}/>
      {error&&<p className="field-hint negative" role="alert">{error}</p>}
      <div className="dialog-buttons spaced"><button className="button" disabled={busy} onClick={()=>setContestForm(null)}>やめる</button><button className="button primary" disabled={busy} onClick={saveContest}>{busy&&<RefreshCw size={16} className="spin"/>}{contestForm.id?'更新する':'追加する'}</button></div>
    </Dialog>}

    {entryForm&&contest&&<Dialog title={entryForm.id?'出場者を編集':'出場者を追加'} busy={busy} onClose={()=>setEntryForm(null)}>
      <span className="dialog-eyebrow">{entryForm.id?'EDIT ENTRY':'NEW ENTRY'}</span>
      <h2>{entryForm.id?'出場者を編集':'出場者を追加'}</h2>
      <p className="dialog-description">{contest.label}の出場者です。来場者はエントリー番号で選びます。</p>
      <div className="form-three">
        <div><label className="form-label" htmlFor="n-number">エントリー番号</label><input id="n-number" inputMode="numeric" className="text-input" value={entryForm.number} onChange={e=>/^\d{0,3}$/.test(e.target.value)&&setEntryForm({...entryForm,number:e.target.value})}/></div>
        <div><label className="form-label" htmlFor="n-team">学年と学科</label><input id="n-team" className="text-input" maxLength={60} value={entryForm.team} placeholder="例: 2年 機械科" onChange={e=>setEntryForm({...entryForm,team:e.target.value})}/></div>
      </div>
      <label className="form-label" htmlFor="n-name">名前</label>
      <input id="n-name" className="text-input" maxLength={60} value={entryForm.name} placeholder="例: 紅華 太郎" onChange={e=>setEntryForm({...entryForm,name:e.target.value})}/>
      <label className="form-label" htmlFor="n-theme">テーマ<span className="muted tiny">仮装のテーマやひとこと（100文字まで）</span></label>
      <input id="n-theme" className="text-input" maxLength={100} value={entryForm.theme} placeholder="例: 魔法使い" onChange={e=>setEntryForm({...entryForm,theme:e.target.value})}/>
      {error&&<p className="field-hint negative" role="alert">{error}</p>}
      <div className="dialog-buttons spaced"><button className="button" disabled={busy} onClick={()=>setEntryForm(null)}>やめる</button><button className="button primary" disabled={busy} onClick={saveEntry}>{busy&&<RefreshCw size={16} className="spin"/>}{entryForm.id?'更新する':'追加する'}</button></div>
    </Dialog>}

    {adjustForm&&<Dialog title="調整点" busy={busy} onClose={()=>setAdjustForm(null)}>
      <span className="dialog-eyebrow">ADJUST POINTS</span>
      <h2>No.{adjustForm.entry.number} {adjustForm.entry.name} の調整点</h2>
      <p className="dialog-description">投票の点（いま {fmt(votePoints(adjustForm.entry))} 点）に足す点数です。減らすときは「-10」のようにマイナスで入れます。0 にすると、調整なしに戻ります。投票そのものは変わりません。</p>
      <label className="form-label" htmlFor="a-value">調整点</label>
      <input id="a-value" className="text-input mono" inputMode="numeric" value={adjustForm.value} onChange={e=>/^-?\d{0,4}$/.test(e.target.value)&&setAdjustForm({...adjustForm,value:e.target.value})}/>
      {/^-?\d{1,4}$/.test(adjustForm.value)&&<p className="field-hint">合計点は {fmt(votePoints(adjustForm.entry)+Number(adjustForm.value))} 点になります。</p>}
      <label className="form-label" htmlFor="a-password">取消用のパスワード（7桁）</label>
      <input id="a-password" className="text-input mono" type="password" inputMode="numeric" autoComplete="off" maxLength={7} value={adjustForm.password} onChange={e=>/^\d{0,7}$/.test(e.target.value)&&setAdjustForm({...adjustForm,password:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&!busy)saveAdjust();}}/>
      {error&&<p className="field-hint negative" role="alert">{error}</p>}
      <div className="dialog-buttons spaced"><button className="button" disabled={busy} onClick={()=>setAdjustForm(null)}>やめる</button><button className="button primary" disabled={busy||!/^-?\d{1,4}$/.test(adjustForm.value)||adjustForm.password.length!==7} onClick={saveAdjust}>{busy&&<RefreshCw size={16} className="spin"/>}保存する</button></div>
    </Dialog>}

    {confirm&&<Dialog title="確認" busy={busy} onClose={()=>setConfirm(null)}>
      <span className="dialog-symbol red">{confirm.kind==='contest_reset'?<TriangleAlert size={24}/>:<Trash2 size={24}/>}</span>
      <h2>{confirm.kind==='entry_delete'?`No.${confirm.entry?.number} ${confirm.entry?.name} を削除しますか？`:confirm.kind==='contest_reset'?`${confirm.contest.label}の投票をリセットしますか？`:`${confirm.contest.label}を削除しますか？`}</h2>
      <p className="dialog-description">{confirm.kind==='contest_reset'?`いま入っている ${fmt(confirm.contest.votes??0)} 票をすべて消します。元に戻せません。リハーサルのあとなどに使ってください。投票したスマホも、もう一度投票できるようになります。`:confirm.kind==='contest_delete'?'出場者もいっしょに削除します。元に戻せません。':'元に戻せません。'}</p>
      <div className="dialog-buttons"><button className="button" disabled={busy} onClick={()=>setConfirm(null)}>やめる</button><button className="button destructive" disabled={busy} onClick={doConfirm}>{busy&&<RefreshCw size={16} className="spin"/>}{confirm.kind==='contest_reset'?'リセットする':'削除する'}</button></div>
    </Dialog>}
  </>;
}