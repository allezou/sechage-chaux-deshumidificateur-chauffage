/*
 * server.js
 * Small Express backend that requests Tuya OpenAPI on behalf of the frontend.
 * Requirements: Node 18+ (global fetch available). Uses environment variables for secrets.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.TUYA_CLIENT_ID;
const CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET;
const DEVICE_ID = process.env.TUYA_DEVICE_ID;
const BASE_URL = process.env.TUYA_BASE_URL || 'https://openapi.tuyaeu.com';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'; // set in production to your frontend origin

if (!CLIENT_ID || !CLIENT_SECRET || !DEVICE_ID) {
  console.warn('Missing TUYA credentials. Please set TUYA_CLIENT_ID, TUYA_CLIENT_SECRET, TUYA_DEVICE_ID in environment.');
}

app.use(express.json());
app.use(cors({ origin: CORS_ORIGIN }));

let cachedToken = null;
let tokenExpiry = 0;

function sha256Hex(body = '') {
  return crypto.createHash('sha256').update(body).digest('hex').toUpperCase();
}

function calcSign(clientId, secret, timestamp, accessToken = '', method = 'GET', urlPath = '/v1.0/token?grant_type=1') {
  const bodySha = sha256Hex('');
  const toSign = clientId + accessToken + timestamp + method + '\n' + bodySha + '\n\n' + urlPath;
  return crypto.createHmac('sha256', secret).update(toSign).digest('hex').toUpperCase();
}

async function getTuyaToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('TUYA credentials not configured');

  const t = Date.now().toString();
  const urlPath = '/v1.0/token?grant_type=1';
  const sign = calcSign(CLIENT_ID, CLIENT_SECRET, t, '', 'GET', urlPath);

  const res = await fetch(BASE_URL + urlPath, {
    method: 'GET',
    headers: {
      'client_id': CLIENT_ID,
      'sign': sign,
      't': t,
      'sign_method': 'HMAC-SHA256'
    }
  });

  const json = await res.json();
  if (!json || !json.result || !json.result.access_token) throw new Error('No token from Tuya: ' + JSON.stringify(json));

  cachedToken = json.result.access_token;
  // expire_time_seconds may be provided by Tuya; else fallback 1 hour
  const expiresIn = (json.result.expire_time_seconds || 3600);
  tokenExpiry = Date.now() + (expiresIn - 30) * 1000;
  return cachedToken;
}

function normalizeValue(val) {
  if (typeof val !== 'number') return val;
  // many Tuya sensors return temperature * 10
  if (val > 50) return val / 10;
  return val;
}

function mapTuyaResult(resultArray) {
  let tempIn, humIn, tempOut, humOut;
  (resultArray || []).forEach(dp => {
    const code = (dp.code || dp.id || '').toString().toLowerCase();
    const value = dp.value;

    if (/temp_indoor|temperature_indoor|va_temperature|temp_in|temp_indoor/i.test(code)) tempIn = value;
    if (/humidity_indoor|humidity_internal|va_humidity|hum_in|humidity_indoor/i.test(code)) humIn = value;
    if (/temp_outdoor|temperature_outdoor|temp_current|temp_out|temperature_out/i.test(code)) tempOut = value;
    if (/humidity_outdoor|humidity_out|humidity/i.test(code) && !/indoor/.test(code)) humOut = value;
  });

  // apply normalization
  if (tempIn !== undefined) tempIn = normalizeValue(tempIn);
  if (tempOut !== undefined) tempOut = normalizeValue(tempOut);

  return { tempIn, humIn, tempOut, humOut };
}

app.get('/api/weather', async (req, res) => {
  try {
    const token = await getTuyaToken();
    const t = Date.now().toString();
    const urlPath = `/v1.0/devices/${DEVICE_ID}/status`;
    const sign = calcSign(CLIENT_ID, CLIENT_SECRET, t, token, 'GET', urlPath);

    const resp = await fetch(BASE_URL + urlPath, {
      method: 'GET',
      headers: {
        'client_id': CLIENT_ID,
        'access_token': token,
        'sign': sign,
        't': t,
        'sign_method': 'HMAC-SHA256'
      }
    });

    const body = await resp.json();
    if (!body || !body.success || !Array.isArray(body.result)) {
      return res.status(502).json({ success: false, message: 'Erreur Tuya', body });
    }

    const mapped = mapTuyaResult(body.result);

    return res.json({ success: true, ...mapped, raw_count: body.result.length });
  } catch (err) {
    console.error('Error in /api/weather:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Tuya backend listening on port ${PORT}`);
});
