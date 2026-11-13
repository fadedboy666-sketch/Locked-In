(function(){
'use strict';
const plugin=()=>window.Capacitor?.Plugins?.AppBlocker;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const appState=()=>typeof state!=='undefined'?state:null;
const habits=()=>Array.isArray(appState()?.trackerHabits)?appState().trackerHabits:[];
function render(){
 const host=document.getElementById('homeWidgetSettings');if(!host)return;
 host.innerHTML='<div style="font-weight:800;margin-bottom:8px;">Home-screen widgets</div><div class="muted" style="font-size:12px;line-height:1.5;margin-bottom:12px;">Add widgets to keep your progress visible on your home screen.</div><div style="border-top:1px solid var(--line);padding-top:12px;margin-top:8px;"><div style="font-weight:700;margin-bottom:5px;">Streak widget</div><div class="muted" style="font-size:12px;margin-bottom:10px;">Keep your current streak visible on your home screen.</div><button class="btn-sm" id="addStreakHomeWidget" type="button" style="width:100%;">Add streak widget</button></div><div style="border-top:1px solid var(--line);padding-top:12px;margin-top:12px;"><div style="font-weight:700;margin-bottom:5px;">Habit widget</div><div class="muted" style="font-size:12px;margin-bottom:10px;">Select habits from your habit tracker.</div><button class="btn-sm" id="chooseHabitWidgets" type="button" style="width:100%;">Choose from habit tracker</button></div>';
 document.getElementById('addStreakHomeWidget')?.addEventListener('click',addStreak);
 document.getElementById('chooseHabitWidgets')?.addEventListener('click',openHabitSelection);
}
async function addStreak(){const p=plugin();if(!p?.requestStreakWidget)return;try{await sync();await p.requestStreakWidget();}catch(e){console.warn('Streak widget request failed:',e);}}
let selected=new Set(),selectionRoot=null;
function openHabitSelection(){
 if(!habits().length){window.showScreen?.('habitTrackerScreen');return;}
 selected=new Set();
 if(!selectionRoot){selectionRoot=document.createElement('div');selectionRoot.id='widgetHabitSelectOverlay';selectionRoot.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg);display:none;flex-direction:column;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px calc(env(safe-area-inset-bottom,0px) + 12px);';document.body.appendChild(selectionRoot);}
 drawSelection();selectionRoot.style.display='flex';window.showScreen?.('habitTrackerScreen');
}
function drawSelection(){
 selectionRoot.innerHTML='<div style="display:flex;align-items:center;gap:12px;padding:4px 0 14px;"><button type="button" id="cancelWidgetSelection" style="border:0;background:none;color:var(--text);font-size:15px;font-weight:700;padding:8px 0;">‹ Cancel</button><div style="font-size:18px;font-weight:800;">Select habits</div><div style="margin-left:auto;color:var(--sub);font-size:12px;" id="widgetSelectionCount">'+selected.size+' selected</div></div><div style="color:var(--sub);font-size:11px;font-weight:800;letter-spacing:.5px;margin-bottom:9px;">YOUR HABIT TRACKER</div><div id="widgetSelectionList" style="flex:1;min-height:0;overflow-y:auto;padding-bottom:12px;">'+habits().map(h=>{const id=String(h.id??h.name),checked=selected.has(id),days=Array.isArray(h.days)?h.days:[];return '<div class="tracker-card" data-widget-habit="'+esc(id)+'" style="margin-bottom:10px;display:flex;align-items:center;gap:12px;padding:13px;cursor:pointer;"><div style="width:34px;height:34px;border-radius:9px;background:#47252d;display:grid;place-items:center;color:#ef9aa6;font-size:17px;flex:none;">'+esc(h.icon||'🎯')+'</div><div style="flex:1;min-width:0;"><div style="font-weight:800;font-size:14px;">'+esc(h.name||'Habit')+'</div><div class="muted" style="font-size:11px;margin-top:3px;">'+esc(h.metric||'30-day progress')+'</div><div style="display:grid;grid-template-columns:repeat(10,1fr);gap:3px;margin-top:9px;">'+Array.from({length:30},(_,i)=>'<span style="height:7px;border-radius:2px;background:'+(days[i]==='done'?'#22c55e':days[i]==='rest'?'#3b82f6':days[i]==='missed'?'#e3364c':'#30323b')+';"></span>').join('')+'</div></div><span style="width:23px;height:23px;border-radius:50%;border:2px solid '+(checked?'var(--red)':'var(--sub)')+';background:'+(checked?'var(--red)':'transparent')+';color:#fff;display:grid;place-items:center;flex:none;font-weight:800;">'+(checked?'✓':'')+'</span></div>';}).join('')+'</div><div style="padding-top:10px;border-top:1px solid var(--line);background:var(--bg);"><button type="button" id="confirmWidgetSelection" class="addbtn" style="margin:0;" '+(selected.size?'':'disabled')+'>Confirm selection</button></div>';
 selectionRoot.querySelector('#cancelWidgetSelection').onclick=closeSelection;
 selectionRoot.querySelectorAll('[data-widget-habit]').forEach(card=>card.addEventListener('click',()=>{const id=card.getAttribute('data-widget-habit');if(selected.has(id))selected.delete(id);else selected.add(id);drawSelection();}));
 selectionRoot.querySelector('#confirmWidgetSelection').onclick=confirmSelection;
}
function closeSelection(){if(selectionRoot)selectionRoot.style.display='none';selected.clear();}
async function confirmSelection(){
 const p=plugin();if(!p?.requestHabitWidget||!p?.getHomeWidgetStatus)return;
 const chosen=habits().filter(h=>selected.has(String(h.id??h.name)));if(!chosen.length)return;
 const button=selectionRoot.querySelector('#confirmWidgetSelection');button.disabled=true;await sync();
 let accepted=0;
 for(const h of chosen){
  try{
   const before=await p.getHomeWidgetStatus();
   button.textContent='Adding '+String(h.name||'habit')+'…';
   const result=await p.requestHabitWidget({habitId:String(h.id??h.name)});
   if(result?.pinned){
    accepted++;
    button.textContent='Confirm the widget on your home screen…';
    const started=Date.now();
    while(Date.now()-started<45000){
     await new Promise(resolve=>setTimeout(resolve,500));
     const current=await p.getHomeWidgetStatus();
     if((current?.habitCount||0)>(before?.habitCount||0))break;
    }
   }
  }catch(e){console.warn('Habit widget request failed:',h.name,e);}
 }
 closeSelection();if(accepted)localStorage.setItem('lockedin_widget_invite_added_v1','1');
}
async function sync(){
 const p=plugin(),s=appState();if(!p?.syncHomeWidgets||!s)return;
 try{const safeHabits=habits().map(h=>({id:String(h.id??''),name:String(h.name||''),icon:String(h.icon||''),metric:String(h.metric||''),days:Array.isArray(h.days)?h.days.slice(0,30):[],createdOn:String(h.createdOn||''),firstUseDate:String(s.firstUseDate||'')}));await p.syncHomeWidgets({streak:Number(s.streak)||0,lapsed:!!s.lapsed,habits:safeHabits});}catch(e){console.warn('Home widget sync failed:',e);}
}
async function applyPending(){
 const p=plugin();if(!p?.getPendingWidgetChanges||!appState()||typeof window.cycleTrackerDayCell!=='function')return;
 try{const result=await p.getPendingWidgetChanges(),changes=Array.isArray(result?.changes)?result.changes:[];for(const change of changes){const idx=habits().findIndex(h=>String(h.id??'')===String(change.habitId??''));if(idx>=0&&Number.isInteger(change.dayIndex)&&change.dayIndex>=0&&change.dayIndex<30)window.cycleTrackerDayCell(idx,change.dayIndex);}if(changes.length)await sync();}catch(e){console.warn('Could not apply home widget changes:',e);}
}
let inviteBusy=false;
async function maybeInvite(){
 if(inviteBusy||!appState()||Number(appState().streak)<2)return;
 const p=plugin();if(!p?.getHomeWidgetStatus)return;inviteBusy=true;
 try{
  const status=await p.getHomeWidgetStatus();if((status?.streakCount||0)+(status?.habitCount||0)>0){localStorage.setItem('lockedin_widget_invite_added_v1','1');return;}
  const last=Number(localStorage.getItem('lockedin_widget_invite_last_shown_v1')||0);if(Date.now()-last<3*86400000||document.getElementById('lockedInWidgetInvite'))return;
  localStorage.setItem('lockedin_widget_invite_last_shown_v1',String(Date.now()));
  const sheet=document.createElement('div');sheet.id='lockedInWidgetInvite';sheet.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.58);display:flex;align-items:flex-end;';
  sheet.innerHTML='<div style="width:100%;max-width:420px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:22px 22px 0 0;padding:22px 18px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -12px 36px rgba(0,0,0,.4);"><div style="font-size:19px;font-weight:800;margin-bottom:7px;">Add Widgets</div><div class="muted" style="font-size:13px;line-height:1.5;margin-bottom:20px;">Make your progress visible on the home screen.</div><div style="display:flex;gap:10px;"><button id="widgetInviteAdd" class="addbtn" style="flex:1;margin:0;">Add widget</button><button id="widgetInviteSkip" class="btn-sm" style="flex:1;margin:0;">Skip for now</button></div></div>';
  document.body.appendChild(sheet);sheet.querySelector('#widgetInviteAdd').onclick=()=>{sheet.remove();window.showScreen?.('settingsScreen');};sheet.querySelector('#widgetInviteSkip').onclick=()=>sheet.remove();
 }catch(e){console.warn('Widget invite check failed:',e);}finally{inviteBusy=false;}
}
window.renderHomeWidgetSettings=render;
window.LockedInHomeWidgets={sync,applyPending,render};
document.addEventListener('DOMContentLoaded',()=>{render();sync();applyPending();setTimeout(maybeInvite,1200);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){sync();applyPending();maybeInvite();}});
window.addEventListener('focus',()=>{sync();applyPending();maybeInvite();});
setInterval(()=>{if(document.visibilityState==='visible'){applyPending();maybeInvite();}},30000);
})();