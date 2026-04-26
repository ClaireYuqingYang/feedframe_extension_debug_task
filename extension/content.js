// ============================================
// FeedFrame main logic script
// ============================================

// ========== Configuration ==========
const CONFIG = {
  CHECK_INTERVAL: 3000,
  MOCK_MODE: true,
  AROUSAL_THRESHOLD: 0.6,
  MISINFO_THRESHOLD: 0.6,
  TEXT_BLUR_AMOUNT: '8px',
  IMAGE_BLUR_AMOUNT: '12px'
};

// ========== Data Collection System ==========
const DATA_COLLECTION = {
  enabled: true,
  maxEntries: 5000,
  sessionId: generateSessionId(),
  
  // Session tracking
  sessionStartTime: Date.now(),
  newsModeTotalTime: 0,
  entertainmentModeTotalTime: 0,
  currentModeStartTime: Date.now(),
  
  // Toggle tracking
  toggleCount: 0,
  
  // Interaction tracking
  trackedPosts: new Map()  // postId -> interaction data
};

// ============================================
// GLOBAL CONFIG AND VAR
// ============================================

'use strict';

const GLOBAL_TRACKED_POSTS = new Set();

const INTERACTION_DEBOUNCE = new Map();
const DEBOUNCE_TIME = 1000; // 1 second

function shouldRecordGlobalInteraction(postId, actionType) {
  const key = `${postId}-${actionType}`;
  const now = Date.now();
  const lastTime = INTERACTION_DEBOUNCE.get(key);
  
  if (lastTime && (now - lastTime) < DEBOUNCE_TIME) {
    console.log(`[DEBOUNCE] Skipping: ${actionType} on ${postId.substring(0, 8)}`);
    return false;
  }
  
  INTERACTION_DEBOUNCE.set(key, now);
  return true;
}

// Clean duplicated 
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of INTERACTION_DEBOUNCE.entries()) {
    if (now - time > DEBOUNCE_TIME * 2) {
      INTERACTION_DEBOUNCE.delete(key);
    }
  }
}, 10000);

// ========== Generate Session ID ==========
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ========== Session Time Tracking ==========
function updateSessionTime(fromMode) {
  const now = Date.now();
  const duration = now - DATA_COLLECTION.currentModeStartTime;
  
  if (fromMode === 'news') {
    DATA_COLLECTION.newsModeTotalTime += duration;
  } else if (fromMode === 'entertainment') {
    DATA_COLLECTION.entertainmentModeTotalTime += duration;
  }
  
  DATA_COLLECTION.currentModeStartTime = now;
  
  console.log(`Session time updated:`, {
    news: Math.round(DATA_COLLECTION.newsModeTotalTime / 1000) + 's',
    entertainment: Math.round(DATA_COLLECTION.entertainmentModeTotalTime / 1000) + 's'
  });
}

// ========== Log Mode Toggle ==========
function logModeToggle(fromMode, toMode) {
  DATA_COLLECTION.toggleCount++;
  
  updateSessionTime(fromMode);
  
  const entry = {
    timestamp: new Date().toISOString(),
    session_id: DATA_COLLECTION.sessionId,
    action: 'mode_toggle',
    from_mode: fromMode,
    to_mode: toMode,
    toggle_count: DATA_COLLECTION.toggleCount,
    news_mode_time_seconds: Math.round(DATA_COLLECTION.newsModeTotalTime / 1000),
    entertainment_mode_time_seconds: Math.round(DATA_COLLECTION.entertainmentModeTotalTime / 1000)
  };
  
  saveDataEntry(entry);
  console.log('Mode toggle logged:', fromMode, '→', toMode);
}

// ========== Log Post Filtered ==========
function logPostFiltered(postData, scores) {
  if (!DATA_COLLECTION.enabled) return;
  
  const entry = {
    timestamp: new Date().toISOString(),
    session_id: DATA_COLLECTION.sessionId,
    action: 'post_filtered',
    post_id: postData.postId || 'unknown',
    post_url: postData.postUrl || '',
    author_handle: postData.authorHandle || 'unknown',
    text_length: postData.textLength || 0,
    has_images: postData.hasImages || false,
    image_count: postData.imageCount || 0,
    arousal_score: scores.arousal_score.toFixed(3),
    misinfo_score: scores.misinfo_score.toFixed(3),
    engagement_replies: postData.replies || 0,
    engagement_reposts: postData.reposts || 0,
    engagement_likes: postData.likes || 0,
    engagement_total: postData.totalEngagement || 0
  };
  
  saveDataEntry(entry);
  
  // Initialize tracking for this post
  DATA_COLLECTION.trackedPosts.set(postData.postId, {
    filtered_at: Date.now(),
    revealed: false,
    interactions: []
  });
}

// ========== Log Post Revealed ==========
function logPostRevealed(postData, scores) {
  if (!DATA_COLLECTION.enabled) return;
  
  const entry = {
    timestamp: new Date().toISOString(),
    session_id: DATA_COLLECTION.sessionId,
    action: 'post_revealed',
    post_id: postData.postId || 'unknown',
    arousal_score: scores.arousal_score.toFixed(3),
    misinfo_score: scores.misinfo_score.toFixed(3)
  };
  
  saveDataEntry(entry);
  
  // Update tracking
  const tracked = DATA_COLLECTION.trackedPosts.get(postData.postId);
  if (tracked) {
    tracked.revealed = true;
    tracked.revealed_at = Date.now();
    tracked.time_to_reveal = tracked.revealed_at - tracked.filtered_at;
  }
}

// ========== Log Post Interaction ==========
function logPostInteraction(postId, interactionType, details = {}) {
  if (!DATA_COLLECTION.enabled) return;
  
  const entry = {
    timestamp: new Date().toISOString(),
    session_id: DATA_COLLECTION.sessionId,
    action: 'post_interaction',
    post_id: postId,
    interaction_type: interactionType,
    ...details
  };
  
  saveDataEntry(entry);
  console.log('Interaction logged:', interactionType, postId);
  
  // Update tracking
  const tracked = DATA_COLLECTION.trackedPosts.get(postId);
  if (tracked) {
    tracked.interactions.push({
      type: interactionType,
      timestamp: Date.now(),
      ...details
    });
  }
}

