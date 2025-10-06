// Universal Deep Profile Scraper
// Save this as deep-scraper.js

(function() {
    // Check if already running
    if (window.deepScraper) {
        alert('Deep Scraper is already running!');
        return;
    }

    // Load PapaParse for CSV export
    const papaScript = document.createElement('script');
    papaScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';
    papaScript.onload = initScraper;
    document.head.appendChild(papaScript);

    function initScraper() {
        // Add CSS styles
        const style = document.createElement('style');
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
                z-index: 999999;
                font-family: sans-serif;
                color: white;
                max-height: 90vh;
                overflow-y: auto;
            }
            #ds-ui h3 {
                margin: 0 0 15px 0;
                font-size: 1.3em;
            }
            #ds-ui button {
                background: white;
                color: #667eea;
                border: none;
                padding: 10px 20px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: bold;
                margin: 5px 0;
                transition: all 0.2s;
                width: 100%;
            }
            #ds-ui button:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            }
            #ds-ui button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .ds-field {
                background: rgba(255,255,255,0.2);
                padding: 10px;
                border-radius: 8px;
                margin: 10px 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .ds-field button {
                width: auto;
                padding: 5px 15px;
                margin: 0;
            }
            .ds-status {
                background: rgba(255,255,255,0.2);
                padding: 15px;
                border-radius: 8px;
                margin: 10px 0;
                font-size: 0.95em;
                line-height: 1.5;
            }
            .highlight-mode * {
                cursor: crosshair !important;
            }
            .ds-highlight {
                outline: 3px solid #ff0;
                background: rgba(255,255,0,0.2) !important;
            }
            .ds-selected {
                outline: 3px solid #4caf50;
                background: rgba(76,175,80,0.2) !important;
            }
            .ds-progress {
                background: rgba(255,255,255,0.3);
                height: 20px;
                border-radius: 10px;
                overflow: hidden;
                margin: 10px 0;
            }
            .ds-progress-fill {
                background: #4caf50;
                height: 100%;
                transition: width 0.3s;
            }
        `;
        document.head.appendChild(style);

        // Create UI
        const ui = document.createElement('div');
        ui.id = 'ds-ui';
        ui.innerHTML = `
            <h3>🔍 Deep Scraper</h3>
            <div id="ds-content">
                <div class="ds-status">
                    👋 Welcome!<br>
                    Stage 1: Collect profile URLs
                </div>
                <button id="ds-select-link">Select Profile Link</button>
                <button id="ds-close" style="background:#ff5252;color:white;">Close</button>
            </div>
        `;
        document.body.appendChild(ui);

        // Initialize state
        window.deepScraper = {
            stage: 'collect',
            linkSelector: null,
            urls: [],
            fields: [],
            currentIndex: 0,
            scrapedData: [],
            preventClicks: false
        };

        // Global click blocker
        const clickBlocker = (e) => {
            if (window.deepScraper.preventClicks && !e.target.closest('#ds-ui')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
            }
        };
        document.addEventListener('click', clickBlocker, true);

        // Helper functions
        function updateUI(html) {
            document.getElementById('ds-content').innerHTML = html;
        }

        function generateSelector(el) {
            if (el.id) return '#' + el.id;
            if (el.className && typeof el.className === 'string') {
                const classes = el.className.trim().split(/\s+/)
                    .filter(c => c && !c.startsWith('ds-'))
                    .join('.');
                if (classes) return el.tagName.toLowerCase() + '.' + classes;
            }
            return el.tagName.toLowerCase();
        }

        async function loadAllPages() {
            let attempts = 0;
            const maxAttempts = 100;
            
            while (attempts < maxAttempts) {
                const loadMoreBtn = Array.from(document.querySelectorAll('button, a')).find(el => {
                    const text = el.textContent.toLowerCase();
                    return text.includes('load more') || 
                           text.includes('show more') || 
                           text.includes('next');
                });
                
                if (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
                    loadMoreBtn.click();
                    await new Promise(r => setTimeout(r, 2000));
                    attempts++;
                } else {
                    break;
                }
            }
        }

        // Stage 1: Select profile link
        document.getElementById('ds-select-link').onclick = () => {
            // Don't use preventClicks here - we just capture the link
            document.body.classList.add('highlight-mode');
            updateUI('<div class="ds-status">🖱️ Click on ANY profile link/name<br>(e.g., click on an attendee\'s name)</div>');

            const listener = (e) => {
                if (e.target.closest('#ds-ui')) return;
                
                // Find the link element
                let linkElement = e.target;
                while (linkElement && linkElement.tagName !== 'A') {
                    linkElement = linkElement.parentElement;
                }

                if (!linkElement || !linkElement.href) {
                    alert('Please click on a link element');
                    return;
                }

                // Stop the navigation ONLY after we've found the link
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                window.deepScraper.linkSelector = generateSelector(linkElement);
                linkElement.classList.add('ds-selected');
                document.removeEventListener('click', listener, true);
                document.removeEventListener('mouseover', hoverListener);
                document.body.classList.remove('highlight-mode');
                collectUrls();
                return false;
            };

            document.addEventListener('click', listener, true);

            // Hover highlight
            const hoverListener = (e) => {
                if (e.target.closest('#ds-ui')) return;
                document.querySelectorAll('.ds-highlight').forEach(el => 
                    el.classList.remove('ds-highlight')
                );
                let linkEl = e.target;
                while (linkEl && linkEl.tagName !== 'A') {
                    linkEl = linkEl.parentElement;
                }
                if (linkEl) linkEl.classList.add('ds-highlight');
            };
            document.addEventListener('mouseover', hoverListener);
            setTimeout(() => document.removeEventListener('mouseover', hoverListener), 30000);
        };

        // Collect all URLs
        async function collectUrls() {
            updateUI('<div class="ds-status">🔄 Collecting profile URLs...</div>');
            
            await loadAllPages();
            
            const links = document.querySelectorAll(window.deepScraper.linkSelector);
            const urls = [...new Set(Array.from(links).map(a => a.href))];
            window.deepScraper.urls = urls;

            updateUI(`
                <div class="ds-status">
                    ✅ Found ${urls.length} unique profiles!<br><br>
                    Ready for Stage 2: Configure fields
                </div>
                <button onclick="window.deepScraper.goToConfig()">Configure Fields</button>
                <button onclick="window.deepScraper.downloadUrls()" style="background:#ff9800;color:white;">Download URL List</button>
                <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
            `);
        }

        // Download URL list
        window.deepScraper.downloadUrls = () => {
            const csv = Papa.unparse([
                { URL: '' },
                ...window.deepScraper.urls.map(url => ({ URL: url }))
            ]);
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `profile-urls-${Date.now()}.csv`;
            a.click();
        };

        // Go to first profile to configure fields
        window.deepScraper.goToConfig = () => {
            if (!window.deepScraper.urls.length) {
                alert('No profile URLs collected!');
                return;
            }
            updateUI('<div class="ds-status">🔄 Opening sample profile...</div>');
            setTimeout(() => {
                window.location.href = window.deepScraper.urls[0];
            }, 1000);
        };

        // Show field configuration UI
        window.deepScraper.showConfigUI = () => {
            window.deepScraper.stage = 'configure';
            updateUI(`
                <div class="ds-status">
                    🎨 Configure Fields<br>
                    Click "+ Add Field" for each data point you need
                </div>
                <div id="ds-fields"></div>
                <button onclick="window.deepScraper.addField()">+ Add Field</button>
                <button onclick="window.deepScraper.startScraping()" id="ds-start" disabled>Start Deep Scrape</button>
                <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
            `);
        };

        // Add field
        window.deepScraper.addField = () => {
            const fieldName = prompt('Enter field name (e.g., Name, Title, Company, Location):');
            if (!fieldName) return;

            const field = { name: fieldName, selector: null };
            window.deepScraper.fields.push(field);
            const fieldIndex = window.deepScraper.fields.length - 1;

            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'ds-field';
            fieldDiv.innerHTML = `
                <span id="field-${fieldIndex}">
                    <strong>${fieldName}:</strong> Not selected
                </span>
                <button onclick="window.deepScraper.selectField(${fieldIndex})">Select</button>
            `;
            document.getElementById('ds-fields').appendChild(fieldDiv);
        };

        // Select field element
        window.deepScraper.selectField = (index) => {
            window.deepScraper.preventClicks = true;
            document.body.classList.add('highlight-mode');

            const listener = (e) => {
                if (e.target.closest('#ds-ui')) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const selector = generateSelector(e.target);
                window.deepScraper.fields[index].selector = selector;
                e.target.classList.add('ds-selected');

                document.getElementById(`field-${index}`).innerHTML = `
                    <strong>${window.deepScraper.fields[index].name}:</strong> ✅ Selected
                `;

                document.removeEventListener('click', listener, true);
                document.body.classList.remove('highlight-mode');
                window.deepScraper.preventClicks = false;

                // Enable start button if at least one field selected
                if (window.deepScraper.fields.some(f => f.selector)) {
                    document.getElementById('ds-start').disabled = false;
                }

                return false;
            };

            document.addEventListener('click', listener, true);

            // Hover highlight
            const hoverListener = (e) => {
                if (e.target.closest('#ds-ui')) return;
                document.querySelectorAll('.ds-highlight').forEach(el => 
                    el.classList.remove('ds-highlight')
                );
                e.target.classList.add('ds-highlight');
            };
            document.addEventListener('mouseover', hoverListener);
            setTimeout(() => document.removeEventListener('mouseover', hoverListener), 30000);
        };

        // Start scraping all profiles
        window.deepScraper.startScraping = async () => {
            if (!window.deepScraper.fields.filter(f => f.selector).length) {
                alert('Please select at least one field!');
                return;
            }

            const totalProfiles = window.deepScraper.urls.length;
            const estimatedMinutes = Math.ceil(totalProfiles * 5 / 60);
            
            const confirmed = confirm(
                `Ready to scrape ${totalProfiles} profiles?\n\n` +
                `Estimated time: ~${estimatedMinutes} minutes\n\n` +
                `Keep this tab open!`
            );
            
            if (!confirmed) return;

            window.deepScraper.stage = 'scraping';
            window.deepScraper.scrapedData = [];
            window.deepScraper.currentIndex = 0;
            scrapeNextProfile();
        };

        // Scrape next profile in sequence
        async function scrapeNextProfile() {
            const index = window.deepScraper.currentIndex;
            const total = window.deepScraper.urls.length;

            // Check if done
            if (index >= total) {
                updateUI('<div class="ds-status">✅ Scraping complete!<br>Downloading CSV...</div>');
                
                const csv = Papa.unparse(window.deepScraper.scrapedData);
                const blob = new Blob([csv], { type: 'text/csv' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `deep-scraped-data-${Date.now()}.csv`;
                a.click();

                setTimeout(() => {
                    updateUI(`
                        <div class="ds-status">
                            🎉 All done!<br><br>
                            CSV downloaded with ${window.deepScraper.scrapedData.length} profiles
                        </div>
                        <button onclick="window.deepScraper.close()">Close</button>
                    `);
                }, 1000);
                return;
            }

            // Show progress
            const progress = Math.round((index / total) * 100);
            updateUI(`
                <div class="ds-status">
                    🔄 Scraping profile ${index + 1}/${total}<br><br>
                    <div class="ds-progress">
                        <div class="ds-progress-fill" style="width:${progress}%"></div>
                    </div>
                    ${progress}% complete
                </div>
            `);

            // Navigate to profile
            const url = window.deepScraper.urls[index];
            window.location.href = url;

            // Wait for page load, then extract data
            setTimeout(() => {
                const row = { URL: url };
                
                window.deepScraper.fields.forEach(field => {
                    if (!field.selector) return;
                    
                    try {
                        const el = document.querySelector(field.selector);
                        row[field.name] = el ? el.textContent.trim() : '';
                    } catch (e) {
                        row[field.name] = '';
                    }
                });

                window.deepScraper.scrapedData.push(row);
                window.deepScraper.currentIndex++;

                // Move to next profile after delay
                setTimeout(scrapeNextProfile, 2000);
            }, 3000);
        }

        // Close scraper
        window.deepScraper.close = () => {
            ui.remove();
            style.remove();
            document.removeEventListener('click', clickBlocker, true);
            delete window.deepScraper;
        };

        // Wire up close button
        document.getElementById('ds-close').onclick = window.deepScraper.close;

        // Auto-detect if we're on a profile page (returning from URL collection)
        if (window.deepScraper.urls && window.deepScraper.urls.length > 0 && window.deepScraper.stage === 'collect') {
            updateUI(`
                <div class="ds-status">
                    ✅ Returning to scraper...<br>
                    Found ${window.deepScraper.urls.length} profiles
                </div>
                <button onclick="window.deepScraper.showConfigUI()">Configure Fields</button>
                <button onclick="window.deepScraper.close()" style="background:#ff5252;color:white;">Close</button>
            `);
        }
    }
})();
