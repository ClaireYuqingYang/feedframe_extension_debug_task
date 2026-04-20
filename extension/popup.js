// ============================================
// Popup - MongoDB Backend
// ============================================

console.log(' Popup loaded');
const BACKEND_URL = 'http://localhost:3000'; 

// ========== Check Backend Connection ==========
async function checkBackendConnection() {
  const statusIndicator = document.getElementById('statusIndicator');
  const connectionStatus = document.getElementById('connectionStatus');
  const backendUrl = document.getElementById('backendUrl');
  
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      statusIndicator.className = 'status-indicator status-connected';
      connectionStatus.textContent = ' Connected';
      backendUrl.textContent = BACKEND_URL;
      return true;
    } else {
      throw new Error('Backend not responding');
    }
  } catch (error) {
    console.error('Connection check failed:', error);
    statusIndicator.className = 'status-indicator status-disconnected';
    connectionStatus.textContent = 'Disconnected';
    backendUrl.textContent = BACKEND_URL + ' (unreachable)';
    return false;
  }
}

// ========== Load Local Stats ==========
function loadLocalStats() {
  chrome.storage.local.get(['interactionData'], (result) => {
    const data = result.interactionData || [];
    
    // Calculate stats
    const sessionEntries = data.filter(e => 
      e.action === 'session_snapshot' || e.action === 'mode_toggle'
    );
    
    let newsTime = 0;
    let entertainmentTime = 0;
    
    sessionEntries.forEach(entry => {
      if (entry.news_mode_time_seconds) {
        newsTime = Math.max(newsTime, entry.news_mode_time_seconds);
      }
      if (entry.entertainment_mode_time_seconds) {
        entertainmentTime = Math.max(entertainmentTime, entry.entertainment_mode_time_seconds);
      }
    });
    
    const interactions = data.filter(e => e.action === 'post_interaction');
    
    // Update UI
    document.getElementById('newsModeTime').textContent = formatTime(newsTime);
    document.getElementById('entertainmentTime').textContent = formatTime(entertainmentTime);
    document.getElementById('interactionCount').textContent = interactions.length;
    document.getElementById('queueSize').textContent = `${data.length} local`;
  });
}

// ========== Format Time ==========
function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// ========== Show Message ==========
function showMessage(text, type = 'success') {
  const message = document.getElementById('message');
  message.textContent = text;
  message.className = `message ${type}`;
  message.style.display = 'block';
  
  setTimeout(() => {
    message.style.display = 'none';
  }, 3000);
}

// ========== Manual Sync ==========
document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  
  try {
    // Get local data
    chrome.storage.local.get(['interactionData'], async (result) => {
      const data = result.interactionData || [];
      
      if (data.length === 0) {
        showMessage('No data to sync', 'error');
        btn.disabled = false;
        btn.textContent = 'Sync Now';
        return;
      }
      
      // Send to backend
      const response = await fetch(`${BACKEND_URL}/api/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (response.ok) {
        const result = await response.json();
        showMessage(`Synced ${result.insertedCount} items`, 'success');
        
        // Clear local data after successful sync
        chrome.storage.local.set({ interactionData: [] });
        loadLocalStats();
      } else {
        throw new Error('Sync failed');
      }
    });
  } catch (error) {
    console.error('Sync error:', error);
    showMessage('Sync failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = ' Sync Now';
  }
});

// ========== Test Backend ==========
document.getElementById('testBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testBtn');
  btn.disabled = true;
  btn.textContent = 'Testing...';
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/test`);
    const result = await response.json();
    
    if (result.success) {
      showMessage(`Backend OK ${result.documentsCount} documents in DB`, 'success');
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    showMessage('Backend test failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = ' Test Backend';
  }
});

// ========== View Full Stats ==========
document.getElementById('viewStatsBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: `${BACKEND_URL}/api/stats` });
});

// ========== Clear Local Backup ==========
document.getElementById('clearLocalBtn').addEventListener('click', () => {
  if (confirm('Clear local backup? (Data in MongoDB will NOT be affected)')) {
    chrome.storage.local.set({ interactionData: [] }, () => {
      loadLocalStats();
    });
  }23 
});

// ========== Initialize ==========
async function init() {
  await checkBackendConnection();
  loadLocalStats();
}

init();

// ========== Auto Refresh ==========
setInterval(() => {
  checkBackendConnection();
  loadLocalStats();
}, 10000);  // Every 10 seconds