// ========== MongoDB Queue ==========
const MONGODB_QUEUE = [];
let mongoSendInterval = null;

// ========== Save to Backend ==========
async function saveToBackend(entry) {
  MONGODB_QUEUE.push(entry);
  console.log(` Queued (${MONGODB_QUEUE.length} pending)`);
  
  if (MONGODB_QUEUE.length >= BACKEND_CONFIG.batchSize) {
    await flushToBackend();
  }
}

// ========== Flush Queue ==========
async function flushToBackend() {
  if (MONGODB_QUEUE.length === 0) {
    return;
  }
  
  const batch = MONGODB_QUEUE.splice(0, BACKEND_CONFIG.batchSize);
  console.log(`Sending ${batch.length} entries to backend...`);
  
  try {
    const response = await fetch(`${BACKEND_CONFIG.apiUrl}/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(batch)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
  } catch (error) {
    console.error('❌ Send failed:', error);
    MONGODB_QUEUE.unshift(...batch);
  }
}

// ========== Start Periodic Flush ==========
function startBackendSync() {
  if (mongoSendInterval) return;
  
  mongoSendInterval = setInterval(() => {
    if (MONGODB_QUEUE.length > 0) {
      flushToBackend();
    }
  }, BACKEND_CONFIG.sendInterval);
}

// ========== Flush on Unload ==========
window.addEventListener('beforeunload', () => {
  if (MONGODB_QUEUE.length > 0) {
    fetch(`${BACKEND_CONFIG.apiUrl}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MONGODB_QUEUE),
      keepalive: true 
    }).catch(err => console.error('Unload send failed:', err));
    
  }
});

// ========== Save Data Entry ==========
function saveDataEntry(entry) {
  saveToBackend(entry);
  
  if (BACKEND_CONFIG.keepLocalBackup) {
    try {
      if (!chrome?.runtime?.id) return;
      
      chrome.storage.local.get(['interactionData'], (result) => {
        if (chrome.runtime.lastError) return;
        
        let data = result.interactionData || [];
        data.push(entry);
        
        if (data.length > BACKEND_CONFIG.maxLocalEntries) {
          data = data.slice(-BACKEND_CONFIG.maxLocalEntries);
        }
        
        chrome.storage.local.set({ interactionData: data });
      });
    } catch (error) {
      console.error('Local backup error:', error);
    }
  }
}

// ========== Save Session Summary on Unload ==========
window.addEventListener('beforeunload', () => {
  updateSessionTime(currentMode);
  
  const summary = {
    timestamp: new Date().toISOString(),
    session_id: DATA_COLLECTION.sessionId,
    action: 'session_end',
    total_session_time_seconds: Math.round((Date.now() - DATA_COLLECTION.sessionStartTime) / 1000),
    news_mode_time_seconds: Math.round(DATA_COLLECTION.newsModeTotalTime / 1000),
    entertainment_mode_time_seconds: Math.round(DATA_COLLECTION.entertainmentModeTotalTime / 1000),
    toggle_count: DATA_COLLECTION.toggleCount,
    posts_filtered: Array.from(DATA_COLLECTION.trackedPosts.values()).filter(p => p.filtered_at).length,
    posts_revealed: Array.from(DATA_COLLECTION.trackedPosts.values()).filter(p => p.revealed).length,
    total_interactions: Array.from(DATA_COLLECTION.trackedPosts.values())
      .reduce((sum, p) => sum + p.interactions.length, 0)
  };
  
  saveDataEntry(summary);
});

// ========== Global State ==========
let currentMode = 'entertainment';
let processedPosts = new Set();
let monitoringInterval = null;

// ========== Initialize ==========
function init() {
  console.log('Initializing FeedFrame...');
  
  // ========== start backend sync ==========
  startBackendSync();
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
}

function setup() {
  chrome.storage.sync.get(['mode'], (result) => {
    currentMode = result.mode || 'entertainment';
    console.log('Current mode:', currentMode);
    
    createFloatingToolbar();  // ← FIXED: Correct function name
    injectSafetyAlertsCard();  // NEW: Inject safety alerts card on 01/13
    
    if (currentMode === 'news') {
      startNewsMode();
    }
  });
}

