// ============================================
// FeedFrame Configuration
// ============================================

const BACKEND_CONFIG = {
  // Backend API URL
  // local env: 'http://localhost:3000/api'
  // devolop env: 'https://your-app.vercel.app/api'
  apiUrl: 'http://localhost:3000/api',
  
  // Batch settings
  batchSize: 10,           // max 10 per batch
  sendInterval: 30000,     // 30 seconds
  
  // Retry settings
  maxRetries: 3,
  retryDelay: 5000,        // 5 seconnds

  
  // Local backup
  keepLocalBackup: true,
  maxLocalEntries: 1000
};