// Universal Deep Profile Scraper
// Save this as deep-scraper.js

(function () {
  // Prevent double-run
  if (window.deepScraper && window.deepScraper.__alive) {
    alert("Deep Scraper is already running!");
    return;
  }

  // --- Load PapaParse for CSV export ---
  const papaScript = document.createElement("script");
  papaScript.src = "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js";
  papaScript.onload = initScraper;
  document.head.appendChild(papaScript);

  function initScraper() {
    // --- State bootstrap ---
    const state = (window.deepScraper = {
      __alive: true,
      stage: "collect",
      linkSelector: null,
      urls: [],
      fields: [],
      currentIndex: 0,
      scrapedData: [],
      preventClicks: false,
      isSelecting: false, // <-- NEW: allows selection clicks to pass through
    });

    // --- Styles (idempotent) ---
    let style = document.getElementById("ds-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "ds-style";
      style.textContent = `
        #ds-ui {
          position: fixed;
          top: 20px;
          right: 20px;
          width: 400px;
          background: linear-gradient(135deg, #667eea, #764ba2);
          border-radius: 15px;
          padding: 20px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
          z-index: 2147483647;
          font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;
          color: white;
          max-height: 90vh;
          overflow-y: auto;
        }
        #ds-ui h3 { margin: 0 0 15px 0; font-size: 1.3em; }
        #ds-ui button {
          background: white; color: #667eea; border: none;
          padding: 10px 20px; border-radius: 8px; cursor: pointer;
          font-weight: bold; margin: 5px 0; transition: all 0.2s; width: 100%;
        }
        #ds-ui button:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
        #ds-ui button:disabled { opacity: 0.5; cursor: not-allowed; }
        .ds-field {
          background: rgba(255,255,255,0.2); padding: 10px; border-radius: 8px;
          margin: 10px 0; display: flex; justify-content: space-between; align-items: center;
        }
        .ds-field button { width: auto; padding: 5px 15px; margin: 0; }
        .ds-status { background: rgba(255,255,255,0.2); padding: 15px; border-radius: 8px; margin: 10px 0; font-size: 0.95em; line-height: 1.5; }
        .highlight-mode * { cursor: crosshair !important; }
        .ds-highlight { outline: 3px solid #ff0; background: rgba(255,255,0,0.2) !important; }
        .ds-selected { outline: 3px solid #4caf50; background: rgba(76,175,80,0.2) !important; }
        .ds-progress { background: rgba(255,255,255,0.3); height: 20px; border-radius: 10px; overflow: hidden; margin: 10px 0; }
        .ds-progress-fill { background: #4caf50; height: 100%; transition: width 0.3s; }
      `;
      document.head.appendChild(style);
    }

    // --- UI creation (idempotent) ---
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
        </div>
      `;
      document.body.appendChild(ui);
      wireBaseButtons();
      return ui;
    }
    const ui = ensureUI();

    // --- Safer global click blocker (FIX #2) ---
    // Previously: stopImmediatePropagation() blocked our own selection handler.
    const clickBlocker = (e) => {
      if (!state.preventClicks) return;
      if (state.isSelecting) return; // allow selection clicks to reach our handler
      if (e.target.closest("#ds-ui")) return; // never block UI
      e.preventDefault();
      e.stopPropagation();
      // DO NOT call stopImmediatePropagation, so late listeners (ours) can still run if needed
      return false;
    };
    // Register once
    if (!document.__dsClickBlockerBound) {
      document.addEventListener("click", clickBlocker, true);
      document.__dsClickBlockerBound = true;
    }

    // --- Helpers ---
    function updateUI(html) {
      ensureUI();
      document.getElementById("ds-content").innerHTML = html;
    }

    function generateSelector(el) {
      // Slightly stronger selector: prefer id; else tag + classes + nth-of-type
      if (el.id) return `#${CSS.escape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const classes = (el.className && typeof el.className === "string")
        ? el.className.trim().split(/\s+/).filter(c => c && !c.startsWith("ds-")).map(CSS.escape).join(".")
        : "";
      let base = classes ? `${tag}.${classes}` : tag;
      // Add nth-of-type for a bit more specificity (avoid overmatching)
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(n => n.tagName === el.tagName);
        const idx = siblings.indexOf(el);
        if (idx > -1) base += `:nth-of-type(${idx + 1})`;
      }
      return base;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function loadAllPages() {
      let attempts = 0, maxAttempts = 100;
      while (attempts < maxAttempts) {
        const loadMoreBtn = Array.from(document.querySelectorAll("button, a")).find(el => {
          const text = (el.textContent || "").toLowerCase();
          return text.includes("load more") || text.includes("show more") || text.includes("next");
        });
        if (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
          loadMoreBtn.click();
          await sleep(2000);
          attempts++;
        } else break;
      }
    }

    function persist() {
      localStorage.setItem("deepScraperUrls", JSON.stringify(state.urls || []));
      localStorage.setItem("deepScraperStage", state.stage || "");
      localStorage.setItem("deepScraperFields", JSON.stringify(state.fields || []));
      localStorage.setItem("deepScraperData", JSON.stringify(state.scrapedData || []));
      localStorage.setItem("deepScraperIndex", String(state.currentIndex || 0));
    }

    // --- Stage 1: Select profile link ---
    function startSelectLink() {
      document.body.classList.add("highlight-mode");
      updateUI(`<div class="ds-status">🖱️ Click on ANY profile link/name<br>(e.g., click on an attendee's name)</div>`);

      const hoverListener = (e) => {
        if (e.target.closest("#ds-ui")) return;
        document.querySelectorAll(".ds-highlight").forEach(el => el.classList.remove("ds-highlight"));
        let linkEl = e.target;
        while (linkEl && linkEl.tagName !== "A") linkEl = linkEl.parentElement;
        if (linkEl) linkEl.classList.add("ds-highlight");
      };
      document.addEventListener("mouseover", hoverListener);

      const clickListener = (e) => {
        if (e.target.closest("#ds-ui")) return;
        let linkElement = e.target;
        while (linkElement && linkElement.tagName !== "A") linkElement = linkElement.parentElement;
        if (!linkElement || !linkElement.href) {
          alert("Please click on a link element");
          return;
        }
        e.preventDefault();
        e.stopPropagation();

        state.linkSelector = generateSelector(linkElement);
        linkElement.classList.add("ds-selected");
        document.removeEventListener("click", clickListener, true);
        document.removeEventListener("mouseover", hoverListener);
        document.body.classList.remove("highlight-mode");

        collectUrls().catch(console.error);
      };
      document.addEventListener("click", clickListener, true);
    }

    async function collectUrls() {
      updateUI(`<div class="ds-status">🔄 Collecting profile URLs...</div>`);
      await loadAllPages();

      const links = document.querySelectorAll(state.linkSelector);
      const urls = [...new Set(Array.from(links).map(a => a.href))];
      state.urls = urls;

      state.stage = "configure";
      persist();

      updateUI(`
        <div class="ds-status">✅ Found ${urls.length} unique profiles!<br><br>Ready for Stage 2: Configure fields</div>
        <button onclick="window.deepScraper.goToConfig()">Configure Fields</button>
        <button onclick="window.deepScraper.downloadUrls()" style="background:#ff9800;color:white;">Download URL List</button>
        <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
      `);
    }

    // --- Downloads ---
    state.downloadUrls = () => {
      const rows = state.urls.map(url => ({ URL: url }));
      const csv = Papa.unparse([{ URL: "" }, ...rows]);
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `profile-urls-${Date.now()}.csv`;
      a.click();
    };

    // --- Nav to first profile (cannot persist code across real nav; we auto-restore next load) ---
    state.goToConfig = () => {
      if (!state.urls.length) { alert("No profile URLs collected!"); return; }
      state.stage = "configure";
      persist();
      updateUI(`<div class="ds-status">🔄 Opening sample profile...</div>`);
      setTimeout(() => { window.location.href = state.urls[0]; }, 300);
    };

    // --- Phase 2 UI ---
    state.showConfigUI = () => {
      state.stage = "configure";
      persist();
      updateUI(`
        <div class="ds-status">🎨 Configure Fields<br>Click "+ Add Field" for each data point you need</div>
        <div id="ds-fields"></div>
        <button id="ds-add">+ Add Field</button>
        <button id="ds-start" disabled>Start Deep Scrape</button>
        <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
      `);

      document.getElementById("ds-add").onclick = state.addField;

      // Render existing fields
      const container = document.getElementById("ds-fields");
      (state.fields || []).forEach((field, index) => {
        const div = document.createElement("div");
        div.className = "ds-field";
        div.innerHTML = `
          <span id="field-${index}">
            <strong>${field.name}:</strong> ${field.selector ? "✅ Selected" : "Not selected"}
          </span>
          <button data-idx="${index}" class="ds-select-btn">Select</button>
        `;
        container.appendChild(div);
      });
      container.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".ds-select-btn");
        if (!btn) return;
        const idx = parseInt(btn.getAttribute("data-idx"));
        state.selectField(idx);
      });

      // Enable start if any selected
      if ((state.fields || []).some(f => f.selector)) {
        document.getElementById("ds-start").disabled = false;
      }
      document.getElementById("ds-start").onclick = state.startScraping;
    };

    state.addField = () => {
      const fieldName = prompt("Enter field name (e.g., Name, Title, Company, Location):");
      if (!fieldName) return;
      const field = { name: fieldName, selector: null };
      state.fields.push(field);
      persist();

      // Re-render line
      const container = document.getElementById("ds-fields");
      const index = state.fields.length - 1;
      const div = document.createElement("div");
      div.className = "ds-field";
      div.innerHTML = `
        <span id="field-${index}">
          <strong>${fieldName}:</strong> Not selected
        </span>
        <button data-idx="${index}" class="ds-select-btn">Select</button>
      `;
      container.appendChild(div);
    };

    // --- FIX #2: Selection mode that bypasses global blocker ---
    state.selectField = (index) => {
      state.preventClicks = true;
      state.isSelecting = true;            // allow our selection click to go through
      document.body.classList.add("highlight-mode");

      const hoverListener = (e) => {
        if (e.target.closest("#ds-ui")) return;
        document.querySelectorAll(".ds-highlight").forEach(el => el.classList.remove("ds-highlight"));
        e.target.classList.add("ds-highlight");
      };
      document.addEventListener("mouseover", hoverListener);

      const clickListener = (e) => {
        if (e.target.closest("#ds-ui")) return;
        e.preventDefault();
        e.stopPropagation();

        const selector = generateSelector(e.target);
        state.fields[index].selector = selector;
        e.target.classList.add("ds-selected");

        const span = document.getElementById(`field-${index}`);
        if (span) span.innerHTML = `<strong>${state.fields[index].name}:</strong> ✅ Selected`;

        document.removeEventListener("click", clickListener, true);
        document.removeEventListener("mouseover", hoverListener);
        document.body.classList.remove("highlight-mode");
        state.isSelecting = false;
        state.preventClicks = false;

        persist();

        const startBtn = document.getElementById("ds-start");
        if (startBtn) startBtn.disabled = !(state.fields || []).some(f => f.selector);
        return false;
      };

      document.addEventListener("click", clickListener, true);
    };

    // --- Stage 3: scrape ---
    state.startScraping = async () => {
      if (!(state.fields || []).some(f => f.selector)) {
        alert("Please select at least one field!");
        return;
      }
      const total = state.urls.length;
      const estimatedMinutes = Math.ceil((total * 5) / 60);
      if (!confirm(`Ready to scrape ${total} profiles?\n\nEstimated time: ~${estimatedMinutes} minutes\n\nKeep this tab open!`)) {
        return;
      }
      state.stage = "scraping";
      state.scrapedData = [];
      state.currentIndex = 0;
      persist();
      scrapeNextProfile();
    };

    async function scrapeNextProfile() {
      const index = state.currentIndex;
      const total = state.urls.length;

      if (index >= total) {
        updateUI(`<div class="ds-status">✅ Scraping complete!<br>Downloading CSV...</div>`);
        const csv = Papa.unparse(state.scrapedData);
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `deep-scraped-data-${Date.now()}.csv`;
        a.click();

        // Clear progress keys (keep urls/fields for reruns)
        localStorage.removeItem("deepScraperStage");
        localStorage.removeItem("deepScraperData");
        localStorage.removeItem("deepScraperIndex");

        setTimeout(() => {
          updateUI(`
            <div class="ds-status">🎉 All done!<br><br>CSV downloaded with ${state.scrapedData.length} profiles</div>
            <button onclick="window.deepScraper.close()">Close</button>
          `);
        }, 600);
        return;
      }

      const progress = Math.round((index / total) * 100);
      updateUI(`
        <div class="ds-status">
          🔄 Scraping profile ${index + 1}/${total}<br><br>
          <div class="ds-progress"><div class="ds-progress-fill" style="width:${progress}%"></div></div>
          ${progress}% complete
        </div>
      `);

      const url = state.urls[index];
      // Persist BEFORE nav
      persist();
      window.location.href = url;

      // After load (we'll re-enter init, auto-resume below)
      // The code below won't run after real nav; resume logic handles it.
    }

    // --- Close / cleanup ---
    state.close = () => {
      const ui = document.getElementById("ds-ui");
      if (ui) ui.remove();
      // keep stylesheet so highlight classes don't flash on SPA nav; remove if needed:
      // const style = document.getElementById("ds-style"); if (style) style.remove();

      // Clear all localStorage keys (user asked Close)
      localStorage.removeItem("deepScraperUrls");
      localStorage.removeItem("deepScraperStage");
      localStorage.removeItem("deepScraperFields");
      localStorage.removeItem("deepScraperData");
      localStorage.removeItem("deepScraperIndex");

      // Keep blocker bound to avoid duplicates on re-run
      window.deepScraper.__alive = false;
      delete window.deepScraper;
    };

    // --- Wire base buttons (idempotent) ---
    function wireBaseButtons() {
      const sel = document.getElementById("ds-select-link");
      if (sel) sel.onclick = startSelectLink;
      const close = document.getElementById("ds-close");
      if (close) close.onclick = state.close;
    }

    // --- SPA persistence: keep UI alive on route changes (no reload) ---
    (function bindSpaPersistence() {
      if (window.__dsSpaBound) return;
      window.__dsSpaBound = true;

      const dispatch = () => window.dispatchEvent(new Event("ds-urlchange"));
      const origPush = history.pushState;
      history.pushState = function () { origPush.apply(this, arguments); dispatch(); };
      const origReplace = history.replaceState;
      history.replaceState = function () { origReplace.apply(this, arguments); dispatch(); };
      window.addEventListener("popstate", dispatch);

      window.addEventListener("ds-urlchange", () => {
        setTimeout(() => {
          ensureUI(); // re-add if DOM nuked
          wireBaseButtons();
          // if we were in configure/scraping, auto-show relevant UI
          const savedStage = localStorage.getItem("deepScraperStage");
          if (savedStage === "configure") state.showConfigUI();
          else if (savedStage === "scraping") resumeScrapeIfNeeded();
        }, 50);
      });

      // Also watch for big DOM swaps
      const mo = new MutationObserver(() => {
        if (!document.getElementById("ds-ui")) ensureUI();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    })();

    // --- AUTO-RESTORE on new page load (best-effort for full nav) ---
    (function autoRestore() {
      try {
        const savedUrls = localStorage.getItem("deepScraperUrls");
        const savedFields = localStorage.getItem("deepScraperFields");
        const savedStage = localStorage.getItem("deepScraperStage");
        const savedData = localStorage.getItem("deepScraperData");
        const savedIndex = localStorage.getItem("deepScraperIndex");

        if (savedUrls) state.urls = JSON.parse(savedUrls) || [];
        if (savedFields) state.fields = JSON.parse(savedFields) || [];

        // If user navigated to sample profile, immediately show Phase 2 UI (no extra click)
        if (savedStage === "configure" && state.urls.length) {
          state.stage = "configure";
          state.preventClicks = false;
          updateUI(`<div class="ds-status">✅ Ready to configure fields! Found ${state.urls.length} profiles</div>`);
          // Auto-open the config UI right away (so “popup vanishes” issue is gone)
          state.showConfigUI();
          return;
        }

        if (savedStage === "scraping" && savedUrls && savedData && savedIndex) {
          state.stage = "scraping";
          state.preventClicks = false;
          state.scrapedData = JSON.parse(savedData) || [];
          state.currentIndex = parseInt(savedIndex, 10) || 0;
          resumeScrapeIfNeeded();
          return;
        }
      } catch (e) {
        console.warn("DeepScraper autoRestore error:", e);
      }
    })();

    function resumeScrapeIfNeeded() {
      const index = state.currentIndex;
      const total = state.urls.length;
      if (!total) return;
      const progress = Math.round((index / total) * 100);
      updateUI(`
        <div class="ds-status">
          🔄 Resuming... profile ${index + 1}/${total}<br><br>
          <div class="ds-progress"><div class="ds-progress-fill" style="width:${progress}%"></div></div>
          ${progress}% complete
        </div>
      `);

      // Wait a bit for this profile page to render, then extract and move on
      setTimeout(() => {
        try {
          const url = location.href;
          const row = { URL: url };
          (state.fields || []).forEach(field => {
            if (!field.selector) return;
            try {
              const el = document.querySelector(field.selector);
              row[field.name] = el ? el.textContent.trim() : "";
            } catch { row[field.name] = ""; }
          });
          state.scrapedData.push(row);
          state.currentIndex++;
          persist();
        } catch (e) {
          console.warn("DeepScraper resume extraction error:", e);
        }
        // Move to next or finish
        if (state.currentIndex < state.urls.length) {
          setTimeout(() => {
            const nextUrl = state.urls[state.currentIndex];
            persist();
            window.location.href = nextUrl;
          }, 2000);
        } else {
          // Completed
          state.stage = "scraping";
          persist();
          // Trigger completion UI path
          (function finalize() {
            const csv = Papa.unparse(state.scrapedData);
            const blob = new Blob([csv], { type: "text/csv" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `deep-scraped-data-${Date.now()}.csv`;
            a.click();
            localStorage.removeItem("deepScraperStage");
            localStorage.removeItem("deepScraperData");
            localStorage.removeItem("deepScraperIndex");
            updateUI(`
              <div class="ds-status">🎉 All done!<br><br>CSV downloaded with ${state.scrapedData.length} profiles</div>
              <button onclick="window.deepScraper.close()">Close</button>
            `);
          })();
        }
      }, 3000); // allow page render
    }
  }
})();