// ============================================
// Safety Alerts Sidebar Widget (BOTTOM-LEFT, FIXED COLLAPSE)
// ============================================
async function injectSafetyAlertsCard() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[SafetyAlerts] Injecting sidebar widget...');
  
  // Prevent duplicate
  if (document.querySelector('[data-feedframe-type="safety-alerts"]')) {
    console.log('[SafetyAlerts] Widget already exists');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return;
  }

  // Fetch data
  const baseUrl = (typeof BACKEND_CONFIG !== 'undefined' && BACKEND_CONFIG.apiUrl)
    ? BACKEND_CONFIG.apiUrl
    : 'http://localhost:3000/api';

  let json, items = [];
  
  try {
    console.log(`[SafetyAlerts] Fetching from ${baseUrl}/national-alerts...`);
    const resp = await fetch(`${baseUrl}/national-alerts?limit=5`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    json = await resp.json();
    const data = json?.data || {};
    items = [...(data.noaa || []), ...(data.usgs || []), ...(data.fema || [])];
    
    console.log(`[SafetyAlerts] Found ${items.length} alerts`);
  } catch (e) {
    console.warn('[SafetyAlerts] Fetch failed:', e.message);
    return;
  }

  if (!items || items.length === 0) {
    console.log('[SafetyAlerts] No alerts');
    return;
  }

  // Create widget
  const widget = document.createElement('div');
  widget.setAttribute('data-feedframe-type', 'safety-alerts');
  widget.setAttribute('data-ff-whitelist', 'true');
  widget.className = 'ff-safety-widget';
  
  // BOTTOM-LEFT POSITIONING
  widget.style.cssText = `
    position: fixed;
    left: 20px;
    bottom: 20px;
    width: 280px;
    max-height: 500px;  
    background: linear-gradient(135deg, #fff5f5 0%, #ffebee 100%);
    border: 2px solid #f44336;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(244, 67, 54, 0.3);
    z-index: 999999;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  // Build HTML structure
  widget.innerHTML = `
    <div class="ff-alert-header" style="
      padding: 16px;
      background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
      color: white;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    ">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 20px;">🚨</span>
        <div>
          <div style="font-weight: 700; font-size: 16px;">Safety Alerts</div>
          <div style="font-size: 11px; opacity: 0.9;">${items.length} active</div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span style="
          background: rgba(255,255,255,0.3);
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 700;
        ">LIVE</span>
        <span class="ff-toggle-arrow" style="
          font-size: 20px;
          transition: transform 0.3s ease;
          display: inline-block;
        ">▼</span>
      </div>
    </div>
    
    <div class="ff-alert-body" style="
      overflow: hidden;
      transition: all 0.3s ease;
    ">
      <div class="ff-alert-content" style="
        max-height: 300px;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 12px;
      ">
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${items.slice(0, 5).map(alert => {
            const sourceColor = alert.source === 'NOAA' ? '#2196F3' :
                               alert.source === 'USGS' ? '#FF9800' : '#4CAF50';
            const sourceBg = alert.source === 'NOAA' ? '#E3F2FD' :
                            alert.source === 'USGS' ? '#FFF3E0' : '#E8F5E9';
            const sourceText = alert.source === 'NOAA' ? '#1565C0' :
                              alert.source === 'USGS' ? '#E65100' : '#2E7D32';
            
            return `
              <a href="${escapeHtml(alert.url)}" 
                 target="_blank" 
                 rel="noopener noreferrer"
                 style="
                   display: block;
                   background: white;
                   border-radius: 10px;
                   padding: 12px;
                   text-decoration: none;
                   color: inherit;
                   box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                   transition: all 0.2s ease;
                   border-left: 4px solid ${sourceColor};
                 "
                 onmouseenter="this.style.transform='translateX(4px)'; this.style.boxShadow='0 4px 16px rgba(0,0,0,0.15)';"
                 onmouseleave="this.style.transform='translateX(0)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)';">
                <div style="margin-bottom: 6px;">
                  <span style="
                    display: inline-block;
                    padding: 3px 8px;
                    background: ${sourceBg};
                    color: ${sourceText};
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                  ">${escapeHtml(alert.source)}</span>
                </div>
                <div style="font-size: 13px; line-height: 1.4; font-weight: 500; color: #333;">
                  ${escapeHtml(alert.title)}
                </div>
                <div style="margin-top: 6px; font-size: 11px; color: #1976d2; font-weight: 600;">
                  View details →
                </div>
              </a>
            `;
          }).join('')}
        </div>
      </div>
      
      <div class="ff-alert-footer" style="
        padding: 12px 16px;
        border-top: 1px solid rgba(244, 67, 54, 0.2);
        background: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        color: #666;
        text-align: center;
      ">
        Updated: ${new Date(json.generatedAt || Date.now()).toLocaleTimeString()}
      </div>
    </div>
  `;

  // Insert into page FIRST
  document.body.appendChild(widget);
  console.log('[SafetyAlerts] Widget inserted into DOM');

  // Get elements
  const header = widget.querySelector('.ff-alert-header');
  const body = widget.querySelector('.ff-alert-body');
  const arrow = widget.querySelector('.ff-toggle-arrow');

  if (!header || !body || !arrow) {
    console.error('[SafetyAlerts] Could not find widget elements!');
    return;
  }

  console.log('[SafetyAlerts] All elements found, adding click handler...');

  let isCollapsed = false;
  
  header.onclick = (e) => {
    console.log('CLICK DETECTED on header');
    e.stopPropagation();
    
    isCollapsed = !isCollapsed;
    console.log(`  → Toggling to: ${isCollapsed ? 'COLLAPSED' : 'EXPANDED'}`);
    
    if (isCollapsed) {
      // COLLAPSE - Use display:none for guaranteed hiding
      body.style.display = 'none';
      arrow.style.transform = 'rotate(-90deg)';
      arrow.textContent = '▶';
    } else {
      // EXPAND
      body.style.display = 'block';
      arrow.style.transform = 'rotate(0deg)';
      arrow.textContent = '▼';
    }
  };

  console.log('[SafetyAlerts] Sidebar widget complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

function createFloatingToolbar() {
  if (document.getElementById('feedframe-toolbar')) return;
  
  const toolbar = document.createElement('div');
  toolbar.id = 'feedframe-toolbar';
  toolbar.innerHTML = `
    <div class="ff-banner-container">
      <div class="ff-banner-left">
        <span class="ff-banner-logo">🛡️ FeedFrame</span>
        <span class="ff-banner-divider">|</span>
        <span class="ff-current-mode" id="ff-banner-mode-label">
          ${currentMode === 'entertainment' ? '🎉 Entertainment Mode' : '📰 News Mode'}
        </span>
      </div>
      
      <div class="ff-banner-center">
        <button id="ff-entertainment-btn" 
                class="ff-mode-btn ${currentMode === 'entertainment' ? 'active' : ''}"
                title="Entertainment Mode: Browse freely">
          <span class="ff-btn-icon">🎉</span>
          <span class="ff-btn-text">Entertainment</span>
        </button>
        
        <button id="ff-news-btn" 
                class="ff-mode-btn ${currentMode === 'news' ? 'active' : ''}"
                title="News Mode: Filters potential misleading content">
          <span class="ff-btn-icon">📰</span>
          <span class="ff-btn-text">News</span>
        </button>
      </div>
      
      <div class="ff-banner-right">
        <span class="ff-filtered-count" id="ff-filtered-badge" style="display: ${currentMode === 'news' ? 'inline-flex' : 'none'}">
        </span>
        <button id="ff-info-btn" 
                class="ff-info-icon-btn" 
                title="Information">
          ⓘ
        </button>
      </div>
    </div>
    
    <!-- Info Popup -->
    <div id="ff-info-popup" class="ff-info-popup" style="display: none;">
      <div class="ff-info-header">
        <span class="ff-info-title">🛡️ FeedFrame</span>
        <button id="ff-info-close" class="ff-info-close">×</button>
      </div>
      
      <div class="ff-info-content">
        <div class="ff-info-section">
          <strong>Current Mode:</strong>
          <span id="ff-current-mode-display">${currentMode === 'entertainment' ? '🎉 Entertainment' : '📰 News'}</span>
        </div>
        
        <div class="ff-info-section" id="ff-filtered-section" style="display: ${currentMode === 'news' ? 'block' : 'none'}">
          <strong>Posts Filtered:</strong>
          <span id="ff-filtered-count-display">0</span>
        </div>
        
        <div class="ff-info-divider"></div>
        
        <div class="ff-info-section">
          <strong>🎉 Entertainment Mode</strong>
          <p>Browse freely without filters.</p>
        </div>
        
        <div class="ff-info-section">
          <strong>📰 News Mode</strong>
          <p>Filters potentially misleading or high-arousal content. Dimmed posts can be revealed by clicking.</p>
        </div>
        
        <div class="ff-info-divider"></div>
        
        <div class="ff-info-section">
          <small style="color: #6c757d;">FeedFrame v1.0 | Research Project</small>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(toolbar);
  
  // ========== dynamic position ==========
  function updateBannerPosition() {
    const banner = document.getElementById('feedframe-toolbar');
    if (!banner) return;
    
    // find toolbar
    const sidebar = document.querySelector('nav[role="navigation"]') || 
                    document.querySelector('aside') ||
                    document.querySelector('nav');
    
    let leftOffset = 0;
    
    if (sidebar) {
      const rect = sidebar.getBoundingClientRect();
      leftOffset = rect.right;  
    } else {
      console.log('Sidebar not found, using left: 0');
    }
    
    banner.style.left = `${leftOffset}px`;
    
    // content area top offset
    const bannerHeight = banner.offsetHeight;
    document.body.style.paddingTop = `${bannerHeight}px`;
    
    console.log(`Banner positioned at left: ${leftOffset}px, padding: ${bannerHeight}px`);
  }
  
  setTimeout(updateBannerPosition, 300);
  
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(updateBannerPosition, 100);
  });
  
  const observer = new MutationObserver(() => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(updateBannerPosition, 100);
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: false
  });
  
  // Event listeners
  document.getElementById('ff-entertainment-btn').addEventListener('click', () => switchMode('entertainment'));
  document.getElementById('ff-news-btn').addEventListener('click', () => switchMode('news'));
  
  const infoBtn = document.getElementById('ff-info-btn');
  const infoPopup = document.getElementById('ff-info-popup');
  const closeBtn = document.getElementById('ff-info-close');
  
  infoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = infoPopup.style.display === 'block';
    infoPopup.style.display = isVisible ? 'none' : 'block';
  });
  
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    infoPopup.style.display = 'none';
  });
  
  document.addEventListener('click', (e) => {
    if (!toolbar.contains(e.target)) {
      infoPopup.style.display = 'none';
    }
  });
  
  console.log('FeedFrame banner created with dynamic positioning');
  function fixBlueskyNav() {
  const banner = document.getElementById('feedframe-toolbar');
  if (!banner) return;
  
  const bannerHeight = banner.offsetHeight;
  
  // find navigation toolbar
  document.querySelectorAll('*').forEach(el => {
    const text = el.innerText?.toLowerCase() || '';
    
    // if find discover & following
    if (text.includes('discover') && text.includes('following')) {
      const style = window.getComputedStyle(el);
      
      if (style.position === 'sticky') {
        el.style.top = `${bannerHeight}px`;
        el.style.zIndex = '99';
        el.style.transition = 'top 0.3s ease';
        console.log(`Fixed Bluesky nav: top=${bannerHeight}px`);
      }
    }
  });
}

