import"./auth-service-C1sNBFma.js";import{i as C}from"./sidebar-QfNGueo9.js";import{a as W,b as w,f as F,c as D,d as R}from"./yahoo-h8dATVuC.js";import{D as B}from"./dailySignal-C5MK__xI.js";import"./indicators-CHBeM_Fw.js";function O(h,e=0){return h==null?"--":Math.abs(h)>=1e6?(h/1e6).toFixed(1)+"M":Math.abs(h)>=1e3?(h/1e3).toFixed(1)+"K":h.toFixed(e)}function H(h,e){let s=0,t=0;for(const c of h){const p=c.openInterest||0;s+=c.strike*p,t+=p}const a=t>0?s/t:0;let i=0,o=0;for(const c of e){const p=c.openInterest||0;i+=c.strike*p,o+=p}const r=o>0?i/o:0,d=s+i,n=t+o,l=n>0?d/n:0;return{callWASP:Math.round(a*100)/100,putWASP:Math.round(r*100)/100,allWASP:Math.round(l*100)/100,totalCallOI:t,totalPutOI:o,putCallRatio:t>0?o/t:0}}function N(h,e){const t=[...new Set([...h.map(n=>n.strike),...e.map(n=>n.strike)])].sort((n,l)=>n-l),a={},i={};for(const n of h)a[n.strike]=n.openInterest||0;for(const n of e)i[n.strike]=n.openInterest||0;const o={};let r=1/0,d=t[0];for(const n of t){let l=0;for(const c of t){const p=a[c]||0,k=i[c]||0;c<n&&(l+=(n-c)*p*100),c>n&&(l+=(c-n)*k*100)}o[n]=l,l<r&&(r=l,d=n)}return{maxPain:d,painByStrike:o,totalPainAtMaxPain:r}}function V(h,e,s){const t={};let a=0;for(const n of h){const l=n.gamma||0,c=n.openInterest||0,p=l*c*100*s;t[n.strike]=(t[n.strike]||0)+p,a+=p}for(const n of e){const l=n.gamma||0,c=n.openInterest||0,p=l*c*100*s*-1;t[n.strike]=(t[n.strike]||0)+p,a+=p}const i=Object.keys(t).map(Number).sort((n,l)=>n-l);let o=s,r=0,d=0;for(let n=0;n<i.length;n++)if(d=r,r+=t[i[n]],d*r<0){o=i[n];break}return{netGEX:Math.round(a),gexByStrike:t,gexFlipLevel:o,volRegime:a>0?"low_vol":"high_vol"}}function X(h,e,s,t){const a=(h-e.allWASP)/e.allWASP*100,i=(h-s)/s*100,o=(h-e.callWASP)/e.callWASP*100,r=(h-e.putWASP)/e.putWASP*100,d=1.5,n=2.5;let l="NEUTRAL",c=0,p=null;return Math.abs(a)>d&&(t.volRegime==="low_vol"?(c=Math.min(100,Math.abs(a)*30),a>0?(l="BEARISH_REVERSION",p={type:"PUT_BUTTERFLY",center:Math.round(e.allWASP),reason:`Spot ${a.toFixed(1)}% above WASP in low-vol regime`}):(l="BULLISH_REVERSION",p={type:"CALL_BUTTERFLY",center:Math.round(e.allWASP),reason:`Spot ${Math.abs(a).toFixed(1)}% below WASP in low-vol regime`})):(c=Math.min(80,Math.abs(a)*20),l="WAIT_FOR_GEX_FLIP",p={type:"WAIT",reason:"High vol regime - wait for GEX to flip positive"})),Math.abs(a)>n&&t.volRegime==="low_vol"&&(c=Math.min(100,c+20),p&&(p.reason+=" [STRONG SIGNAL]")),{spotPrice:h,predictedClose:e.allWASP,resistance:e.callWASP,support:e.putWASP,maxPain:s,deviation:{fromWASP:Math.round(a*100)/100,fromMaxPain:Math.round(i*100)/100,fromCallWASP:Math.round(o*100)/100,fromPutWASP:Math.round(r*100)/100},signal:l,signalStrength:Math.round(c),strategy:p,volRegime:t.volRegime,netGEX:t.netGEX}}function G(h,e,s){const t={};for(const i of h)t[i.strike]||(t[i.strike]={strike:i.strike,callOI:0,putOI:0}),t[i.strike].callOI=i.openInterest||0;for(const i of e)t[i.strike]||(t[i.strike]={strike:i.strike,callOI:0,putOI:0}),t[i.strike].putOI=i.openInterest||0;return Object.values(t).filter(i=>Math.abs(i.strike-s)/s<=.1).sort((i,o)=>i.strike-o.strike)}function T(){const h=new Date,e=h.getFullYear(),s=h.getMonth();let t=new Date(e,s,1),a=0;for(;a<3;)t.getDay()===5?(a++,a<3&&t.setDate(t.getDate()+1)):t.setDate(t.getDate()+1);const i=t.getTime()-h.getTime(),o=Math.ceil(i/(1e3*60*60*24)),r=new Date(t);r.setDate(r.getDate()-4);const d=h>=r&&h<=t;return{isThirdWeek:d,isOpExWeek:d,daysToOpEx:o,opExDate:t.toISOString().split("T")[0]}}const M={LOW:15,MEDIUM:18,HIGH:22,EXTREME:25},A={DEVIATION_THRESHOLD:1,VIX_MAX:15};function L(h){return h<M.LOW?{regime:"LOW",tradeable:!0,confidence:100,description:"Excellent conditions for OI-WASP strategy. Low fear = strong pinning effect."}:h<M.MEDIUM?{regime:"MODERATE",tradeable:!0,confidence:80,description:"Good conditions for butterflies. Moderate vol allows mean reversion."}:h<M.HIGH?{regime:"ELEVATED",tradeable:!1,confidence:40,description:"Elevated VIX - reduce position size or wait. Mean reversion less reliable."}:h<M.EXTREME?{regime:"HIGH",tradeable:!1,confidence:20,description:"High VIX - avoid butterfly spreads. Trend continuation more likely."}:{regime:"EXTREME",tradeable:!1,confidence:0,description:"Extreme fear - OI-WASP strategy not recommended. Wait for VIX to normalize."}}function U({deviation:h,volRegime:e,vix:s,opEx:t}){const a=[];let i=0;const o=100,r=Math.abs(h?.deviation?.fromWASP||0),d=r>=A.DEVIATION_THRESHOLD;a.push({name:"Deviation from WASP",required:!0,met:d,current:`${r.toFixed(2)}%`,target:`>${A.DEVIATION_THRESHOLD}%`,weight:30,explanation:d?`Price deviation ${r.toFixed(2)}% exceeds threshold`:`Need at least ${A.DEVIATION_THRESHOLD}% deviation for entry`}),d&&(i+=30);const n=e==="low_vol";a.push({name:"GEX Regime",required:!0,met:n,current:e,target:"low_vol",weight:25,explanation:n?"Positive GEX - market makers dampen volatility, supporting mean reversion":"Negative GEX - market makers amplify moves, mean reversion less reliable"}),n&&(i+=25);const l=s?.vix||20,c=l<A.VIX_MAX;a.push({name:"VIX Level",required:!0,met:c,current:l.toFixed(1),target:`<${A.VIX_MAX}`,weight:25,explanation:c?`VIX ${l.toFixed(1)} is below optimal threshold - excellent conditions`:`VIX ${l.toFixed(1)} is too high. Backtest showed VIX < ${A.VIX_MAX} produces 50% win rate vs 0% otherwise.`}),c&&(i+=25);const p=t?.isOpExWeek||!1;a.push({name:"OpEx Timing",required:!1,met:p,current:p?"OpEx Week":`${t?.daysToOpEx||"?"}d to OpEx`,target:"OpEx Week",weight:20,explanation:p?"Monthly OpEx week has strongest pinning effect":"Outside OpEx week - pinning effect may be weaker"}),p&&(i+=20);const S=a.filter(E=>E.required).every(E=>E.met);return{conditions:a,allMet:S,score:i,maxScore:o,tradeable:S&&c,confidence:Math.round(i/o*100)}}function q(h,e,s,t,a,i=null,o=null){const r=[],d=[],n=Math.round(s/5)*5,l=(u,m)=>u.find(g=>Math.abs(g.strike-m)<.5),c=Math.abs(a.deviation.fromWASP),p=a.volRegime==="low_vol";if(Math.abs(a.deviation.fromWASP)>1)if(a.deviation.fromWASP<0){const m=n,g=l(h,m);if(g&&g.ask){const $=t.allWASP,x=Math.max(0,$-m-g.ask);r.push({type:"CALL",direction:"bullish",strikes:[m],entry:g.ask,maxProfit:"Unlimited",maxLoss:g.ask*100,breakeven:m+g.ask,riskReward:x>0?(x/g.ask).toFixed(1):"0",confidence:Math.min(90,50+Math.abs(a.deviation.fromWASP)*15),rationale:`Spot $${s.toFixed(2)} is ${Math.abs(a.deviation.fromWASP).toFixed(1)}% below WASP ($${t.allWASP.toFixed(2)}). Mean reversion expected.`,detailedReason:{signal:"BULLISH - Price Below Fair Value",analysis:[`Current spot ($${s.toFixed(2)}) trades ${Math.abs(a.deviation.fromWASP).toFixed(2)}% BELOW the OI-weighted fair value`,`OI-WASP predicts price should converge to $${t.allWASP.toFixed(2)} by expiry`,`Put WASP support at $${t.putWASP.toFixed(2)} provides downside floor`,`Call WASP resistance at $${t.callWASP.toFixed(2)} is the upside target`,p?"LOW VOL regime favors mean reversion - MMs will buy dips":"HIGH VOL regime - consider smaller position size"],theory:'OI-WASP theory: Options market makers hedge delta exposure, creating "gravity" toward high-OI strikes. When price deviates significantly from the weighted average, hedging flows push price back toward equilibrium.',risk:"Risk: News events or trend continuation can override OI-based predictions. Max loss is premium paid."},delta:g.delta,iv:g.impliedVolatility})}}else{const m=n,g=l(e,m);if(g&&g.ask){const $=t.allWASP,x=Math.max(0,m-$-g.ask);r.push({type:"PUT",direction:"bearish",strikes:[m],entry:g.ask,maxProfit:"Unlimited",maxLoss:g.ask*100,breakeven:m-g.ask,riskReward:x>0?(x/g.ask).toFixed(1):"0",confidence:Math.min(90,50+Math.abs(a.deviation.fromWASP)*15),rationale:`Spot $${s.toFixed(2)} is ${a.deviation.fromWASP.toFixed(1)}% above WASP ($${t.allWASP.toFixed(2)}). Mean reversion expected.`,detailedReason:{signal:"BEARISH - Price Above Fair Value",analysis:[`Current spot ($${s.toFixed(2)}) trades ${a.deviation.fromWASP.toFixed(2)}% ABOVE the OI-weighted fair value`,`OI-WASP predicts price should pull back to $${t.allWASP.toFixed(2)} by expiry`,`Call WASP resistance at $${t.callWASP.toFixed(2)} caps upside`,`Put WASP support at $${t.putWASP.toFixed(2)} is the downside target`,p?"LOW VOL regime favors mean reversion - MMs will sell rallies":"HIGH VOL regime - consider smaller position size"],theory:"OI-WASP theory: When price trades above the weighted average OI strike, market maker hedging creates selling pressure. The higher the deviation, the stronger the gravitational pull back to fair value.",risk:"Risk: Strong momentum or bullish news can override OI-based predictions. Max loss is premium paid."},delta:g.delta,iv:g.impliedVolatility})}}if(a.volRegime==="low_vol"&&Math.abs(a.deviation.fromWASP)>1.5){const u=Math.round(t.allWASP/5)*5,m=5;if(a.deviation.fromWASP>0){const g=u+m,$=u-m,x=l(e,g),P=l(e,u),b=l(e,$);if(x&&P&&b&&x.ask&&P.bid&&b.ask){const v=x.ask-2*P.bid+b.ask,f=m-v,I=f/v;v>0&&I>3&&r.push({type:"PUT_BUTTERFLY",direction:"bearish",strikes:[g,u,$],entry:v,maxProfit:f*100,maxLoss:v*100,breakeven:`${(u-f).toFixed(2)} - ${(u+f).toFixed(2)}`,riskReward:I.toFixed(1),confidence:Math.min(85,60+Math.abs(a.deviation.fromWASP)*10),rationale:`Butterfly centered at WASP ($${u}). ${I.toFixed(0)}:1 R:R. Spot needs to reach $${u} by expiry for max profit.`,detailedReason:{signal:"PUT BUTTERFLY - High R:R Mean Reversion Play",analysis:[`Spot ($${s.toFixed(2)}) is ${a.deviation.fromWASP.toFixed(2)}% ABOVE predicted close ($${t.allWASP.toFixed(2)})`,`Butterfly centered at $${u} (nearest $5 strike to WASP)`,`${I.toFixed(0)}:1 Risk/Reward ratio - risk $${(v*100).toFixed(0)} to make $${(f*100).toFixed(0)}`,"LOW VOL regime (positive GEX) - market makers dampen volatility, favoring pinning",`Max profit achieved if SPY closes at exactly $${u} at expiry`,`Profit zone: $${(u-f).toFixed(2)} to $${(u+f).toFixed(2)}`],theory:"Butterfly Strategy: Buy wings, sell body at predicted close. OI-WASP analysis shows price should converge to center strike. Low vol regime reduces whipsaw risk. Strategy from Chinese trading post showed 300% monthly returns using this approach with 9:1 R:R.",risk:"Risk: Price must reach center strike for profit. Time decay hurts if price stays away. Max loss limited to net debit paid."},legs:[{action:"BUY",strike:g,type:"PUT",qty:1},{action:"SELL",strike:u,type:"PUT",qty:2},{action:"BUY",strike:$,type:"PUT",qty:1}]})}}else{const g=u-m,$=u+m,x=l(h,g),P=l(h,u),b=l(h,$);if(x&&P&&b&&x.ask&&P.bid&&b.ask){const v=x.ask-2*P.bid+b.ask,f=m-v,I=f/v;v>0&&I>3&&r.push({type:"CALL_BUTTERFLY",direction:"bullish",strikes:[g,u,$],entry:v,maxProfit:f*100,maxLoss:v*100,breakeven:`${(u-f).toFixed(2)} - ${(u+f).toFixed(2)}`,riskReward:I.toFixed(1),confidence:Math.min(85,60+Math.abs(a.deviation.fromWASP)*10),rationale:`Butterfly centered at WASP ($${u}). ${I.toFixed(0)}:1 R:R. Spot needs to reach $${u} by expiry for max profit.`,detailedReason:{signal:"CALL BUTTERFLY - High R:R Mean Reversion Play",analysis:[`Spot ($${s.toFixed(2)}) is ${Math.abs(a.deviation.fromWASP).toFixed(2)}% BELOW predicted close ($${t.allWASP.toFixed(2)})`,`Butterfly centered at $${u} (nearest $5 strike to WASP)`,`${I.toFixed(0)}:1 Risk/Reward ratio - risk $${(v*100).toFixed(0)} to make $${(f*100).toFixed(0)}`,"LOW VOL regime (positive GEX) - market makers dampen volatility, favoring pinning",`Max profit achieved if SPY closes at exactly $${u} at expiry`,`Profit zone: $${(u-f).toFixed(2)} to $${(u+f).toFixed(2)}`],theory:"Butterfly Strategy: Buy wings, sell body at predicted close. OI-WASP analysis shows price should rise to center strike. Low vol regime reduces whipsaw risk. Strategy from Chinese trading post showed 300% monthly returns using this approach with 9:1 R:R.",risk:"Risk: Price must reach center strike for profit. Time decay hurts if price stays away. Max loss limited to net debit paid."},legs:[{action:"BUY",strike:g,type:"CALL",qty:1},{action:"SELL",strike:u,type:"CALL",qty:2},{action:"BUY",strike:$,type:"CALL",qty:1}]})}}}if(a.volRegime==="low_vol"&&Math.abs(a.deviation.fromWASP)<1){const u=Math.round(t.putWASP/5)*5,m=Math.round(t.callWASP/5)*5;if(m-u>=10){const g=l(e,u),$=l(e,u-5),x=l(h,m),P=l(h,m+5);if(g&&$&&x&&P){const b=(g.bid||0)-($.ask||0),v=(x.bid||0)-(P.ask||0),f=b+v;f>.3&&r.push({type:"IRON_CONDOR",direction:"neutral",strikes:[u-5,u,m,m+5],entry:f,maxProfit:f*100,maxLoss:(5-f)*100,breakeven:`${u-f} - ${m+f}`,riskReward:(f/(5-f)).toFixed(1),confidence:65,rationale:`Low vol regime with spot near WASP. Collect premium if SPY stays between $${u} - $${m}.`,legs:[{action:"BUY",strike:u-5,type:"PUT",qty:1},{action:"SELL",strike:u,type:"PUT",qty:1},{action:"SELL",strike:m,type:"CALL",qty:1},{action:"BUY",strike:m+5,type:"CALL",qty:1}]})}}}const k=i?.vix||null,S=k?L(k):null,E=S?S.tradeable:!0;r.length===0&&(c<1&&d.push({condition:"Insufficient Deviation",status:"NOT MET",current:`${c.toFixed(2)}%`,required:">1.0%",explanation:`Spot ($${s.toFixed(2)}) is only ${c.toFixed(2)}% away from WASP ($${t.allWASP.toFixed(2)}). Need >1% deviation for directional plays, >1.5% for butterfly spreads.`}),p||d.push({condition:"High Vol Regime",status:"CAUTION",current:"Negative GEX",required:"Positive GEX",explanation:"Market is in HIGH VOL regime (negative GEX). Market makers amplify moves rather than dampening them. Mean reversion strategies have lower win rate. Wait for GEX to flip positive."}),k&&!E&&d.push({condition:"VIX Too High",status:"CAUTION",current:k.toFixed(1),required:"<20",explanation:S.description}),c<1.5&&p&&d.push({condition:"Butterfly Threshold",status:"NOT MET",current:`${c.toFixed(2)}%`,required:">1.5%",explanation:`Butterfly spreads require >1.5% deviation for favorable R:R. Current deviation (${c.toFixed(2)}%) is too small. The 9:1 R:R from the strategy requires significant mispricing.`}),o&&!o.isOpExWeek&&d.push({condition:"OpEx Timing",status:"INFO",current:`${o.daysToOpEx}d to OpEx`,required:"OpEx Week",explanation:"Monthly OpEx week (3rd Friday) has the strongest pinning effect. Consider waiting or reducing position size."}),d.push({condition:"Current Market State",status:"INFO",current:"Neutral",required:"N/A",explanation:`SPY at $${s.toFixed(2)} | WASP: $${t.allWASP.toFixed(2)} | Support: $${t.putWASP.toFixed(2)} | Resistance: $${t.callWASP.toFixed(2)} | Vol Regime: ${p?"LOW":"HIGH"}${k?` | VIX: ${k.toFixed(1)}`:""}`}));const y=U({deviation:a,volRegime:p?"low_vol":"high_vol",vix:i,opEx:o});return{suggestions:r.sort((u,m)=>m.confidence-u.confidence),noSuggestionReasons:d,tradeConditions:y,marketContext:{spot:s,wasp:t.allWASP,deviation:c,volRegime:p?"low_vol":"high_vol",support:t.putWASP,resistance:t.callWASP,vix:k,vixRegime:S?.regime||"UNKNOWN",opExWeek:o?.isOpExWeek||!1,daysToOpEx:o?.daysToOpEx||null}}}function _(h,e,s,t=null){const a=H(h,e),{maxPain:i}=N(h,e),o=V(h,e,s),r=X(s,a,i,o),d=G(h,e,s),n=T(),l=q(h,e,s,a,r,t,n),c=t?L(t.vix):null;return{wasp:a,maxPain:i,gex:o,deviation:r,distribution:d,opEx:n,vix:t?{value:t.vix,change:t.change,changePercent:t.changePercent,regime:c?.regime||"UNKNOWN",tradeable:c?.tradeable??!0,description:c?.description||""}:null,suggestions:l.suggestions,noSuggestionReasons:l.noSuggestionReasons,tradeConditions:l.tradeConditions,marketContext:l.marketContext,summary:{predictedClose:a.allWASP,resistance:a.callWASP,support:a.putWASP,maxPain:i,signal:r.signal,signalStrength:r.signalStrength,strategy:r.strategy,volRegime:o.volRegime,vixRegime:c?.regime||null,tradeable:l.tradeConditions?.tradeable??!0}}}class Y{constructor(){this.symbol="SPY",this.spotPrice=null,this.previousClose=null,this.selectedExpiry=null,this.expirationDates=[],this.workerUrl=null,this.currentSignal=null,this.signalStrength=0,this.signalDetails=null,this.currentPosition="NONE",this.showGreeks=!0,this.showHeatmap=!1,this.callsData=[],this.putsData=[],this.selectedOption=null,this.oiAnalysis=null,this.vixData=null,this.signalAnalyzer=new B({minConfluence:60,minIndicatorsAgreeing:3,cooldownHours:4}),this.init()}async init(){console.log("[SPY Options Dashboard] Initializing..."),await C({activePage:"spy-options"}),this.bindEvents(),this.updateOpExBadge(),await Promise.all([this.loadSpotPrice(),this.loadExpirations(),this.loadSignal(),this.loadVIX()])}async loadVIX(){try{this.vixData=await W(this.workerUrl),console.log("[VIX Data]",this.vixData),this.updateVIXDisplay()}catch(e){console.error("[SPY Options] Failed to load VIX:",e),this.vixData=null}}updateVIXDisplay(){const e=document.getElementById("vixValue"),s=document.getElementById("vixBadge");if(this.vixData&&e){e.textContent=this.vixData.vix.toFixed(2);const t=L(this.vixData.vix);s&&(s.textContent=t.regime,s.className=`vix-badge ${t.regime.toLowerCase()}`,s.title=t.description);const a=document.getElementById("vixChange");if(a){const i=this.vixData.change>=0;a.textContent=`${i?"+":""}${this.vixData.change.toFixed(2)} (${i?"+":""}${this.vixData.changePercent.toFixed(1)}%)`,a.className=`vix-change ${i?"up":"down"}`}}}bindEvents(){document.getElementById("expirySelect")?.addEventListener("change",e=>{this.selectedExpiry=parseInt(e.target.value),this.updateQuickExpiryButtons(),this.loadOptionsChain()}),document.querySelectorAll(".expiry-btn").forEach(e=>{e.addEventListener("click",s=>{const t=s.target.dataset.expiry;this.selectQuickExpiry(t)})}),document.getElementById("showGreeks")?.addEventListener("change",e=>{this.showGreeks=e.target.checked,this.renderTables()}),document.getElementById("showHeatmap")?.addEventListener("change",e=>{this.showHeatmap=e.target.checked,this.renderTables()}),document.getElementById("closePlModal")?.addEventListener("click",()=>{this.closePlModal()}),document.getElementById("plModal")?.addEventListener("click",e=>{e.target.id==="plModal"&&this.closePlModal()}),document.getElementById("plEntry")?.addEventListener("input",()=>this.updatePlCalculations()),document.getElementById("plContracts")?.addEventListener("input",()=>this.updatePlCalculations())}async loadSpotPrice(){try{const{price:e,previousClose:s}=await w(this.symbol,this.workerUrl);this.spotPrice=e,this.previousClose=s,this.updatePriceDisplay(),this.updateStatus("Live Data","#4ade80")}catch(e){console.error("[SPY Options] Failed to load spot price:",e),this.updateStatus("Error","#e94560")}}async loadSignal(){try{const e=await F(this.symbol,60);if(e&&e.length>0){const s=this.signalAnalyzer.analyze(e,this.currentPosition),t=this.signalAnalyzer.getSummary(s);this.currentSignal=t.signal,this.signalStrength=t.strength,this.signalDetails=s,this.updateSignalDisplay(t,s),console.log("[Daily Signal]",t.action,"-",t.details)}}catch(e){console.error("[SPY Options] Failed to load signal:",e),this.updateSignalDisplay({signal:"NEUTRAL",action:"Wait",strength:0,details:"Error loading signal"},null)}}updateSignalDisplay(e,s=null){const t=document.getElementById("signalValue"),a=document.getElementById("strengthFill"),i=document.getElementById("strengthText"),o=document.getElementById("signalRecommendation");if(t){const d=e.action||e.signal;t.textContent=d,e.signal==="CALL"?t.className="signal-value call":e.signal==="PUT"?t.className="signal-value put":t.className="signal-value neutral"}const r=e.strength||0;if(a&&(a.style.width=`${r}%`,a.className=r>=60?"strength-fill high":"strength-fill"),i&&(i.textContent=`${r}%`),o){let d=e.details||"Analyzing market conditions...";if(e.indicators&&e.indicators.length>0){const n=e.indicators.map(l=>`${l.indicator}: ${l.reason||l.direction}`).slice(0,3).join(", ");d+=` [${n}]`}s&&s.session&&s.session!=="CLOSED"&&(d+=` (${s.session} session)`),o.textContent=d}}async loadExpirations(){try{const e=await D(this.symbol,this.workerUrl);this.expirationDates=e,this.updateExpirySelect(),e.length>0&&(this.selectedExpiry=e[0],this.updateQuickExpiryButtons(),await this.loadOptionsChain())}catch(e){console.error("[SPY Options] Failed to load expirations:",e)}}selectQuickExpiry(e){const s=new Date,t=new Date(s.getFullYear(),s.getMonth(),s.getDate());let a=null;switch(e){case"0dte":a=this.expirationDates.find(d=>new Date(d*1e3)>=t);break;case"1dte":const i=new Date(t);i.setDate(i.getDate()+1),a=this.expirationDates.find(d=>new Date(d*1e3)>=i);break;case"weekly":const o=new Date(t);o.setDate(o.getDate()+7),a=this.expirationDates.find(d=>{const n=new Date(d*1e3);return n>=t&&n<=o})||this.expirationDates[0];break;case"monthly":const r=new Date(t);r.setDate(r.getDate()+20),a=this.expirationDates.find(d=>new Date(d*1e3)>=r);break}a&&(this.selectedExpiry=a,document.getElementById("expirySelect").value=a,this.updateQuickExpiryButtons(),this.loadOptionsChain())}updateQuickExpiryButtons(){if(document.querySelectorAll(".expiry-btn").forEach(o=>{o.classList.remove("active")}),!this.selectedExpiry)return;const e=new Date,s=new Date(e.getFullYear(),e.getMonth(),e.getDate()),t=new Date(this.selectedExpiry*1e3),a=Math.ceil((t-s)/(1e3*60*60*24));let i=null;a<=0?i="0dte":a===1?i="1dte":a<=7?i="weekly":a>=20&&(i="monthly"),i&&document.querySelector(`.expiry-btn[data-expiry="${i}"]`)?.classList.add("active")}async loadOptionsChain(){if(!this.selectedExpiry)return;const e=document.getElementById("callsTable"),s=document.getElementById("putsTable");e&&(e.innerHTML='<p class="loading">Loading...</p>'),s&&(s.innerHTML='<p class="loading">Loading...</p>');try{const t=await R(this.symbol,this.selectedExpiry,this.workerUrl);t.options?(this.callsData=t.options.calls||[],this.putsData=t.options.puts||[]):(t.calls||t.puts)&&(this.callsData=t.calls||[],this.putsData=t.puts||[]),this.renderTables(),this.runOIAnalysis()}catch(t){console.error("[SPY Options] Failed to load options chain:",t),e&&(e.innerHTML='<p class="error">Failed to load</p>'),s&&(s.innerHTML='<p class="error">Failed to load</p>')}}renderTables(){this.renderCallsTable(this.callsData),this.renderPutsTable(this.putsData)}updatePriceDisplay(){const e=document.getElementById("spotPrice"),s=document.getElementById("priceChange");if(e&&this.spotPrice&&(e.textContent=this.spotPrice.toFixed(2)),s&&this.spotPrice&&this.previousClose){const t=this.spotPrice-this.previousClose,a=t/this.previousClose*100,i=t>=0;s.textContent=`${i?"+":""}${t.toFixed(2)} (${i?"+":""}${a.toFixed(2)}%)`,s.style.color=i?"#4ade80":"#e94560"}}updateExpirySelect(){const e=document.getElementById("expirySelect");e&&(e.innerHTML=this.expirationDates.map(s=>{const a=new Date(s*1e3).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});return`<option value="${s}">${a}</option>`}).join(""))}updateStatus(e,s){const t=document.getElementById("statusText"),a=document.getElementById("statusDot");t&&(t.textContent=e,t.style.color=s),a&&(a.style.background=s)}getHeatmapClass(e){if(!this.showHeatmap)return"";const s=e.volume||0,t=e.openInterest||1,a=s/t;return a>3?"unusual-volume heatmap-5":a>2?"heatmap-5":a>1?"heatmap-4":a>.5?"heatmap-3":a>.2?"heatmap-2":"heatmap-1"}renderCallsTable(e){const s=document.getElementById("callsTable");if(!s)return;if(e.length===0){s.innerHTML='<p class="no-data">No calls available</p>';return}const t=this.filterNearMoney(e),a=this.showGreeks?"<th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th>":"";s.innerHTML=`
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
          ${t.map(i=>this.renderOptionRow(i,"call")).join("")}
        </tbody>
      </table>
    `,s.querySelectorAll(".pl-btn").forEach(i=>{i.addEventListener("click",o=>{const r=parseFloat(o.target.dataset.strike),d=t.find(n=>n.strike===r);d&&this.openPlModal(d,"call")})})}renderPutsTable(e){const s=document.getElementById("putsTable");if(!s)return;if(e.length===0){s.innerHTML='<p class="no-data">No puts available</p>';return}const t=this.filterNearMoney(e),a=this.showGreeks?"<th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th>":"";s.innerHTML=`
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
          ${t.map(i=>this.renderOptionRow(i,"put")).join("")}
        </tbody>
      </table>
    `,s.querySelectorAll(".pl-btn").forEach(i=>{i.addEventListener("click",o=>{const r=parseFloat(o.target.dataset.strike),d=t.find(n=>n.strike===r);d&&this.openPlModal(d,"put")})})}filterNearMoney(e){return this.spotPrice?e.filter(s=>{const t=s.strike;return Math.abs(t-this.spotPrice)<=this.spotPrice*.05}).sort((s,t)=>Math.abs(s.strike-this.spotPrice)-Math.abs(t.strike-this.spotPrice)).slice(0,15):e.slice(0,20)}renderOptionRow(e,s){const t=e.strike,a=s==="call"&&t<this.spotPrice||s==="put"&&t>this.spotPrice,i=Math.abs(t-this.spotPrice)<=1;let o=i?"atm":a?"itm":"otm";o+=" "+this.getHeatmapClass(e),(this.currentSignal==="PUT"&&s==="put"||this.currentSignal==="CALL"&&s==="call")&&i&&(o+=" signal-match"+(this.currentSignal==="PUT"?" put-signal":""));const d=this.showGreeks?`
        <td class="greek ${e.delta>0?"positive":"negative"}">${this.formatGreek(e.delta,2)}</td>
        <td class="greek">${this.formatGreek(e.gamma,4)}</td>
        <td class="greek negative">${this.formatGreek(e.theta,2)}</td>
        <td class="greek">${this.formatGreek(e.vega,2)}</td>
      `:"";return`
      <tr class="${o}">
        <td class="strike">${t.toFixed(0)}</td>
        <td>${e.lastPrice?.toFixed(2)||"--"}</td>
        <td>${e.bid?.toFixed(2)||"--"}</td>
        <td>${e.ask?.toFixed(2)||"--"}</td>
        <td>${O(e.volume)}</td>
        <td>${O(e.openInterest)}</td>
        <td>${e.impliedVolatility?(e.impliedVolatility*100).toFixed(1)+"%":"--"}</td>
        ${d}
        <td><button class="pl-btn" data-strike="${t}">P/L</button></td>
      </tr>
    `}formatGreek(e,s){return e==null?"--":e.toFixed(s)}openPlModal(e,s){this.selectedOption={...e,type:s};const t=document.getElementById("plModal"),a=document.getElementById("plType"),i=document.getElementById("plStrike"),o=document.getElementById("plExpiry"),r=document.getElementById("plEntry");if(a&&(a.textContent=s.toUpperCase(),a.className="pl-type "+s),i&&(i.textContent="$"+e.strike.toFixed(0)),o&&this.selectedExpiry){const d=new Date(this.selectedExpiry*1e3);o.textContent=d.toLocaleDateString("en-US",{month:"short",day:"numeric"})}r&&(r.value=e.ask?.toFixed(2)||e.lastPrice?.toFixed(2)||"1.00"),this.updatePlCalculations(),t?.classList.add("active")}closePlModal(){document.getElementById("plModal")?.classList.remove("active"),this.selectedOption=null}updatePlCalculations(){if(!this.selectedOption)return;const e=parseFloat(document.getElementById("plEntry")?.value)||0,s=parseInt(document.getElementById("plContracts")?.value)||1,t=this.selectedOption.strike,a=this.selectedOption.type,i=e*100*s;document.getElementById("plMaxRisk").textContent=`-$${i.toFixed(0)}`;const o=a==="call"?t+e:t-e;document.getElementById("plBreakeven").textContent=`$${o.toFixed(2)}`;const d=[{label:"-3% move",pct:-.03},{label:"-1% move",pct:-.01},{label:"+1% move",pct:.01},{label:"+3% move",pct:.03},{label:"+5% move",pct:.05}].map(n=>{const l=this.spotPrice*(1+n.pct);let c=0;a==="call"?c=Math.max(0,l-t)-e:c=Math.max(0,t-l)-e,c=c*100*s;const p=c>=0?"profit":"loss";return`
        <div class="scenario-row">
          <span class="scenario-label">${n.label}</span>
          <span class="scenario-price">$${l.toFixed(2)}</span>
          <span class="scenario-pl ${p}">${c>=0?"+":""}$${c.toFixed(0)}</span>
        </div>
      `}).join("");document.getElementById("plScenarios").innerHTML=d}updateOpExBadge(){const e=T(),s=document.getElementById("opexBadge");s&&(e.isOpExWeek?(s.textContent="OPEX WEEK",s.className="opex-badge opex-week"):e.daysToOpEx<=7?(s.textContent=`${e.daysToOpEx}d to OpEx`,s.className="opex-badge"):(s.textContent=`OpEx ${e.opExDate.slice(5)}`,s.className="opex-badge"))}runOIAnalysis(){if(!this.spotPrice||this.callsData.length===0||this.putsData.length===0){console.log("[OI Analysis] Insufficient data");return}try{this.oiAnalysis=_(this.callsData,this.putsData,this.spotPrice,this.vixData),console.log("[OI Analysis]",this.oiAnalysis.summary),console.log("[Trade Conditions]",this.oiAnalysis.tradeConditions),console.log("[Trade Suggestions]",this.oiAnalysis.suggestions),this.updateOIPanel(),this.renderOIChart(),this.renderTradeSuggestions(),this.renderTradeConditions()}catch(e){console.error("[OI Analysis] Error:",e)}}renderTradeConditions(){const e=document.getElementById("tradeConditions");if(!e||!this.oiAnalysis?.tradeConditions)return;const{conditions:s,score:t,maxScore:a,tradeable:i,confidence:o}=this.oiAnalysis.tradeConditions,r=s.map(n=>{const l=n.met?"met":n.required?"not-met":"optional";return n.met||n.required,`
        <div class="condition-item ${l}">
          <span class="condition-icon">${n.met?"+":n.required?"!":"-"}</span>
          <div class="condition-details">
            <div class="condition-header">
              <span class="condition-name">${n.name}</span>
              <span class="condition-badge ${l}">${n.current}</span>
              <span class="condition-target">(target: ${n.target})</span>
            </div>
            <div class="condition-explanation">${n.explanation}</div>
          </div>
        </div>
      `}).join(""),d=i?"tradeable":"not-tradeable";e.innerHTML=`
      <div class="conditions-header">
        <h3>Trade Conditions</h3>
        <div class="conditions-score">
          <div class="score-bar">
            <div class="score-fill" style="width: ${o}%"></div>
          </div>
          <span class="score-text">${t}/${a} (${o}%)</span>
        </div>
        <span class="tradeable-badge ${d}">${i?"TRADEABLE":"WAIT"}</span>
      </div>
      <div class="conditions-list">
        ${r}
      </div>
    `}updateOIPanel(){if(!this.oiAnalysis)return;const{wasp:e,maxPain:s,gex:t,deviation:a,summary:i}=this.oiAnalysis,o=document.getElementById("oiPredicted"),r=document.getElementById("oiDeviation"),d=document.getElementById("oiResistance"),n=document.getElementById("oiSupport"),l=document.getElementById("oiMaxPain"),c=document.getElementById("oiGEX"),p=document.getElementById("oiPCR");if(o&&(o.textContent=`$${i.predictedClose.toFixed(2)}`),r){const y=a.deviation.fromWASP;r.textContent=`${y>=0?"+":""}${y.toFixed(2)}%`,r.className=`oi-metric-deviation ${y>=0?"positive":"negative"}`}if(d&&(d.textContent=`$${i.resistance.toFixed(2)}`),n&&(n.textContent=`$${i.support.toFixed(2)}`),l&&(l.textContent=`$${i.maxPain}`),c){const y=t.netGEX,u=Math.abs(y)>=1e9?`${(y/1e9).toFixed(1)}B`:Math.abs(y)>=1e6?`${(y/1e6).toFixed(1)}M`:O(y);c.textContent=u}p&&(p.textContent=e.putCallRatio.toFixed(2));const k=document.getElementById("volRegimeBadge");k&&(k.textContent=t.volRegime==="low_vol"?"LOW VOL":"HIGH VOL",k.className=`vol-regime-badge ${t.volRegime.replace("_","-")}`);const S=document.getElementById("oiSignal"),E=document.getElementById("oiStrategy");if(S){const y=i.signal;S.textContent=y.replace(/_/g," "),y.includes("BULLISH")?S.className="oi-signal-value bullish":y.includes("BEARISH")?S.className="oi-signal-value bearish":S.className="oi-signal-value"}if(E&&i.strategy){const y=i.strategy;y.type==="WAIT"?E.innerHTML=y.reason:E.innerHTML=`
          <strong>${y.type.replace(/_/g," ")}</strong> centered at <strong>$${y.center}</strong><br>
          ${y.reason}
        `}else E&&(E.textContent="No significant deviation detected. Monitor for entry opportunities.")}renderOIChart(){if(!this.oiAnalysis)return;const{distribution:e,wasp:s}=this.oiAnalysis,t=document.getElementById("oiChart");if(!t||e.length===0)return;const a=Math.max(...e.map(r=>Math.max(r.callOI,r.putOI)));if(a===0){t.innerHTML='<p class="no-data">No OI data available</p>';return}const i=160,o=e.map(r=>{const d=r.callOI/a*i,n=r.putOI/a*i,l=Math.abs(r.strike-this.spotPrice)<1,c=Math.abs(r.strike-s.allWASP)<1;let p="oi-bar-group";return l&&(p+=" spot"),c&&(p+=" wasp"),`
        <div class="${p}" title="Strike: $${r.strike}
Calls: ${O(r.callOI)}
Puts: ${O(r.putOI)}">
          <div class="oi-bars">
            <div class="oi-bar call" style="height: ${d}px;"></div>
            <div class="oi-bar put" style="height: ${n}px;"></div>
          </div>
          <span class="oi-bar-strike">${r.strike}</span>
        </div>
      `}).join("");t.innerHTML=o}renderTradeSuggestions(){const e=document.getElementById("suggestionsGrid");if(!e)return;const{suggestions:s,noSuggestionReasons:t}=this.oiAnalysis;if(!s||s.length===0){const i=(t||[]).map(o=>{const r=o.status==="NOT MET"?"not-met":o.status==="CAUTION"?"caution":"info";return`
          <div class="no-suggestion-reason ${r}">
            <div class="reason-header">
              <span class="reason-condition">${o.condition}</span>
              <span class="reason-status ${r}">${o.status}</span>
            </div>
            <div class="reason-values">
              <span>Current: <strong>${o.current}</strong></span>
              ${o.required!=="N/A"?`<span>Required: <strong>${o.required}</strong></span>`:""}
            </div>
            <div class="reason-explanation">${o.explanation}</div>
          </div>
        `}).join("");e.innerHTML=`
        <div class="no-suggestions-detail">
          <div class="no-suggestions-header">
            <span class="waiting-icon">~</span>
            <span>No Trade Signals - Here's Why:</span>
          </div>
          <div class="no-suggestions-reasons">
            ${i||"<p>Analyzing market conditions...</p>"}
          </div>
          <div class="no-suggestions-tip">
            <strong>Tip:</strong> The strategy works best when spot price deviates >1.5% from WASP in a LOW VOL (positive GEX) regime.
            Monitor for price moves away from the predicted close.
          </div>
        </div>
      `;return}const a=s.map(i=>{const o=i.type.includes("CALL")?"call":i.type.includes("PUT")?"put":"butterfly",r=i.type.replace(/_/g," ");i.legs?i.legs.map(p=>`<span class="${p.action.toLowerCase()}">${p.action} ${p.strike} ${p.type}</span>`).join('<span class="arrow">/</span>'):`${i.strikes[0]}`;const d=typeof i.entry=="number"?`$${i.entry.toFixed(2)}`:i.entry,n=typeof i.maxProfit=="number"?`+$${i.maxProfit.toFixed(0)}`:i.maxProfit,l=typeof i.maxLoss=="number"?`-$${i.maxLoss.toFixed(0)}`:i.maxLoss,c=typeof i.breakeven=="number"?`$${i.breakeven.toFixed(2)}`:i.breakeven;return`
        <div class="suggestion-card ${o}">
          <div class="suggestion-header">
            <span class="suggestion-type ${o}">${r}</span>
            <span class="suggestion-confidence">Confidence: <span>${i.confidence}%</span></span>
          </div>

          ${i.legs?`
            <div class="suggestion-legs">
              ${i.legs.map(p=>`
                <div class="leg-item ${p.action.toLowerCase()}">
                  <span class="leg-action">${p.action}</span>
                  <span class="leg-qty">${p.qty}x</span>
                  <span class="leg-strike">$${p.strike}</span>
                  <span class="leg-type">${p.type}</span>
                </div>
              `).join("")}
            </div>
          `:`
            <div class="suggestion-strikes">
              <span>$${i.strikes[0]}</span>
              <span class="strike-label">${i.type}</span>
            </div>
          `}

          <div class="suggestion-details">
            <div class="detail-item">
              <span class="detail-label">Entry</span>
              <span class="detail-value">${d}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">R:R</span>
              <span class="detail-value">${i.riskReward}:1</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Max Profit</span>
              <span class="detail-value profit">${n}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Max Loss</span>
              <span class="detail-value loss">${l}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Breakeven</span>
              <span class="detail-value">${c}</span>
            </div>
            ${i.delta?`
              <div class="detail-item">
                <span class="detail-label">Delta</span>
                <span class="detail-value">${i.delta.toFixed(2)}</span>
              </div>
            `:""}
          </div>

          <div class="suggestion-rationale">
            ${i.rationale}
          </div>

          ${i.detailedReason?`
            <div class="suggestion-detailed">
              <div class="detailed-toggle" onclick="this.parentElement.classList.toggle('expanded')">
                <span>View Detailed Analysis</span>
                <span class="toggle-icon">+</span>
              </div>
              <div class="detailed-content">
                <div class="detailed-signal">${i.detailedReason.signal}</div>
                <ul class="detailed-analysis">
                  ${i.detailedReason.analysis.map(p=>`<li>${p}</li>`).join("")}
                </ul>
                <div class="detailed-theory">
                  <strong>Theory:</strong> ${i.detailedReason.theory}
                </div>
                <div class="detailed-risk">
                  <strong>${i.detailedReason.risk}</strong>
                </div>
              </div>
            </div>
          `:""}
        </div>
      `}).join("");e.innerHTML=a}}document.addEventListener("DOMContentLoaded",()=>{window.spyOptions=new Y});
