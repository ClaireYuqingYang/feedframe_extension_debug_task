// ============================================
// FeedFrame Backend - MongoDB API
// ============================================

const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== Middleware ==========
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ========== MongoDB Connection ==========
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;
let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  
  try {
    await client.connect();
    db = client.db('feedframe');
    isConnected = true;
    console.log(' Connected to MongoDB Atlas');
  } catch (error) {
    console.error(' MongoDB connection failed:', error);
    throw error;
  }
}

// Connect on startup
connectDB();

// ========== API Endpoints ==========

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'FeedFrame API is running',
    mongoConnected: isConnected
  });
});

// Test MongoDB connection
app.get('/api/test', async (req, res) => {
  try {
    await connectDB();
    const collection = db.collection('interactions');
    const count = await collection.countDocuments();
    
    res.json({
      success: true,
      message: 'MongoDB connection works!',
      documentsCount: count
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Save interaction data (batch)
app.post('/api/interactions', async (req, res) => {
  try {
    await connectDB();
    
    const data = req.body;
    
    // Validate data
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid data format. Expected array.' 
      });
    }
    
    if (data.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Empty data array' 
      });
    }
    
    // Add server timestamp
    const dataWithTimestamp = data.map(item => ({
      ...item,
      server_received_at: new Date().toISOString()
    }));
    
    // Insert into MongoDB
    const collection = db.collection('interactions');
    const result = await collection.insertMany(dataWithTimestamp);
    
    console.log(` Inserted ${result.insertedCount} documents`);
    
    res.json({
      success: true,
      insertedCount: result.insertedCount,
      message: `Successfully saved ${result.insertedCount} interactions`
    });
    
  } catch (error) {
    console.error(' Insert error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to save data',
      details: error.message 
    });
  }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    await connectDB();
    
    const collection = db.collection('interactions');
    
    const [total, byAction, byInteractionType, recentSessions] = await Promise.all([
      // Total documents
      collection.countDocuments(),
      
      // Group by action
      collection.aggregate([
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray(),
      
      // Group by interaction type
      collection.aggregate([
        { $match: { action: 'post_interaction' } },
        { $group: { _id: '$interaction_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray(),
      
      // Recent sessions
      collection.aggregate([
        { $match: { action: 'session_end' } },
        { $sort: { timestamp: -1 } },
        { $limit: 10 }
      ]).toArray()
    ]);
    
    res.json({
      success: true,
      stats: {
        total,
        byAction,
        byInteractionType,
        recentSessions
      }
    });
    
  } catch (error) {
    console.error(' Stats error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get stats' 
    });
  }
});

// Get recent interactions
app.get('/api/interactions/recent', async (req, res) => {
  try {
    await connectDB();
    
    const limit = parseInt(req.query.limit) || 50;
    const collection = db.collection('interactions');
    
    const recent = await collection
      .find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    
    res.json({
      success: true,
      count: recent.length,
      data: recent
    });
    
  } catch (error) {
    console.error(' Recent fetch error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch recent interactions' 
    });
  }
});

// ========== National Safety Alerts ==========
const axios = require('axios');
const cheerio = require('cheerio');

app.get('/api/national-alerts', async (req, res) => {
  const limit = parseInt(req.query.limit) || 3;
  
  console.log(`Fetching national alerts (limit: ${limit})...`);
  
  try {
    // Fetch from all sources in parallel
    const [noaaAlerts, usgsAlerts, femaAlerts] = await Promise.allSettled([
      fetchNOAA(limit),
      fetchUSGS(limit),
      fetchFEMA(limit)
    ]);
    
    const alerts = {
      noaa: noaaAlerts.status === 'fulfilled' ? noaaAlerts.value : [],
      usgs: usgsAlerts.status === 'fulfilled' ? usgsAlerts.value : [],
      fema: femaAlerts.status === 'fulfilled' ? femaAlerts.value : []
    };
    
    const total = alerts.noaa.length + alerts.usgs.length + alerts.fema.length;
    console.log(`Total alerts: ${total} (NOAA: ${alerts.noaa.length}, USGS: ${alerts.usgs.length}, FEMA: ${alerts.fema.length})`);
    
    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      data: alerts
    });
    
  } catch (error) {
    console.error('National alerts error:', error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      generatedAt: new Date().toISOString(),
      data: {
        noaa: [],
        usgs: [],
        fema: []
      }
    });
  }
});

// Fetch functions for safety alerts
async function fetchNOAA(limit) {
  try {
    console.log('  → Fetching NOAA alerts...');
    const response = await axios.get('https://www.weather.gov/alerts', {
      timeout: 5000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const alerts = [];
    
    // Try multiple selectors for weather alerts
    $('.alert-item, .list-group-item, article').slice(0, limit * 2).each((i, el) => {
      const $el = $(el);
      const title = $el.find('.alert-title, h3, h4, strong').first().text().trim() ||
                   $el.find('a').first().text().trim();
      const link = $el.find('a').first().attr('href');
      
      if (title && title.length > 15 && !title.toLowerCase().includes('subscribe')) {
        alerts.push({
          source: 'NOAA',
          title: title.substring(0, 150),
          url: link && link.startsWith('http') ? link : `https://www.weather.gov${link || '/alerts'}`
        });
      }
    });
    
    console.log(`NOAA: ${alerts.length} alerts`);
    return alerts.slice(0, limit);
    
  } catch (error) {
    console.error('NOAA error:', error.message);
    return [];
  }
}

async function fetchUSGS(limit) {
  try {
    console.log('Fetching USGS earthquakes...');
    const response = await axios.get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson', {
      timeout: 5000
    });
    
    const features = response.data?.features || [];
    
    if (features.length === 0) {
      console.log('USGS: No significant earthquakes this month');
      return [];
    }
    
    const earthquakes = features.slice(0, limit).map(eq => ({
      source: 'USGS',
      title: `${eq.properties.place || 'Earthquake'} - Magnitude ${eq.properties.mag}`,
      url: eq.properties.url || 'https://earthquake.usgs.gov/'
    }));
    
    console.log(`USGS: ${earthquakes.length} earthquakes`);
    return earthquakes;
    
  } catch (error) {
    console.error('USGS error:', error.message);
    return [];
  }
}

async function fetchFEMA(limit) {
  try {
    console.log('Fetching FEMA updates...');
    const response = await axios.get('https://www.fema.gov/about/news-multimedia', {
      timeout: 5000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    const alerts = [];
    
    // Try multiple selectors for FEMA news
    $('.card__title, .news-title, h3, h4').slice(0, limit * 2).each((i, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      const link = $el.closest('a').attr('href') || $el.find('a').attr('href');
      
      if (title && title.length > 15) {
        alerts.push({
          source: 'FEMA',
          title: title.substring(0, 150),
          url: link && link.startsWith('http') ? link : `https://www.fema.gov${link || '/about/news-multimedia'}`
        });
      }
    });
    
    console.log(`FEMA: ${alerts.length} updates`);
    return alerts.slice(0, limit);
    
  } catch (error) {
    console.error('FEMA error:', error.message);
    return [];
  }
}

// ========== Error Handling ==========
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// ========== Start Server ==========
app.listen(PORT, () => {
  console.log(` FeedFrame Backend running on port ${PORT}`);
  console.log(` Health check: http://localhost:${PORT}/health`);
  console.log(` Test endpoint: http://localhost:${PORT}/api/test`);
});

// ========== Graceful Shutdown ==========
process.on('SIGINT', async () => {
  console.log('\n Shutting down...');
  await client.close();
  process.exit(0);
});