// init exe (wait DOM）
setTimeout(fixBlueskyNav, 500);
setTimeout(fixBlueskyNav, 1500);  


window.addEventListener('resize', () => {
  setTimeout(fixBlueskyNav, 100);
});

let scrollTimeout;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(fixBlueskyNav, 50);
}, { passive: true });
}

// ========== Mode Switching  ==========
function switchMode(mode) {
  if (currentMode === mode) return;
  
  const previousMode = currentMode;
  console.log(`Switching mode: ${currentMode} → ${mode}`);
  
  // ========== LOG MODE TOGGLE ==========
  logModeToggle(previousMode, mode);
  
  // Clean up if leaving news mode
  if (currentMode === 'news') {
    stopNewsMode();
  }
  
  currentMode = mode;
  chrome.storage.sync.set({ mode });
  
  // ========== update Banner UI ==========
  document.getElementById('ff-entertainment-btn').classList.toggle('active', mode === 'entertainment');
  document.getElementById('ff-news-btn').classList.toggle('active', mode === 'news');
  
  // update mode tags
  const modeLabel = document.getElementById('ff-banner-mode-label');
  const currentModeDisplay = document.getElementById('ff-current-mode-display');
  const filteredSection = document.getElementById('ff-filtered-section');
  const filteredBadge = document.getElementById('ff-filtered-badge');
  
  if (mode === 'entertainment') {
    modeLabel.textContent = 'Entertainment Mode';
    currentModeDisplay.textContent = 'Entertainment';
    filteredSection.style.display = 'none';
    filteredBadge.style.display = 'none';
  } else {
    modeLabel.textContent = 'News Mode';
    currentModeDisplay.textContent = 'News';
    filteredSection.style.display = 'block';
    filteredBadge.style.display = 'inline-flex';
    
    setTimeout(() => {
      startNewsMode();
    }, 100);
  }
}

// ========== News Mode Logic ==========
function startNewsMode() {
  console.log(' NEWS MODE ACTIVATED');
  
  processedPosts.clear();
  scanPosts();
  
  if (monitoringInterval) clearInterval(monitoringInterval);
  monitoringInterval = setInterval(scanPosts, CONFIG.CHECK_INTERVAL);
}

// ========== Stop News Mode  ==========

