import{c,f as d,a as s,k as u,i as l,m as o,n as r,s as b}from"./auth-service-C1sNBFma.js";const h=[{id:"dashboard",label:"Dashboard",icon:"📊",href:"../dashboard/"},{id:"spy-options",label:"Options",icon:"📈",href:"../spy-options/"},{id:"backtest",label:"Backtester",icon:"🔬",href:"../backtest/"},{id:"strategies",label:"Strategies",icon:"📖",href:"../strategies/"},{id:"trading",label:"Trading",icon:"💹",href:"../trading/"},{id:"follow-trade",label:"Follow",icon:"🐦",href:"../follow-trade/"}];async function w(a={}){const{activePage:t,containerId:e="sidebar"}=a;let n=document.getElementById(e);n||(n=document.createElement("nav"),n.id=e,n.className="sidebar",document.body.insertBefore(n,document.body.firstChild)),n.innerHTML=g(t),p(),m()}function g(a){return`
    <div class="sidebar-brand">
      <span class="brand-icon">⚡</span>
      <span class="brand-text">OPPUT</span>
    </div>

    <div class="sidebar-nav">
      ${h.map(t=>`
        <a href="${t.href}"
           class="sidebar-link ${t.id===a?"active":""}">
          <span class="sidebar-icon">${t.icon}</span>
          <span class="sidebar-label">${t.label}</span>
        </a>
      `).join("")}
    </div>

    <div class="sidebar-footer">
      <div class="auth-section" id="sidebarAuth">
        <div class="auth-loading">Checking...</div>
      </div>
    </div>
  `}async function p(){const a=document.getElementById("sidebarAuth");if(a)try{(await c()).authenticated?(d({isAuthenticated:!0}),await f(a)):(s(),i(a))}catch{u()?v(a):i(a)}}async function f(a){let t=o();if(!t)try{t=await r(),b(t)}catch{t=null}const e=t?.buying_power?`$${Number(t.buying_power).toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2})}`:"--";a.innerHTML=`
    <div class="auth-badge logged-in">
      <div class="auth-user-info">
        <span class="auth-status-dot connected"></span>
        <span class="auth-label">Connected</span>
      </div>
      <div class="auth-buying-power">
        <span class="bp-label">Buying Power</span>
        <span class="bp-value">${e}</span>
      </div>
      <div class="auth-actions">
        <a href="../login/" class="auth-account-btn">Account</a>
        <button class="auth-logout-btn" id="sidebarLogout">Logout</button>
      </div>
    </div>
  `}function v(a){const t=o(),e=t?.buying_power?`$${Number(t.buying_power).toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2})}`:"--";a.innerHTML=`
    <div class="auth-badge logged-in offline">
      <div class="auth-user-info">
        <span class="auth-status-dot offline"></span>
        <span class="auth-label">Offline</span>
      </div>
      <div class="auth-buying-power">
        <span class="bp-label">Buying Power</span>
        <span class="bp-value">${e}</span>
      </div>
      <div class="auth-actions">
        <a href="../login/" class="auth-account-btn">Account</a>
        <button class="auth-logout-btn" id="sidebarLogout">Logout</button>
      </div>
    </div>
  `}function i(a){a.innerHTML=`
    <a href="../login/" class="auth-login-btn">
      <span class="login-icon">🔐</span>
      <span class="login-text">Login to Robinhood</span>
    </a>
  `}function m(){const a=document.getElementById("sidebarLogout");a&&a.addEventListener("click",async()=>{await l(),s(),i(document.getElementById("sidebarAuth"))})}export{w as i};
