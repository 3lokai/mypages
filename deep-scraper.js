// Universal Deep Profile Scraper — GH Pages build (Grip + HLTH fixes)
// - Stage 1: streaming URL collector (works for Load-More & infinite-scroll/virtualized lists)
// - Stage 2: configure fields INSIDE a visible sample-profile iframe (selectors match profile DOM)
// - Selector-click fix (no blocked clicks), blocks selecting inputs/forms/headers
// - "Test selectors (x3)" preview to catch bad selections (e.g., login email showing up)
// - Stage 3: same-origin hidden-iframe scraping (JS-rendered pages), fetch fallback, navigate+resume for cross-origin
//
// Author: GT (3lokai) + ChatGPT
// Version: 2025-10-06c

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
      // Link signature (generalized; NO nth-of-type)
      linkTag: "a",
      linkClassSig: [],
      linkHrefRegex: null,
      linkSelector: null, // derived from the above
      urls: [],
      // Field config lives against PROFILE DOM (iframe)
      fields: [], // [{name, selector}]
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
        #ds-ui{position:fixed;top:20px;right:20px;width:420px;background:linear-gradient(135deg,#667eea,#764ba2);
          border-radius:15px;padding:16px 16px 12px;box-shadow:0 10px 40px rgba(0,0,0,.3);z-index:2147483647;
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;
          color:#fff;max-height:90vh;overflow-y:auto}
        #ds-ui h3{margin:0 0 10px 0;font-size:1.2em}
        #ds-ui button{background:#fff;color:#667eea;border:none;padding:10px 14px;border-radius:8px;cursor:pointer;
          font-weight:700;margin:5px 0;transition:.2s;width:100%}
        #ds-ui button:hover{transform:translateY(-2px);box-shadow:0 4px 10px rgba(0,0,0,.2)}
        #ds-ui button:disabled{opacity:.5;cursor:not-allowed}
        .ds-row{display:flex;gap:8px}
        .ds-col{flex:1}
        .ds-field{background:rgba(255,255,255,.2);padding:10px;border-radius:8px;margin:8px 0;display:flex;justify-content:space-between;align-items:center}
        .ds-field button{width:auto;padding:5px 12px;margin:0}
        .ds-status{background:rgba(255,255,255,.2);padding:12px;border-radius:8px;margin:8px 0;font-size:.95em;line-height:1.5}
        .highlight-mode *{cursor:crosshair!important}
        .ds-highlight{outline:3px solid #ff0;background:rgba(255,255,0,.2)!important}
        .ds-selected{outline:3px solid #4caf50;background:rgba(76,175,80,.2)!important}
        .ds-progress{background:rgba(255,255,255,.3);height:18px;border-radius:10px;overflow:hidden;margin:8px 0}
        .ds-progress-fill{background:#4caf50;height:100%;transition:width .3s}
        #ds-mini{font-size:.85em;opacity:.9;margin-top:6px}
        #ds-preview-wrap{position:fixed;bottom:16px;left:16px;width:560px;height:380px;background:#000;border:2px solid #667eea;border-radius:12px;z-index:2147483646;display:none}
        #ds-preview-head{display:flex;align-items:center;justify-content:space-between;background:#1f1f3a;color:#fff;padding:6px 10px;border-top-left-radius:10px;border-top-right-radius:10px;font-size:.9em}
        #ds-preview-iframe{width:100%;height:calc(100% - 30px);border:0;background:#fff;border-bottom-left-radius:10px;border-bottom-right-radius:10px}
        .ds-badge{display:inline-block;background:#1119;border:1px solid #fff3;color:#fff;padding:2px 6px;border-radius:6px;font-size:.8em;margin-left:6px}
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
      ensurePreview();
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

    // Visible preview iframe (for config)
    function ensurePreview() {
      if (document.getElementById("ds-preview-wrap")) return;
      const wrap = document.createElement("div");
      wrap.id = "ds-preview-wrap";
      wrap.innerHTML = `
        <div id="ds-preview-head">
          <span>Profile Preview <span class="ds-badge">Click elements here to set fields</span></span>
          <div>
            <button id="ds-preview-hide" style="width:auto;background:#fff;color:#667eea;padding:4px 10px;margin:0;border-radius:6px">Hide</button>
          </div>
        </div>
        <iframe id="ds-preview-iframe" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
      `;
      document.body.appendChild(wrap);
      document.getElementById("ds-preview-hide").onclick = () => { wrap.style.display = "none"; };
    }

    function showPreview(url) {
      ensurePreview();
      const wrap = document.getElementById("ds-preview-wrap");
      const ifr = document.getElementById("ds-preview-iframe");
      wrap.style.display = "block";
      ifr.src = url;
      return ifr;
    }

    // ---------- Safe click blocker ----------
    const clickBlocker = (e) => {
      if (!S.preventClicks) return;
      if (S.isSelecting) return;  // allow selection click
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
      // Persist link signature too
      localStorage.setItem("deepScraperLinkSig", JSON.stringify({
        linkTag: S.linkTag, linkClassSig: S.linkClassSig, linkHrefRegex: S.linkHrefRegex ? S.linkHrefRegex.source : null
      }));
    }
    function restoreLinkSig() {
      try {
        const raw = localStorage.getItem("deepScraperLinkSig");
        if (!raw) return;
        const o = JSON.parse(raw);
        if (o && o.linkTag) {
          S.linkTag = o.linkTag;
          S.linkClassSig = Array.isArray(o.linkClassSig) ? o.linkClassSig : [];
          S.linkHrefRegex = o.linkHrefRegex ? new RegExp(o.linkHrefRegex) : null;
        }
      } catch {}
    }
    function generateGeneralLinkSignature(a) {
      // Keep stable classes (drop ones with numbers / hashes)
      const classes = (a.className && typeof a.className === "string")
        ? a.className.trim().split(/\s+/).filter(c => c && !/(\d|_|-{0,1}\d)/.test(c) && !c.startsWith("ds-"))
        : [];
      S.linkTag = "A";
      S.linkClassSig = classes.slice(0, 3); // up to 3 stable classes
      try {
        const u = new URL(a.href, location.href);
        // Build href prefix regex up to id segment
        const prefix = u.origin + u.pathname.replace(/\/[^\/]+$/, "/");
        S.linkHrefRegex = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      } catch {
        S.linkHrefRegex = null;
      }
      S.linkSelector = buildLinkSelector();
    }
    function buildLinkSelector() {
      const tag = S.linkTag ? S.linkTag.toLowerCase() : "a";
      const cls = (S.linkClassSig || []).map(c => "." + CSS.escape(c)).join("");
      return `${tag}${cls}`;
    }

    function generateSelector(el) {
      // Robust selector for profile DOM (NO nth-of-type for links; allowed for fields)
      if (el.id) return `#${CSS.escape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const classes = (el.className && typeof el.className === "string")
        ? el.className.trim().split(/\s+/).filter(c => c && !c.startsWith("ds-")).map(CSS.escape).join(".")
        : "";
      let base = classes ? `${tag}.${classes}` : tag;
      // For fields, add nth-of-type to reduce ambiguity
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
    async function loadAllPagesStreaming(maxIdle=6, stepPx=900, waitMs=700) {
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
        const anchors = document.querySelectorAll(S.linkSelector || "a");
        let added=0;
        anchors.forEach(a=>{
          if (!a || !a.href) return;
          const href = a.href.split("#")[0];
          // filter by href regex if present
          if (S.linkHrefRegex && !S.linkHrefRegex.test(href)) return;
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

      // If we somehow got only 1 URL, relax href filter and re-harvest
      if (seen.size <= 1 && S.linkHrefRegex) {
        const rawPrefix = S.linkHrefRegex.source.replace(/\\\^|\\\$/g,"");
        const shorter = rawPrefix.replace(/[^/]+\/?$/, ""); // drop last segment
        try { S.linkHrefRegex = new RegExp("^" + shorter); } catch { S.linkHrefRegex = null; }
        harvest();
      }

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

        generateGeneralLinkSignature(a);
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
      const urls = await loadAllPagesStreaming();
      S.urls = [...new Set(urls)];
      S.stage = "configure";
      persist();
      updateUI(`
        <div class="ds-status">✅ Found ${S.urls.length} unique profiles!<br><br>Ready for Stage 2</div>
        <div class="ds-row">
          <div class="ds-col"><button onclick="window.deepScraper.goToConfig()">Configure Fields</button></div>
          <div class="ds-col"><button onclick="window.deepScraper.downloadUrls()" style="background:#ff9800;color:white;">Download URLs</button></div>
        </div>
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

    // ---------- Go to config (sample profile in iframe) ----------
    S.goToConfig = () => {
      if (!S.urls.length) { alert("No URLs collected"); return; }
      S.stage = "configure";
      persist();

      updateUI(`
        <div class="ds-status">
          🎨 Configure Fields inside the preview below.<br>
          <b>Rules:</b> Avoid inputs/forms/headers; click text labels next to values.<br>
          Use "Test selectors (x3)" before the full run.
        </div>
        <div id="ds-fields"></div>
        <div class="ds-row">
          <div class="ds-col"><button id="ds-add">+ Add Field</button></div>
          <div class="ds-col"><button id="ds-test" style="background:#00c853;color:#fff;">Test selectors (x3)</button></div>
        </div>
        <button id="ds-start" disabled>Start Deep Scrape</button>
        <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
      `);

      document.getElementById("ds-add").onclick = S.addField;
      document.getElementById("ds-test").onclick = S.testSelectors;
      document.getElementById("ds-start").onclick = S.startScraping;

      renderFieldsList();

      // open first profile in preview for element picking
      const ifr = showPreview(S.urls[0]);
      attachPreviewPickers(ifr);
    };

    function renderFieldsList() {
      const container = document.getElementById("ds-fields");
      container.innerHTML = "";
      (S.fields||[]).forEach((f,i)=>{
        const div=document.createElement("div");
        div.className="ds-field";
        div.innerHTML=`
          <span id="field-${i}"><strong>${f.name}:</strong> ${f.selector ? "✅ Selected" : "Not selected"}</span>
          <div>
            <button data-idx="${i}" class="ds-select-btn">Select</button>
            <button data-idx="${i}" class="ds-del-btn" style="background:#ffdddd;color:#a00">Del</button>
          </div>
        `;
        container.appendChild(div);
      });
      container.addEventListener("click", ev=>{
        const sel = ev.target.closest(".ds-select-btn");
        const del = ev.target.closest(".ds-del-btn");
        if (sel) { const idx = parseInt(sel.getAttribute("data-idx"),10); S.selectFieldInPreview(idx); }
        if (del) {
          const idx = parseInt(del.getAttribute("data-idx"),10);
          S.fields.splice(idx,1);
          persist();
          renderFieldsList();
          refreshStartButton();
        }
      }, { once: true }); // reattach every render
      refreshStartButton();
    }

    function refreshStartButton() {
      const start = document.getElementById("ds-start");
      if (start) start.disabled = !(S.fields||[]).some(f=>f.selector);
    }

    S.addField = () => {
      const name = prompt("Enter field name (e.g., Name, Title, Company, Location):");
      if (!name) return;
      S.fields.push({ name, selector: null });
      persist();
      renderFieldsList();
    };

    function attachPreviewPickers(ifr) {
      const bind = () => {
        try {
          const d = ifr.contentDocument;
          if (!d) { setTimeout(bind, 300); return; }

          // Hover highlight
          const hover = (e) => {
            document.querySelectorAll(".ds-highlight").forEach(x=>x.classList.remove("ds-highlight"));
            // ignore UI-ish elements
            e.target.classList.add("ds-highlight");
          };

          d.addEventListener("mouseover", hover);

          // store to allow removal between selections
          ifr.__dsHover = hover;
        } catch { /* cross-origin? shouldn't happen same-origin */ }
      };
      ifr.addEventListener("load", bind);
      // If already loaded
      bind();
    }

    S.selectFieldInPreview = (index) => {
      const ifr = document.getElementById("ds-preview-iframe");
      if (!ifr || !ifr.contentDocument) { alert("Preview not ready"); return; }

      S.preventClicks = true;
      S.isSelecting = true;

      const d = ifr.contentDocument;

      const click = (e) => {
        e.preventDefault(); e.stopPropagation();

        const t = e.target;
        // Block inputs/forms/headers/login overlays
        const tag = t.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") { alert("Pick a text element, not an input"); return; }
        if (t.closest("form")) { alert("Avoid elements inside forms/login"); return; }
        if (t.getAttribute && /email/i.test(t.getAttribute("type")||"")) { alert("Avoid email fields"); return; }
        if (t.closest("header") || t.closest("[role=dialog]")) { alert("Avoid header/dialog elements"); return; }

        const sel = generateSelector(t);
        S.fields[index].selector = sel;

        const span = document.getElementById(`field-${index}`);
        if (span) span.innerHTML = `<strong>${S.fields[index].name}:</strong> ✅ Selected`;

        cleanup();
        persist();
        refreshStartButton();
      };

      const cleanup = () => {
        try {
          d.removeEventListener("click", click, true);
          document.querySelectorAll(".ds-highlight").forEach(x=>x.classList.remove("ds-highlight"));
        } catch {}
        S.isSelecting = false;
        S.preventClicks = false;
      };

      d.addEventListener("click", click, true);
      alert("In the preview (bottom-left), click the element for this field");
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
        try {
          await scrapeViaHiddenIframeAll();
          finalize();
          return;
        } catch (e) {
          console.warn("Hidden-iframe pipeline failed, fallback to fetch", e);
          await scrapeSameOriginFetchAll();
          finalize();
          return;
        }
      } else {
        scrapeNextProfileNavigate();
      }
    };

    S.testSelectors = async () => {
      if (!(S.fields||[]).some(f=>f.selector)) { alert("Select at least one field first."); return; }
      const n = Math.min(3, S.urls.length);
      const sample = S.urls.slice(0, n);
      const rows = [];
      updateUI(`
        <div class="ds-status">🔎 Testing selectors on ${n} profiles…</div>
        <button id="ds-cancel-test" style="background:#555;color:#fff;">Cancel</button>
      `);
      document.getElementById("ds-cancel-test").onclick = renderPostCollectHome;

      for (let i=0;i<sample.length;i++){
        try { rows.push(await extractViaHiddenIframe(sample[i], S.fields)); }
        catch { rows.push({URL:sample[i], error:"test-failed"}); }
      }

      // Show quick preview
      const htmlRows = rows.map(r=>{
        const cols = (S.fields||[]).map(f=>escapeHtml(r[f.name]||"")).join(" | ");
        return `<div style="background:#ffffff22;margin:4px 0;padding:6px;border-radius:6px">${escapeHtml(r.URL)}<br><small>${cols}</small></div>`;
      }).join("");
      updateUI(`
        <div class="ds-status">
          ✅ Test results (${n}):<br>${htmlRows}
        </div>
        <div class="ds-row">
          <div class="ds-col"><button onclick="window.deepScraper.goToConfig()">Adjust Selectors</button></div>
          <div class="ds-col"><button id="ds-start">Start Deep Scrape</button></div>
        </div>
        <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
      `);
      document.getElementById("ds-start").onclick = S.startScraping;
    };

    function escapeHtml(s){return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));}

    async function scrapeViaHiddenIframeAll() {
      for (let i=0;i<S.urls.length;i++){
        S.currentIndex = i; persist();
        const pct = Math.round((i / S.urls.length) * 100);
        updateUI(progressUI("Scraping (iframe)", i+1, S.urls.length, pct));
        try {
          const row = await extractViaHiddenIframe(S.urls[i], S.fields);
          S.scrapedData.push(row);
        } catch (e) {
          S.scrapedData.push({ URL: S.urls[i], error: String(e) });
        }
        persist();
        await sleep(300);
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

    async function extractViaHiddenIframe(url, fields, maxWaitMs=14000, pollMs=300) {
      return new Promise((resolve, reject) => {
        const ifr = document.createElement("iframe");
        ifr.style.position = "fixed";
        ifr.style.top = "-10000px";
        ifr.style.left = "-10000px";
        ifr.style.width = "800px";
        ifr.style.height = "600px";
        ifr.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
        document.body.appendChild(ifr);

        let done=false;
        const cleanup = () => { try{ifr.remove();}catch{} };

        const fail = (msg) => { if(done) return; done=true; cleanup(); reject(new Error(msg)); };
        const succeed = (row) => { if(done) return; done=true; cleanup(); resolve(row); };

        ifr.onload = () => {
          try {
            const d = ifr.contentDocument;
            const start = Date.now();
            const tryRead = () => {
              try {
                const row = { URL: url };
                let hits=0;
                (fields||[]).forEach(f=>{
                  if (!f.selector) return;
                  let val="";
                  try {
                    const el = d.querySelector(f.selector);
                    // Avoid inputs/forms again in extraction
                    if (el && !el.closest("form") && el.tagName!=="INPUT" && el.tagName!=="TEXTAREA") {
                      val = (el.textContent||"").trim();
                      if (val) hits++;
                    }
                  } catch {}
                  row[f.name] = val;
                });
                if (hits>0) { succeed(row); return; }
                if (Date.now() - start > maxWaitMs) { succeed(row); return; }
                setTimeout(tryRead, pollMs);
              } catch (err) {
                fail("Iframe read error: "+err);
              }
            };
            setTimeout(tryRead, 200);
          } catch (e) {
            fail("Iframe onload error: "+e);
          }
        };

        try { ifr.src = url; } catch (e) { fail("Iframe set src failed: "+e); }
        setTimeout(()=>fail("Iframe global timeout"), maxWaitMs + 5000);
      });
    }

    async function scrapeSameOriginFetchAll() {
      for (let i=0; i<S.urls.length; i++) {
        S.currentIndex = i; persist();
        const pct = Math.round((i / S.urls.length) * 100);
        updateUI(progressUI("Scraping (fetch)", i+1, S.urls.length, pct));
        try {
          const row = await extractFromUrlFetch(S.urls[i], S.fields);
          S.scrapedData.push(row);
        } catch (e) {
          S.scrapedData.push({ URL: S.urls[i], error: String(e) });
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
          if (el && !el.closest("form") && el.tagName!=="INPUT" && el.tagName!=="TEXTAREA") {
            row[f.name] = (el.textContent||"").trim();
          } else row[f.name] = "";
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
      localStorage.removeItem("deepScraperLinkSig");
      window.deepScraper.__alive=false;
      delete window.deepScraper;
      const prev = document.getElementById("ds-preview-wrap"); if (prev) prev.remove();
    };

    function wireBaseButtons() {
      const sel=document.getElementById("ds-select-link"); if (sel) sel.onclick = startSelectLink;
      const close=document.getElementById("ds-close"); if (close) close.onclick = S.close;
    }

    // ---------- SPA persistence ----------
    (function bindSpa() {
      if (window.__dsSpaBound) return; window.__dsSpaBound = true;
      const dispatch = () => window.dispatchEvent(new Event("ds-urlchange"));
      const p = history.pushState; history.pushState = function(){ p.apply(this, arguments); dispatch(); };
      const r = history.replaceState; history.replaceState = function(){ r.apply(this, arguments); dispatch(); };
      window.addEventListener("popstate", dispatch);
      window.addEventListener("ds-urlchange", () => setTimeout(()=>{ ensureUI(); wireBaseButtons(); if (localStorage.getItem("deepScraperStage")==="configure") S.goToConfig(); }, 50));
      const mo = new MutationObserver(()=>{ if(!document.getElementById("ds-ui")) ensureUI(); });
      mo.observe(document.documentElement,{childList:true,subtree:true});
    })();

    // ---------- Auto-resume on full nav (cross-origin fallback path) ----------
    (function autoRestore() {
      try {
        restoreLinkSig();
        const urls = localStorage.getItem("deepScraperUrls");
        const fields = localStorage.getItem("deepScraperFields");
        const stage = localStorage.getItem("deepScraperStage");
        const data = localStorage.getItem("deepScraperData");
        const idx = localStorage.getItem("deepScraperIndex");
        if (urls) S.urls = JSON.parse(urls) || [];
        if (fields) S.fields = JSON.parse(fields) || [];

        if (stage === "configure") { S.stage="configure"; S.preventClicks=false; S.goToConfig(); return; }

        if (stage === "scraping" && urls && idx) {
          S.stage="scraping"; S.preventClicks=false; S.scrapedData = data ? JSON.parse(data) : []; S.currentIndex = parseInt(idx,10)||0;
          setTimeout(()=>{
            try {
              const row = { URL: location.href };
              (S.fields||[]).forEach(f=>{
                if (!f.selector) return;
                try { const el = document.querySelector(f.selector); if (el && !el.closest("form") && el.tagName!=="INPUT" && el.tagName!=="TEXTAREA") row[f.name] = el.textContent.trim(); else row[f.name] = ""; }
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
    function renderPostCollectHome(){
      updateUI(`
        <div class="ds-status">Ready for Stage 2</div>
        <div class="ds-row">
          <div class="ds-col"><button onclick="window.deepScraper.goToConfig()">Configure Fields</button></div>
          <div class="ds-col"><button onclick="window.deepScraper.downloadUrls()" style="background:#ff9800;color:white;">Download URLs</button></div>
        </div>
        <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
      `);
    }
  }
})();