function stopNewsMode() {
  console.log(' Entertainment mode - removing all dim effects');
  
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  
  const dimmedPosts = document.querySelectorAll('.ff-dimmed');
  console.log(`Cleaning up ${dimmedPosts.length} dimmed posts`);
  
  dimmedPosts.forEach(post => {
    post.classList.remove('ff-dimmed');
    post.style.position = '';
    post.style.cursor = '';
    
    const overlay = post.querySelector('.ff-dim-overlay');
    if (overlay) overlay.remove();
    
    const images = post.querySelectorAll('img.ff-dimmed-image');
    images.forEach(img => {
      img.classList.remove('ff-dimmed-image');
      img.style.opacity = '';
      img.style.filter = '';
    });
    
    const hint = post.querySelector('.ff-click-hint');
    if (hint) hint.remove();
    
  });
  
  processedPosts.clear();
  
  updateFilteredCount();
  console.log(' All dim effects removed');
}

// ========== Get Unique Post ID ==========
function getPostId(postElement) {
  // Try to get post URL from link
  const link = postElement.querySelector('a[href*="/post/"]');
  if (link) {
    return link.href;
  }
  
  // Fallback: create hash from post text
  const text = postElement.innerText?.substring(0, 100) || '';
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return 'post-' + Math.abs(hash);
}

// ========== Extract Post Data ==========
function extractPostData(postElement) {
  // Get post text content
  const postTextElement = postElement.querySelector('[data-testid="postText"]');
  const postText = postTextElement?.innerText?.trim() || '';
  
  // Get author info
  const authorElement = postElement.querySelector('[href*="profile"]');
  const authorHandle = authorElement?.getAttribute('href')?.split('/profile/')[1] || '';
  
  // Get timestamp
  const timestampElement = postElement.querySelector('time');
  const timestamp = timestampElement?.getAttribute('datetime') || 
                   timestampElement?.innerText || '';
  
  // Get images
  const images = Array.from(postElement.querySelectorAll('img')).map(img => ({
    src: img.src,
    alt: img.alt || '',
    width: img.width,
    height: img.height
  }));
  
  // Get engagement metrics
  const replyCount = postElement.querySelector('[data-testid="replyCount"]')?.innerText || '0';
  const repostCount = postElement.querySelector('[data-testid="repostCount"]')?.innerText || '0';
  const likeCount = postElement.querySelector('[data-testid="likeCount"]')?.innerText || '0';
  
  // Get post URL
  const postLink = postElement.querySelector('a[href*="/post/"]');
  const postUrl = postLink?.href || '';
  const postId = postUrl.split('/post/')[1] || '';
  
  return {
    // Content
    postText: postText,
    textLength: postText.length,
    
    // Author
    authorHandle: authorHandle,
    
    // Time
    timestamp: timestamp,
    
    // Media
    images: images,
    imageCount: images.length,
    hasImages: images.length > 0,
    
    // Engagement
    replies: parseInt(replyCount) || 0,
    reposts: parseInt(repostCount) || 0,
    likes: parseInt(likeCount) || 0,
    totalEngagement: (parseInt(replyCount) || 0) + 
                     (parseInt(repostCount) || 0) + 
                     (parseInt(likeCount) || 0),
    
    // Identifiers
    postId: postId,
    postUrl: postUrl,
    
    // Full text (for debugging)
    fullText: postElement.innerText?.trim() || ''
  };
}

