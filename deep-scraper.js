// Universal Deep Profile Scraper — GH Pages build
// - Stage 1: streaming URL collector (works for "Load more" & infinite scroll/virtualized lists)
// - Stage 2: visual selector pickers (fixed: selector clicks not blocked)
// - Stage 3: same-origin hidden-iframe scrape (JS-rendered pages), fallback to fetch+DOMParser,
//             and final fallback to navigate+resume for cross-origin.
//
// Author: GT (3lokai) + ChatGPT
// Version: 2025-10-06

(function () {
  if (window.deepScraper && window.deepScraper.__alive) {
    alert("Deep Scraper is already running!");
    return;
  }

  const papaScript = document.createElement("script");
  papaScript.src = "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js";
  papaScript.onload = initScraper;
  document.head.appendChild(papaScript);

  function initScraper() {
    const S = (window.deepScraper = {
      __alive: true,
      stage: "collect",
      linkSelector: null,
      urls: [],
      fields: [],
      currentIndex: 0,
      scrapedData: [],
      preventClicks: false,
      isSelecting: false,
      lastError: null,
    });

    // ---------- Styles ----------
    let style = document.getElementById("ds-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "ds-style";
      style.textContent = `
        #ds-ui{position:fixed;top:20px;right:20px;width:400px;background:linear-gradient(135deg,#667eea,#764ba2);
          border-radius:15px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3);z-index:2147483647;
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;
          color:#fff;max-height:90vh;overflow-y:auto}
        #ds-ui h3{margin:0 0 15px 0;font-size:1.3em}
        #ds-ui button{background:#fff;color:#667eea;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;
          font-weight:700;margin:5px 0;transition:.2s;width:100%}
        #ds-ui button:hover{transform:translateY(-2px);box-shadow:0 4px 10px rgba(0,0,0,.2)}
        #ds-ui button:disabled{opacity:.5;cursor:not-allowed}
        .ds-field{background:rgba(255,255,255,.2);padding:10px;border-radius:8px;margin:10px 0;display:flex;justify-content:space-between;align-items:center}
        .ds-field button{width:auto;padding:5px 15px;margin:0}
        .ds-status{background:rgba(255,255,255,.2);padding:15px;border-radius:8px;margin:10px 0;font-size:.95em;line-height:1.5}
        .highlight-mode *{cursor:crosshair!important}
        .ds-highlight{outline:3px solid #ff0;background:rgba(255,255,0,.2)!important}
        .ds-selected{outline:3px solid #4caf50;background:rgba(76,175,80,.2)!important}
        .ds-progress{background:rgba(255,255,255,.3);height:20px;border-radius:10px;overflow:hidden;margin:10px 0}
        .ds-progress-fill{background:#4caf50;height:100%;transition:width .3s}
        #ds-mini{font-size:.85em;opacity:.9;margin-top:8px}
      `;
      document.head.appendChild(style);
    }

    // ---------- UI ----------
    function ensureUI() {
      let ui = document.getElementById("ds-ui");
      if (ui) return ui;
      ui = document.createElement("div");
      ui.id = "ds-ui";
      ui.innerHTML = `
        <h3>🔍 Deep Scraper</h3>
        <div id="ds-content">
          <div class="ds-status">👋 Welcome!<br>Stage 1: Collect profile URLs</div>
          <button id="ds-select-link">Select Profile Link</button>
          <button id="ds-close" style="background:#ff5252;color:white;">Close</button>
          <div id="ds-mini"></div>
        </div>
      `;
      document.body.appendChild(ui);
      wireBaseButtons();
      return ui;
    }
    ensureUI();

    function updateUI(html) {
      ensureUI();
      document.getElementById("ds-content").innerHTML = html;
    }
    function setMini(msg) {
      const m = document.getElementById("ds-mini");
      if (m) m.textContent = msg || "";
    }

    // ---------- Safe click blocker ----------
    const clickBlocker = (e) => {
      if (!S.preventClicks) return;
      if (S.isSelecting) return;            // allow selection click through
      if (e.target.closest("#ds-ui")) return;
      e.preventDefault();
      e.stopPropagation();
      return false;
    };
    if (!document.__dsClickBlockerBound) {
      document.addEventListener("click", clickBlocker, true);
      document.__dsClickBlockerBound = true;
    }

    // ---------- Helpers ----------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    function persist() {
      localStorage.setItem("deepScraperUrls", JSON.stringify(S.urls || []));
      localStorage.setItem("deepScraperStage", S.stage || "");
      localStorage.setItem("deepScraperFields", JSON.stringify(S.fields || []));
      localStorage.setItem("deepScraperData", JSON.stringify(S.scrapedData || []));
      localStorage.setItem("deepScraperIndex", String(S.currentIndex || 0));
    }
    function generateSelector(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const classes = (el.className && typeof el.className === "string")
        ? el.className.trim().split(/\s+/).filter(c => c && !c.startsWith("ds-")).map(CSS.escape).join(".")
        : "";
      let base = classes ? `${tag}.${classes}` : tag;
      const p = el.parentElement;
      if (p) {
        const sib = Array.from(p.children).filter(n => n.tagName === el.tagName);
        const idx = sib.indexOf(el);
        if (idx > -1) base += `:nth-of-type(${idx + 1})`;
      }
      return base;
    }

    // ---------- Collector: Load-More + Infinite Scroll ----------
    function getScrollableRoot() {
      const cands = Array.from(document.querySelectorAll("body, *")).filter(el => {
        const cs = getComputedStyle(el);
        if (!/(auto|scroll)/.test(cs.overflowY)) return false;
        return el.scrollHeight > el.clientHeight && el.offsetParent !== null;
      });
      return cands.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0] || document.scrollingElement || document.body;
    }
    async function loadAllPagesStreaming(linkSelector, maxIdle=6, stepPx=900, waitMs=700) {
      // Click any "load more" repeatedly (helps hybrid pages)
      let clicks=0;
      for (;;) {
        const btn = Array.from(document.querySelectorAll("button, a")).find(el=>{
          const t=(el.textContent||"").toLowerCase();
          return ["load more","show more","next"].some(x=>t.includes(x));
        });
        if (btn && btn.offsetParent!==null) { btn.click(); await sleep(900); if (++clicks>200) break; }
        else break;
      }
      const scroller = getScrollableRoot();
      const seen = new Set();
      let idle=0, last=0;

      const harvest = () => {
        const anchors = document.querySelectorAll(linkSelector || "a");
        let added=0;
        anchors.forEach(a=>{
          if (!a || !a.href) return;
          const href = a.href.split("#")[0];
          if (!seen.has(href)) { seen.add(href); added++; }
        });
        return added;
      };

      harvest();
      while (idle<maxIdle) {
        scroller.scrollTo({ top: scroller.scrollTop + stepPx, behavior: "instant" });
        await sleep(waitMs);
        const added = harvest();
        if (seen.size===last && added===0) idle++; else idle=0;
        last = seen.size;
      }
      scroller.scrollTo({ top: 0, behavior: "instant" });
      await sleep(waitMs);
      harvest();
      return Array.from(seen);
    }

    // ---------- Stage 1: choose link ----------
    function startSelectLink() {
      document.body.classList.add("highlight-mode");
      updateUI(`
        <div class="ds-status">🖱️ Click on ANY profile link/name</div>
        <button id="ds-cancel" style="background:#555;color:#fff;">Cancel</button>
      `);
      document.getElementById("ds-cancel").onclick = () => {
        document.body.classList.remove("highlight-mode");
        renderHome();
      };

      const hover = (e) => {
        if (e.target.closest("#ds-ui")) return;
        document.querySelectorAll(".ds-highlight").forEach(x=>x.classList.remove("ds-highlight"));
        let L=e.target; while (L && L.tagName!=="A") L=L.parentElement;
        if (L) L.classList.add("ds-highlight");
      };
      document.addEventListener("mouseover", hover);

      const click = (e) => {
        if (e.target.closest("#ds-ui")) return;
        let a=e.target; while (a && a.tagName!=="A") a=a.parentElement;
        if (!a || !a.href) { alert("Please click a link element"); return; }
        e.preventDefault(); e.stopPropagation();
        S.linkSelector = generateSelector(a);
        a.classList.add("ds-selected");
        document.removeEventListener("click", click, true);
        document.removeEventListener("mouseover", hover);
        document.body.classList.remove("highlight-mode");
        collectUrls().catch(err=>{ S.lastError=String(err); alert("Collect error: "+S.lastError); renderHome(); });
      };
      document.addEventListener("click", click, true);
    }

    async function collectUrls() {
      updateUI(`<div class="ds-status">🔄 Collecting profile URLs...</div>`);
      const urls = await loadAllPagesStreaming(S.linkSelector);
      S.urls = [...new Set(urls)];
      S.stage = "configure";
      persist();
      updateUI(`
        <div class="ds-status">✅ Found ${S.urls.length} unique profiles!<br><br>Ready for Stage 2</div>
        <button onclick="window.deepScraper.goToConfig()">Configure Fields</button>
        <button onclick="window.deepScraper.downloadUrls()" style="background:#ff9800;color:white;">Download URL List</button>
        <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
      `);
    }

    // ---------- Downloads ----------
    S.downloadUrls = () => {
      const csv = Papa.unparse([{URL:""}, ...S.urls.map(u=>({URL:u}))]);
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `profile-urls-${Date.now()}.csv`;
      a.click();
    };

    // ---------- Go to config (no navigation) ----------
    S.goToConfig = () => {
      S.stage = "configure";
      persist();
      S.showConfigUI();
    };

    // ---------- Phase 2 UI ----------
    S.showConfigUI = () => {
      S.stage = "configure";
      persist();
      updateUI(`
        <div class="ds-status">🎨 Configure Fields — click "+ Add Field", then "Select", then click an element on THIS page.</div>
        <div id="ds-fields"></div>
        <button id="ds-add">+ Add Field</button>
        <button id="ds-start" disabled>Start Deep Scrape</button>
        <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
      `);
      document.getElementById("ds-add").onclick = S.addField;

      const container = document.getElementById("ds-fields");
      (S.fields||[]).forEach((f,i)=>{
        const div=document.createElement("div");
        div.className="ds-field";
        div.innerHTML=`
          <span id="field-${i}"><strong>${f.name}:</strong> ${f.selector ? "✅ Selected" : "Not selected"}</span>
          <button data-idx="${i}" class="ds-select-btn">Select</button>
        `;
        container.appendChild(div);
      });
      container.addEventListener("click", ev=>{
        const btn = ev.target.closest(".ds-select-btn"); if (!btn) return;
        const idx = parseInt(btn.getAttribute("data-idx")); S.selectField(idx);
      });

      if ((S.fields||[]).some(f=>f.selector)) document.getElementById("ds-start").disabled = false;
      document.getElementById("ds-start").onclick = S.startScraping;
    };

    S.addField = () => {
      const name = prompt("Enter field name (e.g., Name, Title, Company, Location):");
      if (!name) return;
      S.fields.push({ name, selector: null });
      persist();

      const i = S.fields.length-1;
      const div=document.createElement("div");
      div.className="ds-field";
      div.innerHTML=`
        <span id="field-${i}"><strong>${name}:</strong> Not selected</span>
        <button data-idx="${i}" class="ds-select-btn">Select</button>
      `;
      document.getElementById("ds-fields").appendChild(div);
    };

    // Fixed: selection clicks get through
    S.selectField = (index) => {
      S.preventClicks = true;
      S.isSelecting = true;
      document.body.classList.add("highlight-mode");

      const hover = (e) => {
        if (e.target.closest("#ds-ui")) return;
        document.querySelectorAll(".ds-highlight").forEach(x=>x.classList.remove("ds-highlight"));
        e.target.classList.add("ds-highlight");
      };
      document.addEventListener("mouseover", hover);

      const click = (e) => {
        if (e.target.closest("#ds-ui")) return;
        e.preventDefault(); e.stopPropagation();
        const sel = generateSelector(e.target);
        S.fields[index].selector = sel;
        e.target.classList.add("ds-selected");
        const span = document.getElementById(`field-${index}`);
        if (span) span.innerHTML = `<strong>${S.fields[index].name}:</strong> ✅ Selected`;
        document.removeEventListener("click", click, true);
        document.removeEventListener("mouseover", hover);
        document.body.classList.remove("highlight-mode");
        S.isSelecting = false;
        S.preventClicks = false;
        persist();
        const start = document.getElementById("ds-start");
        if (start) start.disabled = !(S.fields||[]).some(f=>f.selector);
        return false;
      };
      document.addEventListener("click", click, true);
    };

    // ---------- Stage 3: hidden-iframe (same-origin) → fetch fallback → navigate-resume ----------
    S.startScraping = async () => {
      if (!(S.fields||[]).some(f=>f.selector)) { alert("Select at least one field."); return; }
      const total = S.urls.length;
      const mins = Math.ceil((total*5)/60);
      if (!confirm(`Ready to scrape ${total} profiles?\n\nEstimated time: ~${mins} minutes\n\nKeep this tab open!`)) return;

      S.stage = "scraping"; S.scrapedData = []; S.currentIndex = 0; persist();

      const allSameOrigin = S.urls.every(u => (new URL(u, location.href)).origin === location.origin);

      if (allSameOrigin) {
        // Try iframe pipeline (JS-rendered pages)
        try {
          await scrapeViaIframeAll();
          finalize();
          return;
        } catch (e) {
          console.warn("Iframe pipeline failed, falling back to fetch+DOMParser", e);
          await scrapeSameOriginFetchAll();
          finalize();
          return;
        }
      } else {
        // Cross-origin: navigate + auto-resume (requires re-click bookmarklet only if page fully reloads without script)
        scrapeNextProfileNavigate();
      }
    };

    async function scrapeViaIframeAll() {
      for (let i=0; i<S.urls.length; i++) {
        S.currentIndex = i; persist();
        const url = S.urls[i];
        const pct = Math.round((i / S.urls.length) * 100);
        updateUI(progressUI("Scraping (iframe)", i+1, S.urls.length, pct));

        try {
          const row = await extractFromUrlIframe(url, S.fields, /*maxWaitMs=*/12000, /*pollMs=*/300);
          S.scrapedData.push(row);
        } catch (e) {
          console.warn("Iframe scrape error", e);
          // Bubble up to allow switch to fetch pipeline if first failure; but better to just record and continue
          S.scrapedData.push({ URL: url, error: String(e) });
        }
        persist();
        await sleep(400);
      }
    }

    function progressUI(label, n, total, pct) {
      return `
        <div class="ds-status">
          🔄 ${label} ${n}/${total}<br><br>
          <div class="ds-progress"><div class="ds-progress-fill" style="width:${pct}%"></div></div>
          ${pct}% complete
        </div>
      `;
    }

    async function extractFromUrlIframe(url, fields, maxWaitMs=12000, pollMs=300) {
      return new Promise((resolve, reject) => {
        const ifr = document.createElement("iframe");
        ifr.style.position = "fixed";
        ifr.style.top = "-10000px";
        ifr.style.left = "-10000px";
        ifr.style.width = "800px";
        ifr.style.height = "600px";
        ifr.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"); // same-origin access OK
        document.body.appendChild(ifr);

        let done = false;
        const cleanup = () => { ifr.remove(); };

        const fail = (msg) => {
          if (done) return; done = true; cleanup(); reject(new Error(msg));
        };
        const succeed = (row) => {
          if (done) return; done = true; cleanup(); resolve(row);
        };

        // NOTE: ifr.src must be set AFTER append in some browsers for onload to fire reliably
        ifr.onload = () => {
          try {
            const w = ifr.contentWindow;
            const d = ifr.contentDocument;
            // cross-origin guard
            const same = (new URL(url, location.href)).origin === location.origin;
            if (!same) { fail("Cross-origin in iframe"); return; }

            // Wait until at least one field's selector resolves OR timeout
            const start = Date.now();
            const tryRead = () => {
              try {
                const row = { URL: url };
                let anyHit = false;
                (fields||[]).forEach(f=>{
                  if (!f.selector) return;
                  let val = "";
                  try {
                    const el = d.querySelector(f.selector);
                    if (el) { anyHit = true; val = (el.textContent||"").trim(); }
                  } catch {}
                  row[f.name] = val;
                });
                if (anyHit) { succeed(row); return; }
                if (Date.now() - start > maxWaitMs) { succeed(row); return; } // timeout but return what we have
                setTimeout(tryRead, pollMs);
              } catch (err) {
                fail("Iframe read error: "+err);
              }
            };
            // Small delay to allow app JS to mount
            setTimeout(tryRead, 200);
          } catch (e) {
            fail("Iframe onload error: "+e);
          }
        };

        try { ifr.src = url; }
        catch (e) { fail("Iframe set src failed: "+e); }

        // Absolute timeout guard
        setTimeout(()=>fail("Iframe global timeout"), maxWaitMs + 5000);
      });
    }

    async function scrapeSameOriginFetchAll() {
      for (let i=0; i<S.urls.length; i++) {
        S.currentIndex = i; persist();
        const url = S.urls[i];
        const pct = Math.round((i / S.urls.length) * 100);
        updateUI(progressUI("Scraping (fetch)", i+1, S.urls.length, pct));
        try {
          const row = await extractFromUrlFetch(url, S.fields);
          S.scrapedData.push(row);
        } catch (e) {
          S.scrapedData.push({ URL: url, error: String(e) });
        }
        persist();
        await sleep(300);
      }
    }

    async function extractFromUrlFetch(url, fields) {
      const res = await fetch(url, { credentials: "same-origin" });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const row = { URL: url };
      (fields||[]).forEach(f=>{
        if (!f.selector) return;
        try {
          const el = doc.querySelector(f.selector);
          row[f.name] = el ? (el.textContent||"").trim() : "";
        } catch { row[f.name] = ""; }
      });
      return row;
    }

    function scrapeNextProfileNavigate() {
      const i = S.currentIndex;
      const total = S.urls.length;
      if (i >= total) { finalize(); return; }
      const pct = Math.round((i / total) * 100);
      updateUI(progressUI("Scraping (navigate)", i+1, total, pct));
      persist();
      window.location.href = S.urls[i]; // autoRestore below will extract+advance
    }

    function finalize() {
      updateUI(`<div class="ds-status">✅ Scraping complete! Preparing CSV…</div>`);
      const csv = Papa.unparse(S.scrapedData);
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `deep-scraped-data-${Date.now()}.csv`;
      a.click();
      localStorage.removeItem("deepScraperStage");
      localStorage.removeItem("deepScraperData");
      localStorage.removeItem("deepScraperIndex");
      setTimeout(()=>updateUI(`
        <div class="ds-status">🎉 All done!<br><br>CSV downloaded with ${S.scrapedData.length} profiles</div>
        <button onclick="window.deepScraper.close()">Close</button>
      `), 500);
    }

    // ---------- Close ----------
    S.close = () => {
      const ui=document.getElementById("ds-ui"); if (ui) ui.remove();
      localStorage.removeItem("deepScraperUrls");
      localStorage.removeItem("deepScraperStage");
      localStorage.removeItem("deepScraperFields");
      localStorage.removeItem("deepScraperData");
      localStorage.removeItem("deepScraperIndex");
      window.deepScraper.__alive=false;
      delete window.deepScraper;
    };

    function wireBaseButtons() {
      const sel=document.getElementById("ds-select-link"); if (sel) sel.onclick = startSelectLink;
      const close=document.getElementById("ds-close"); if (close) close.onclick = S.close;
    }

    // ---------- SPA persistence (keeps UI visible on route changes) ----------
    (function bindSpa() {
      if (window.__dsSpaBound) return; window.__dsSpaBound = true;
      const dispatch = () => window.dispatchEvent(new Event("ds-urlchange"));
      const p = history.pushState; history.pushState = function(){ p.apply(this, arguments); dispatch(); };
      const r = history.replaceState; history.replaceState = function(){ r.apply(this, arguments); dispatch(); };
      window.addEventListener("popstate", dispatch);
      window.addEventListener("ds-urlchange", () => setTimeout(()=>{ ensureUI(); wireBaseButtons(); if (localStorage.getItem("deepScraperStage")==="configure") S.showConfigUI(); }, 50));
      const mo = new MutationObserver(()=>{ if(!document.getElementById("ds-ui")) ensureUI(); });
      mo.observe(document.documentElement,{childList:true,subtree:true});
    })();

    // ---------- Auto-resume on full nav (cross-origin fallback path) ----------
    (function autoRestore() {
      try {
        const urls = localStorage.getItem("deepScraperUrls");
        const fields = localStorage.getItem("deepScraperFields");
        const stage = localStorage.getItem("deepScraperStage");
        const data = localStorage.getItem("deepScraperData");
        const idx = localStorage.getItem("deepScraperIndex");
        if (urls) S.urls = JSON.parse(urls) || [];
        if (fields) S.fields = JSON.parse(fields) || [];

        if (stage === "configure") { S.stage="configure"; S.preventClicks=false; S.showConfigUI(); return; }

        if (stage === "scraping" && urls && idx) {
          S.stage="scraping"; S.preventClicks=false; S.scrapedData = data ? JSON.parse(data) : []; S.currentIndex = parseInt(idx,10)||0;
          // Extract current page (we're on it), then move on:
          setTimeout(()=>{
            try {
              const row = { URL: location.href };
              (S.fields||[]).forEach(f=>{
                if (!f.selector) return;
                try { const el = document.querySelector(f.selector); row[f.name] = el ? el.textContent.trim() : ""; }
                catch { row[f.name] = ""; }
              });
              S.scrapedData.push(row); S.currentIndex++; persist();
            } catch {}
            if (S.currentIndex < S.urls.length) {
              setTimeout(()=>{ window.location.href = S.urls[S.currentIndex]; }, 1200);
            } else {
              finalize();
            }
          }, 1200);
        }
      } catch(e){ console.warn("autoRestore error", e); }
    })();

    // ---------- Home ----------
    function renderHome() {
      updateUI(`
        <div class="ds-status">👋 Welcome!<br>Stage 1: Collect profile URLs</div>
        <button id="ds-select-link">Select Profile Link</button>
        <button id="ds-close" style="background:#ff5252;color:white;">Close</button>
        <div id="ds-mini"></div>
      `);
      wireBaseButtons();
    }

  }
})();
