import{b as m,f as g,c as y,d as f,e as x}from"./yahoo-BuRmdVwI.js";function p(c,t=0){return c==null?"--":Math.abs(c)>=1e6?(c/1e6).toFixed(1)+"M":Math.abs(c)>=1e3?(c/1e3).toFixed(1)+"K":c.toFixed(t)}class E{constructor(){this.symbol="SPY",this.spotPrice=null,this.previousClose=null,this.selectedExpiry=null,this.expirationDates=[],this.workerUrl=null,this.currentSignal=null,this.signalStrength=0,this.showGreeks=!0,this.showHeatmap=!1,this.callsData=[],this.putsData=[],this.selectedOption=null,this.init()}async init(){console.log("[SPY Options Dashboard] Initializing..."),this.bindEvents(),await Promise.all([this.loadSpotPrice(),this.loadExpirations(),this.loadSignal()])}bindEvents(){document.getElementById("expirySelect")?.addEventListener("change",t=>{this.selectedExpiry=parseInt(t.target.value),this.updateQuickExpiryButtons(),this.loadOptionsChain()}),document.querySelectorAll(".expiry-btn").forEach(t=>{t.addEventListener("click",s=>{const e=s.target.dataset.expiry;this.selectQuickExpiry(e)})}),document.getElementById("showGreeks")?.addEventListener("change",t=>{this.showGreeks=t.target.checked,this.renderTables()}),document.getElementById("showHeatmap")?.addEventListener("change",t=>{this.showHeatmap=t.target.checked,this.renderTables()}),document.getElementById("closePlModal")?.addEventListener("click",()=>{this.closePlModal()}),document.getElementById("plModal")?.addEventListener("click",t=>{t.target.id==="plModal"&&this.closePlModal()}),document.getElementById("plEntry")?.addEventListener("input",()=>this.updatePlCalculations()),document.getElementById("plContracts")?.addEventListener("input",()=>this.updatePlCalculations())}async loadSpotPrice(){try{const{price:t,previousClose:s}=await m(this.symbol,this.workerUrl);this.spotPrice=t,this.previousClose=s,this.updatePriceDisplay(),this.updateStatus("Live Data","#4ade80")}catch(t){console.error("[SPY Options] Failed to load spot price:",t),this.updateStatus("Error","#e94560")}}async loadSignal(){try{const t=await g(this.symbol,15);if(t&&t.length>0){const e=new y(t,"medium").analyze();this.currentSignal=e.overallSignal,this.signalStrength=Math.max(e.putStrength,e.callStrength),this.updateSignalDisplay(e)}}catch(t){console.error("[SPY Options] Failed to load signal:",t),this.updateSignalDisplay({overallSignal:"NEUTRAL",putStrength:0,callStrength:0})}}updateSignalDisplay(t){const s=document.getElementById("signalValue"),e=document.getElementById("strengthFill"),a=document.getElementById("strengthText"),i=document.getElementById("signalRecommendation");s&&(s.textContent=t.overallSignal,s.className="signal-value "+t.overallSignal.toLowerCase());const n=Math.max(t.putStrength,t.callStrength);e&&(e.style.width=`${n}%`,e.className=n>=60?"strength-fill high":"strength-fill"),a&&(a.textContent=`${n}%`),i&&(t.overallSignal==="PUT"?i.textContent=`Bearish signal detected (${n}% strength). Consider PUT options on pullbacks.`:t.overallSignal==="CALL"?i.textContent=`Bullish signal detected (${n}% strength). Consider CALL options on dips.`:i.textContent="No clear directional signal. Wait for confirmation before entering.")}async loadExpirations(){try{const t=await f(this.symbol,this.workerUrl);this.expirationDates=t,this.updateExpirySelect(),t.length>0&&(this.selectedExpiry=t[0],this.updateQuickExpiryButtons(),await this.loadOptionsChain())}catch(t){console.error("[SPY Options] Failed to load expirations:",t)}}selectQuickExpiry(t){const s=new Date,e=new Date(s.getFullYear(),s.getMonth(),s.getDate());let a=null;switch(t){case"0dte":a=this.expirationDates.find(l=>new Date(l*1e3)>=e);break;case"1dte":const i=new Date(e);i.setDate(i.getDate()+1),a=this.expirationDates.find(l=>new Date(l*1e3)>=i);break;case"weekly":const n=new Date(e);n.setDate(n.getDate()+7),a=this.expirationDates.find(l=>{const r=new Date(l*1e3);return r>=e&&r<=n})||this.expirationDates[0];break;case"monthly":const o=new Date(e);o.setDate(o.getDate()+20),a=this.expirationDates.find(l=>new Date(l*1e3)>=o);break}a&&(this.selectedExpiry=a,document.getElementById("expirySelect").value=a,this.updateQuickExpiryButtons(),this.loadOptionsChain())}updateQuickExpiryButtons(){if(document.querySelectorAll(".expiry-btn").forEach(n=>{n.classList.remove("active")}),!this.selectedExpiry)return;const t=new Date,s=new Date(t.getFullYear(),t.getMonth(),t.getDate()),e=new Date(this.selectedExpiry*1e3),a=Math.ceil((e-s)/(1e3*60*60*24));let i=null;a<=0?i="0dte":a===1?i="1dte":a<=7?i="weekly":a>=20&&(i="monthly"),i&&document.querySelector(`.expiry-btn[data-expiry="${i}"]`)?.classList.add("active")}async loadOptionsChain(){if(!this.selectedExpiry)return;const t=document.getElementById("callsTable"),s=document.getElementById("putsTable");t&&(t.innerHTML='<p class="loading">Loading...</p>'),s&&(s.innerHTML='<p class="loading">Loading...</p>');try{const e=await x(this.symbol,this.selectedExpiry,this.workerUrl);e.options?(this.callsData=e.options.calls||[],this.putsData=e.options.puts||[]):(e.calls||e.puts)&&(this.callsData=e.calls||[],this.putsData=e.puts||[]),this.renderTables()}catch(e){console.error("[SPY Options] Failed to load options chain:",e),t&&(t.innerHTML='<p class="error">Failed to load</p>'),s&&(s.innerHTML='<p class="error">Failed to load</p>')}}renderTables(){this.renderCallsTable(this.callsData),this.renderPutsTable(this.putsData)}updatePriceDisplay(){const t=document.getElementById("spotPrice"),s=document.getElementById("priceChange");if(t&&this.spotPrice&&(t.textContent=this.spotPrice.toFixed(2)),s&&this.spotPrice&&this.previousClose){const e=this.spotPrice-this.previousClose,a=e/this.previousClose*100,i=e>=0;s.textContent=`${i?"+":""}${e.toFixed(2)} (${i?"+":""}${a.toFixed(2)}%)`,s.style.color=i?"#4ade80":"#e94560"}}updateExpirySelect(){const t=document.getElementById("expirySelect");t&&(t.innerHTML=this.expirationDates.map(s=>{const a=new Date(s*1e3).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});return`<option value="${s}">${a}</option>`}).join(""))}updateStatus(t,s){const e=document.getElementById("statusText"),a=document.getElementById("statusDot");e&&(e.textContent=t,e.style.color=s),a&&(a.style.background=s)}getHeatmapClass(t){if(!this.showHeatmap)return"";const s=t.volume||0,e=t.openInterest||1,a=s/e;return a>3?"unusual-volume heatmap-5":a>2?"heatmap-5":a>1?"heatmap-4":a>.5?"heatmap-3":a>.2?"heatmap-2":"heatmap-1"}renderCallsTable(t){const s=document.getElementById("callsTable");if(!s)return;if(t.length===0){s.innerHTML='<p class="no-data">No calls available</p>';return}const e=this.filterNearMoney(t),a=this.showGreeks?"<th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th>":"";s.innerHTML=`
      <table>
        <thead>
          <tr>
            <th>Strike</th>
            <th>Last</th>
            <th>Bid</th>
            <th>Ask</th>
            <th>Vol</th>
            <th>OI</th>
            <th>IV</th>
            ${a}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${e.map(i=>this.renderOptionRow(i,"call")).join("")}
        </tbody>
      </table>
    `,s.querySelectorAll(".pl-btn").forEach(i=>{i.addEventListener("click",n=>{const o=parseFloat(n.target.dataset.strike),l=e.find(r=>r.strike===o);l&&this.openPlModal(l,"call")})})}renderPutsTable(t){const s=document.getElementById("putsTable");if(!s)return;if(t.length===0){s.innerHTML='<p class="no-data">No puts available</p>';return}const e=this.filterNearMoney(t),a=this.showGreeks?"<th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th>":"";s.innerHTML=`
      <table>
        <thead>
          <tr>
            <th>Strike</th>
            <th>Last</th>
            <th>Bid</th>
            <th>Ask</th>
            <th>Vol</th>
            <th>OI</th>
            <th>IV</th>
            ${a}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${e.map(i=>this.renderOptionRow(i,"put")).join("")}
        </tbody>
      </table>
    `,s.querySelectorAll(".pl-btn").forEach(i=>{i.addEventListener("click",n=>{const o=parseFloat(n.target.dataset.strike),l=e.find(r=>r.strike===o);l&&this.openPlModal(l,"put")})})}filterNearMoney(t){return this.spotPrice?t.filter(s=>{const e=s.strike;return Math.abs(e-this.spotPrice)<=this.spotPrice*.05}).sort((s,e)=>Math.abs(s.strike-this.spotPrice)-Math.abs(e.strike-this.spotPrice)).slice(0,15):t.slice(0,20)}renderOptionRow(t,s){const e=t.strike,a=s==="call"&&e<this.spotPrice||s==="put"&&e>this.spotPrice,i=Math.abs(e-this.spotPrice)<=1;let n=i?"atm":a?"itm":"otm";n+=" "+this.getHeatmapClass(t),(this.currentSignal==="PUT"&&s==="put"||this.currentSignal==="CALL"&&s==="call")&&i&&(n+=" signal-match"+(this.currentSignal==="PUT"?" put-signal":""));const l=this.showGreeks?`
        <td class="greek ${t.delta>0?"positive":"negative"}">${this.formatGreek(t.delta,2)}</td>
        <td class="greek">${this.formatGreek(t.gamma,4)}</td>
        <td class="greek negative">${this.formatGreek(t.theta,2)}</td>
        <td class="greek">${this.formatGreek(t.vega,2)}</td>
      `:"";return`
      <tr class="${n}">
        <td class="strike">${e.toFixed(0)}</td>
        <td>${t.lastPrice?.toFixed(2)||"--"}</td>
        <td>${t.bid?.toFixed(2)||"--"}</td>
        <td>${t.ask?.toFixed(2)||"--"}</td>
        <td>${p(t.volume)}</td>
        <td>${p(t.openInterest)}</td>
        <td>${t.impliedVolatility?(t.impliedVolatility*100).toFixed(1)+"%":"--"}</td>
        ${l}
        <td><button class="pl-btn" data-strike="${e}">P/L</button></td>
      </tr>
    `}formatGreek(t,s){return t==null?"--":t.toFixed(s)}openPlModal(t,s){this.selectedOption={...t,type:s};const e=document.getElementById("plModal"),a=document.getElementById("plType"),i=document.getElementById("plStrike"),n=document.getElementById("plExpiry"),o=document.getElementById("plEntry");if(a&&(a.textContent=s.toUpperCase(),a.className="pl-type "+s),i&&(i.textContent="$"+t.strike.toFixed(0)),n&&this.selectedExpiry){const l=new Date(this.selectedExpiry*1e3);n.textContent=l.toLocaleDateString("en-US",{month:"short",day:"numeric"})}o&&(o.value=t.ask?.toFixed(2)||t.lastPrice?.toFixed(2)||"1.00"),this.updatePlCalculations(),e?.classList.add("active")}closePlModal(){document.getElementById("plModal")?.classList.remove("active"),this.selectedOption=null}updatePlCalculations(){if(!this.selectedOption)return;const t=parseFloat(document.getElementById("plEntry")?.value)||0,s=parseInt(document.getElementById("plContracts")?.value)||1,e=this.selectedOption.strike,a=this.selectedOption.type,i=t*100*s;document.getElementById("plMaxRisk").textContent=`-$${i.toFixed(0)}`;const n=a==="call"?e+t:e-t;document.getElementById("plBreakeven").textContent=`$${n.toFixed(2)}`;const l=[{label:"-3% move",pct:-.03},{label:"-1% move",pct:-.01},{label:"+1% move",pct:.01},{label:"+3% move",pct:.03},{label:"+5% move",pct:.05}].map(r=>{const h=this.spotPrice*(1+r.pct);let d=0;a==="call"?d=Math.max(0,h-e)-t:d=Math.max(0,e-h)-t,d=d*100*s;const u=d>=0?"profit":"loss";return`
        <div class="scenario-row">
          <span class="scenario-label">${r.label}</span>
          <span class="scenario-price">$${h.toFixed(2)}</span>
          <span class="scenario-pl ${u}">${d>=0?"+":""}$${d.toFixed(0)}</span>
        </div>
      `}).join("");document.getElementById("plScenarios").innerHTML=l}}document.addEventListener("DOMContentLoaded",()=>{window.spyOptions=new E});