// ========== Track Post Interactions  ==========
function setupInteractionTracking(postElement, postId, forceReset = false) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔧 setupInteractionTracking');
  console.log('  Post ID:', postId);
  console.log('  Element:', postElement?.tagName);
  console.log('  Force reset:', forceReset);
  
  if (!postId || postId === 'unknown') {
    console.log('Invalid post ID');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return;
  }
  

  if (GLOBAL_TRACKED_POSTS.has(postId)) {
    if (!forceReset) {
      console.log(`⏭️ Already tracked: ${postId.substring(0, 8)}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return;
    }
    console.log('🔄 Force reset enabled');
  }
  
  GLOBAL_TRACKED_POSTS.add(postId);
  
  postElement.setAttribute('data-ff-tracked', 'true');
  postElement.setAttribute('data-ff-post-id', postId);
  
  console.log(`Tracking enabled for: ${postId.substring(0, 8)}`);
  
  const wasFiltered = DATA_COLLECTION.trackedPosts.has(postId);
  
  // ========== status monitor ==========
function isButtonActive(testId, button) {
  if (!button) return false;
  
  const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
  
  console.log(`  [STATE CHECK] ${testId}:`);
  console.log(`    aria-label: "${ariaLabel}"`);
  
  switch(testId) {
    case 'likeBtn':
      const likeActive = ariaLabel.includes('unlike') || ariaLabel.includes('liked');
      console.log(`    → like is active: ${likeActive}`);
      return likeActive;
      
    case 'repostBtn':
      // Repost:  aria-label
      //  repost: "undo repost" or "reposted"
      // x repost: "repost" or "repost or quote post"
      const repostActive = ariaLabel.includes('undo') || 
                          ariaLabel.includes('reposted') ||
                          (ariaLabel.includes('quoted') && !ariaLabel.includes('or'));
      
      console.log(`    → repost is active: ${repostActive}`);
      return repostActive;
      
    case 'postBookmarkBtn':
      // Bookmark: "remove" or "saved" active
      const bookmarkActive = ariaLabel.includes('remove') || 
                            ariaLabel.includes('unbookmark') ||
                            ariaLabel.includes('saved');
      console.log(`    → bookmark is active: ${bookmarkActive}`);
      return bookmarkActive;
      
    default:
      return false;
  }
}
  
  function handleButtonClick(button, testId) {
    const wasActive = isButtonActive(testId, button);
    
    console.log(`Button clicked: ${testId}`);
    console.log(`  Post: ${postId.substring(0, 8)}`);
    console.log(`  Before: ${wasActive ? 'active' : 'inactive'}`);
    
    setTimeout(() => {
      const isActive = isButtonActive(testId, button);
      console.log(`  After: ${isActive ? 'active' : 'inactive'}`);
      
      let actionType = null;
      
      switch(testId) {
        case 'likeBtn':
          actionType = isActive ? 'like' : 'unlike';
          break;
        case 'repostBtn':
          actionType = isActive ? 'repost' : 'unrepost';
          break;
        case 'postBookmarkBtn':
          actionType = isActive ? 'bookmark' : 'unbookmark';
          break;
        case 'replyBtn':
          actionType = 'reply_open';
          break;
        case 'postShareBtn':
          actionType = 'share';
          break;
        default:
          actionType = testId;
      }
      
      if (actionType && shouldRecordGlobalInteraction(postId, actionType)) {
        logPostInteraction(postId, actionType, { 
          was_filtered: wasFiltered,
          previous_state: wasActive,
          new_state: isActive
        });
      }
      
    }, 250);
  }
  
  const clickHandler = (e) => {
    const target = e.target;
    const testIdElement = target.closest('[data-testid]');
    
    if (!testIdElement) return;
    
    const testId = testIdElement.getAttribute('data-testid');
    
    const interactionButtons = [
      'likeBtn',
      'repostBtn',
      'replyBtn',
      'postBookmarkBtn',
      'postShareBtn'
    ];
    
    if (interactionButtons.includes(testId)) {
      handleButtonClick(testIdElement, testId);
    }
  };
  
  if (postElement._ffClickHandler) {
    postElement.removeEventListener('click', postElement._ffClickHandler, true);
  }
  
  postElement.addEventListener('click', clickHandler, { capture: true });
  postElement._ffClickHandler = clickHandler;
  
  console.log(`Tracking setup complete for: ${postId.substring(0, 8)}`);
}

// ========== Post Scanning ==========
function scanPosts() {
  const contentElements = Array.from(document.querySelectorAll('[data-testid="contentHider-post"]'));
  
  if (contentElements.length === 0) {
    console.log(' No posts found');
    return;
  }
  
  console.log(` Scanning ${contentElements.length} posts...`);
  
  let newPosts = 0;
  let newTracking = 0;
  
  contentElements.forEach((contentElement) => {
    const fullPost = contentElement.closest('[data-testid^="feedItem-by-"]') || contentElement.parentElement?.parentElement;
    if (!fullPost) return;
    
    const postId = getPostId(fullPost);
    
    // ========== Interaction track setting only once ==========
    if (!fullPost.hasAttribute('data-ff-tracked')) {
      fullPost.setAttribute('data-ff-tracked', 'true');
      const postData = extractPostData(fullPost);
      setupInteractionTracking(fullPost, postData.postId);
      newTracking++;
    }
    
    // ========== Dim effect ==========
    if (currentMode === 'news') {
      if (!fullPost.classList.contains('ff-dimmed')) {
        const postData = extractPostData(fullPost);
        processedPosts.add(postId);
        analyzeMock(fullPost, postData);
        newPosts++;
      }
    }
  });
  
  if (newTracking > 0) {
    console.log(` Set up tracking for ${newTracking} posts`);
  }
  if (newPosts > 0) {
    console.log(` Applied dim to ${newPosts} posts`);
  }
}

// ========== Mock Analysis ==========
function analyzeMock(postElement, postData) {
  const arousalScore = 0.7 + (Math.random() * 0.3);
  const misinfoScore = 0.7 + (Math.random() * 0.3);
  
  console.log(`Analyzing post: arousal=${arousalScore.toFixed(2)}, misinfo=${misinfoScore.toFixed(2)}`);
  
  // Apply dim effect with scores
  applyDimEffect(postElement, {
    arousal_score: arousalScore,
    misinfo_score: misinfoScore,
    postData: postData
  });
  
  // Update filtered count
  updateFilteredCount();
}

// ==========  Bluesky theme ==========
function getBackgroundColor() {
  const htmlClasses = document.documentElement.className;
  
  console.log('HTML classes:', htmlClasses);
  
  // light theme
  if (htmlClasses.includes('theme--light')) {
    console.log(' Detected: Light theme');
    return 'rgba(255, 255, 255, 0.65)';  
  }
  
  // Dark theme
  if (htmlClasses.includes('theme--dark')) {
    console.log(' Detected: Dark (dark) theme');
    return 'rgba(0, 0, 0, 0.60)';  
  }
  
  // Dim theme
  if (htmlClasses.includes('theme--dim')) {
    console.log(' Detected: Dark (dim) theme');
    return 'rgba(21, 29, 40, 0.65)';  
  }
  
  // Default: Dim
  return 'rgba(21, 29, 40, 0.88)';
}

// ========== GetHintColor to pair the theme ==========
function getHintColors() {
  const htmlClasses = document.documentElement.className;
  
  // light theme
  if (htmlClasses.includes('theme--light')) {
    return {
      background: 'rgba(255, 255, 255, 0.95)',
      text: '#536471'  
    };
  }
  
  // dark theme
  if (htmlClasses.includes('theme--dark')) {
    return {
      background: 'rgba(0, 0, 0, 0.40)',
      text: '#71767b'  
    };
  }
  
  // Dim theme
  if (htmlClasses.includes('theme--dim')) {
    return {
      background: 'rgba(21, 29, 40, 0.95)',
      text: '#8899a6'  
    };
  }
  
  // Default： Dim
  return {
    background: 'rgba(21, 29, 40, 0.95)',
    text: '#8899a6'
  };
}

// ========== Apply Dim Effect ==========
function applyDimEffect(postElement, scores) {
    // white list: Safety alert never dim/blur
  if (postElement?.closest?.('[data-ff-whitelist="true"], [data-feedframe-type="safety-alerts"]')) {
    return;
  }
  //already dimmed, skip
  if (postElement.classList.contains('ff-dimmed')) {
    return;
  }
  
  // overlay already exist,skip
  if (postElement.querySelector('.ff-dim-overlay')) {
    return;
  }
  
  
  postElement.classList.add('ff-dimmed');
  postElement.style.position = 'relative';
  
  const backgroundColor = getBackgroundColor();
  
  // create overlay
  const dimOverlay = document.createElement('div');
  dimOverlay.className = 'ff-dim-overlay';
  dimOverlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    background: ${backgroundColor};
    z-index: 10;
    transition: all 0.3s ease;
    cursor: pointer;
    border-radius: inherit;
  `;
  
  postElement.appendChild(dimOverlay);
  
  // lower iamges brightness 
  const images = postElement.querySelectorAll('img');
  images.forEach((img) => {
    if (!img.classList.contains('ff-dimmed-image')) {
      img.classList.add('ff-dimmed-image');
      img.style.filter = 'brightness(0.6) saturate(0.8)';
      img.style.transition = 'filter 0.3s ease';
    }
  });
  
  // ========== status tracking ==========
  let revealCount = 0; 
  let isRevealed = false;
  
  function handleFirstReveal(e) {
    if (e) e.stopPropagation();
    
    revealCount++;
    
    dimOverlay.style.opacity = '0';
    dimOverlay.style.pointerEvents = 'none';
    isRevealed = true;
    
    images.forEach((img) => {
      img.style.filter = '';
    });
    
    const postData = extractPostData(postElement);
    logPostRevealed(postData, scores);
    
    setTimeout(() => {
      const postId = postData.postId;
      if (postId && postId !== 'unknown') {
        console.log('Setting up interaction tracking after reveal');
        setupInteractionTracking(postElement, postId, true);
      }
    }, 100);
    
    if (revealCount === 1) {
      console.log('First reveal - will re-dim on mouse leave');
      postElement.addEventListener('mouseleave', handleMouseLeave);
    } else {
      console.log('econd reveal - permanently revealed');
      dimOverlay.remove();
      postElement.classList.remove('ff-dimmed');
      postElement.removeEventListener('mouseleave', handleMouseLeave);
    }
  }
  
  function handleMouseLeave(e) {  
    const rect = postElement.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    if (mouseX >= rect.left && mouseX <= rect.right &&
        mouseY >= rect.top && mouseY <= rect.bottom) {
      return;
    }
    
    
    dimOverlay.style.opacity = '1';
    dimOverlay.style.pointerEvents = 'auto';
    isRevealed = false;
    
    images.forEach((img) => {
      img.style.filter = 'brightness(0.6) saturate(0.8)';
    });
  }
  
  // ========== Bind click event ==========
  dimOverlay.addEventListener('click', handleFirstReveal);
  
  console.log('Dim effect applied');
}

// ========== Update Filtered Count ==========
function updateFilteredCount() {
  const count = document.querySelectorAll('.ff-dimmed').length;
  const countElement = document.getElementById('ff-filtered-count');
  if (countElement) {
    countElement.textContent = count;
  }
}



// ========== Start ==========
init();

// ========== Monitor Page Changes ==========
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    processedPosts.clear();
    if (currentMode === 'news') {
      setTimeout(scanPosts, 1000);
    }
  }
}).observe(document, { subtree: true, childList: true });

