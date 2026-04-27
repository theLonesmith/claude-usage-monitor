#!/usr/bin/env node
/**
 * generate-demo-data.js
 * 
 * Generates realistic demo usage history for screenshots.
 * Run once: node generate-demo-data.js
 * Then restart the app to see the history in the charts.
 */

const fs = require('fs');
const path = require('path');

// Get the userData directory (same as main.js uses)
const userDataPath = path.join(process.env.APPDATA || process.env.HOME, 'Claude Usage Monitor');
const historyFile = path.join(userDataPath, 'history.json');

// Ensure directory exists
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

// Generate realistic data for the past 7 days
const data = [];
const now = Date.now();
const oneHour = 60 * 60 * 1000;
const oneDay = 24 * 60 * 60 * 1000;

// Simulate usage patterns:
// - Session usage fluctuates randomly (spikes when using Claude, drops when idle)
// - Weekly usage gradually increases throughout the week (building toward limit)
let weeklyAccumulation = 0.15; // Start mid-week at ~15%

for (let daysBack = 7; daysBack >= 0; daysBack--) {
  const dayStart = now - (daysBack * oneDay);
  
  // Generate hourly data points for this day (every 2 hours for realism)
  for (let hour = 0; hour < 24; hour += 2) {
    const timestamp = dayStart + (hour * oneHour);
    
    // Session: random spikes (user actively using Claude)
    // Typically 0-60% during active hours, low at night
    const hourOfDay = new Date(timestamp).getHours();
    const isActiveHour = hourOfDay >= 8 && hourOfDay <= 23;
    const baseSession = isActiveHour ? Math.random() * 0.6 : Math.random() * 0.1;
    const sessionWithSpike = Math.random() > 0.7 ? baseSession + Math.random() * 0.3 : baseSession;
    const session = Math.min(0.95, Math.max(0, sessionWithSpike));
    
    // Weekly: gradually increases, a bit of randomness
    const dailyIncrease = 0.12 + Math.random() * 0.08;
    weeklyAccumulation = Math.min(0.99, weeklyAccumulation + dailyIncrease / 12);
    const weekly = weeklyAccumulation + (Math.random() - 0.5) * 0.05;
    
    data.push({
      ts: timestamp,
      s: Math.round(session * 10000) / 10000,
      w: Math.round(Math.max(0, Math.min(1, weekly)) * 10000) / 10000,
    });
  }
  
  // Reset session at end of each day (5-hour window resets)
  weeklyAccumulation += 0.12;
}

// Write to history.json
try {
  fs.writeFileSync(historyFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ Generated ${data.length} demo data points`);
  console.log(`✓ Saved to: ${historyFile}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart the Claude Usage Monitor app');
  console.log('  2. Open "Usage History" tab to see the charts');
  console.log('  3. Take your screenshots');
  console.log('  4. (Optional) Run this script again to regenerate fresh data');
  console.log('');
} catch (err) {
  console.error('✗ Error writing history file:', err.message);
  process.exit(1);
}