console.log(' FeedFrame fully loaded!');


let lastTrackedUrl = location.href;
let urlCheckInterval;

function isDetailPage(url) {
  return url.includes('/profile/') && url.includes('/post/');
}

function getPostIdFromUrl(url) {
  const match = url.match(/\/post\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function findPostContainer() {
  let container = document.querySelector('article');
  if (container) {
    console.log('Found container: article');
    return container;
  }
  
  container = document.querySelector('[data-testid="postThreadItem"]');
  if (container) {
    console.log('Found container: postThreadItem');
    return container;
  }
  
  container = document.querySelector('main');
  if (container) {
    console.log('Found container: main');
    return container;
  }
  
  const likeBtn = document.querySelector('[data-testid="likeBtn"]');
  if (likeBtn) {
    console.log('Found like button, searching for parent container...');
    
    let parent = likeBtn.parentElement;
    let depth = 0;
    
    while (parent && depth < 15) {
      const hasReply = parent.querySelector('[data-testid="replyBtn"]');
      const hasRepost = parent.querySelector('[data-testid="repostBtn"]');
      
      if (hasReply && hasRepost) {
        console.log(`Found container via like button (depth: ${depth})`);
        return parent;
      }
      
      parent = parent.parentElement;
      depth++;
    }
  }
  
  console.log('Could not find suitable container');
  return null;
}

function setupDetailPageTracking() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Setting up detail page tracking...');
  
  const urlPostId = getPostIdFromUrl(location.href);
  
  if (!urlPostId) {
    console.log('Could not extract post ID from URL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return;
  }
  
  console.log(`Post ID from URL: ${urlPostId}`);
  
  let attempts = 0;
  const maxAttempts = 10;
  
  function attemptSetup() {
    attempts++;
    console.log(`Attempt ${attempts}/${maxAttempts}...`);
    
    const container = findPostContainer();
    
    if (!container) {
      if (attempts < maxAttempts) {
        setTimeout(attemptSetup, 500);
      } else {
        console.log('Failed to find container after all attempts');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      }
      return;
    }
    
    console.log('Setting up tracking for main post...');
    setupInteractionTracking(container, urlPostId, true);
    
    setTimeout(() => {
      const allContainers = document.querySelectorAll('[data-testid="postThreadItem"]');
      
      allContainers.forEach((el, index) => {
        if (el === container) return;
        
        const replyPostId = `${urlPostId}-reply-${index}`;
        console.log(`Tracking reply ${index}: ${replyPostId.substring(0, 15)}`);
        setupInteractionTracking(el, replyPostId, true);
      });
    }, 1000);
  }
  
  attemptSetup();
}

function checkPageChange() {
  const currentUrl = location.href;
  
  if (currentUrl !== lastTrackedUrl) {
    lastTrackedUrl = currentUrl;
    
    GLOBAL_TRACKED_POSTS.clear();
    console.log('Cleared global tracking set');
    
    if (isDetailPage(currentUrl)) {
      setTimeout(setupDetailPageTracking, 800);
    } else {
      if (currentMode === 'news') {
        setTimeout(scanPosts, 1000);
      }
    }
  }
}


urlCheckInterval = setInterval(checkPageChange, 500);

window.addEventListener('popstate', () => {
  console.log('Browser back/forward');
  setTimeout(checkPageChange, 100);
});

(function() {
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  
  history.pushState = function(...args) {
    origPush.apply(this, args);
    setTimeout(checkPageChange, 100);
  };
  
  history.replaceState = function(...args) {
    origReplace.apply(this, args);
    setTimeout(checkPageChange, 100);
  };
})();

console.log('Navigation monitoring active');

if (isDetailPage(location.href)) {
  console.log('Initial page is detail page');
  setTimeout(setupDetailPageTracking, 1500);
}


(function() {
  function createStatsButton() {
    if (document.getElementById('ff-stats-btn')) return;
    
    const button = document.createElement('button');
    button.id = 'ff-stats-btn';
    button.innerHTML = '📊';
    button.title = 'FeedFrame Statistics';
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      z-index: 999998;
      transition: all 0.3s ease;
    `;
    
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.1)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
    });
    
    button.addEventListener('click', showStatsPanel);
    
    document.body.appendChild(button);
  }
  
  function showStatsPanel() {
    let panel = document.getElementById('ff-stats-panel');
    if (panel) {
      panel.remove();
      return;
    }
    
    panel = document.createElement('div');
    panel.id = 'ff-stats-panel';
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 600px;
      max-width: 90vw;
      max-height: 80vh;
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      z-index: 999999;
      overflow: hidden;
      animation: fadeIn 0.3s ease;
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translate(-50%, -45%); }
        to { opacity: 1; transform: translate(-50%, -50%); }
      }
    `;
    document.head.appendChild(style);
    
    panel.innerHTML = `
      <div style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">🛡️ FeedFrame Statistics</h2>
          <button id="ff-close-panel" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px;">×</button>
        </div>
      </div>
      <div id="ff-stats-content" style="padding: 20px; overflow-y: auto; max-height: calc(80vh - 80px);">
        <p style="text-align: center; color: #999;">Loading...</p>
      </div>
    `;
    
    document.body.appendChild(panel);
    
    document.getElementById('ff-close-panel').addEventListener('click', () => {
      panel.remove();
    });
    
    panel.addEventListener('click', (e) => {
      if (e.target === panel) {
        panel.remove();
      }
    });
    
    loadStats();
  }
  
  function loadStats() {
    chrome.storage.local.get(['interactionData'], (result) => {
      const data = result.interactionData || [];
      
      const stats = {
        total: data.length,
        likes: data.filter(e => e.interaction_type === 'like').length,
        unlikes: data.filter(e => e.interaction_type === 'unlike').length,
        reposts: data.filter(e => e.interaction_type === 'repost').length,
        unreposts: data.filter(e => e.interaction_type === 'unrepost').length,
        replies: data.filter(e => e.interaction_type === 'reply_open').length,
        reveals: data.filter(e => e.action === 'post_revealed').length,
        filtered: new Set(data.filter(e => e.was_filtered).map(e => e.post_id)).size
      };
      
      const likes = data.filter(e => 
        e.action === 'post_interaction' && 
        (e.interaction_type === 'like' || e.interaction_type === 'unlike')
      ).slice(-10);
      
      const content = document.getElementById('ff-stats-content');
      if (!content) return;
      
      content.innerHTML = `
        <div style="margin-bottom: 24px;">
          <h3 style="margin: 0 0 12px 0; color: #333;">📊 Overview</h3>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
            <div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">
              <div style="font-size: 24px; font-weight: bold; color: #667eea;">${stats.total}</div>
              <div style="font-size: 12px; color: #666;">Total Interactions</div>
            </div>
            <div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">
              <div style="font-size: 24px; font-weight: bold; color: #667eea;">${stats.filtered}</div>
              <div style="font-size: 12px; color: #666;">Filtered Posts</div>
            </div>
            <div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">
              <div style="font-size: 24px; font-weight: bold; color: #e91e63;">${stats.likes}</div>
              <div style="font-size: 12px; color: #666;">Likes</div>
            </div>
            <div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">
              <div style="font-size: 24px; font-weight: bold; color: #9c27b0;">${stats.unlikes}</div>
              <div style="font-size: 12px; color: #666;">Unlikes</div>
            </div>
            <div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">
              <div style="font-size: 24px; font-weight: bold; color: #2196f3;">${stats.reposts}</div>
              <div style="font-size: 12px; color: #666;">Reposts</div>
            </div>
            <div style="padding: 12px; background: #f5f5f5; border-radius: 8px;">
              <div style="font-size: 24px; font-weight: bold; color: #ff9800;">${stats.reveals}</div>
              <div style="font-size: 12px; color: #666;">Reveals</div>
            </div>
          </div>
        </div>
        
        <div style="margin-bottom: 24px;">
          <h3 style="margin: 0 0 12px 0; color: #333;">👍 Recent Likes/Unlikes (Last 10)</h3>
          ${likes.length === 0 ? '<p style="color: #999; text-align: center;">No likes yet</p>' : `
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                  <tr style="background: #f5f5f5;">
                    <th style="padding: 8px; text-align: left;">Type</th>
                    <th style="padding: 8px; text-align: left;">Post ID</th>
                    <th style="padding: 8px; text-align: left;">Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${likes.map(e => `
                    <tr style="border-bottom: 1px solid #eee;">
                      <td style="padding: 8px;">
                        <span style="padding: 2px 8px; border-radius: 4px; background: ${e.interaction_type === 'like' ? '#e8f5e9' : '#ffebee'}; color: ${e.interaction_type === 'like' ? '#4caf50' : '#f44336'}; font-size: 11px;">
                          ${e.interaction_type}
                        </span>
                      </td>
                      <td style="padding: 8px; font-family: monospace;">${e.post_id?.substring(0, 10)}</td>
                      <td style="padding: 8px; color: #666;">${new Date(e.timestamp).toLocaleTimeString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
        
        <div style="display: flex; gap: 8px;">
          <button id="ff-export-btn" style="flex: 1; padding: 12px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
            Export Data
          </button>
          <button id="ff-refresh-btn" style="flex: 1; padding: 12px; background: #4caf50; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
            Refresh
          </button>
        </div>
      `;
      
      // Export button
      document.getElementById('ff-export-btn').addEventListener('click', () => {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `feedframe-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('Data exported!');
      });
      
      document.getElementById('ff-refresh-btn').addEventListener('click', () => {
        loadStats();
      });
    });
  }
  
  setTimeout(createStatsButton, 2000);
  
  console.log('FeedFrame stats button will appear in 2 seconds');
  
})();

injectSafetyAlertsCard().catch(e =>
  console.warn('[SafetyAlerts] inject error', e)
);
