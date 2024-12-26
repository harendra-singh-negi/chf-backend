const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 4242;

// Middleware to parse JSON
app.use(express.json());

// Salesforce base configuration
const BASE_URL = 'https://chfusa--dec2024.sandbox.my.salesforce.com';
const API_VERSION = 'v57.0';
let accessToken = 'YOUR_ACCESS_TOKEN'; // Replace with a valid access token

// Middleware to set Authorization header
app.use((req, res, next) => {
  req.headers['Authorization'] = `Bearer ${accessToken}`;
  next();
});

// Helper function to make Salesforce API requests
const salesforceRequest = async (method, endpoint, data = {}) => {
  try {
    const url = `${BASE_URL}/services/data/${API_VERSION}/${endpoint}`;
    const response = await axios({ method, url, headers: { Authorization: `Bearer ${accessToken}` }, data });
    return response.data;
  } catch (error) {
    throw error.response ? error.response.data : error;
  }
};

// Wrapper APIs

// 1. Contact Query
app.get('/api/contact', async (req, res) => {
  try {
    const email = req.query.email;
    const query = `SELECT Id, Name, AccountId FROM Contact WHERE Email = '${email}'`;
    const data = await salesforceRequest('GET', `query?q=${encodeURIComponent(query)}`);
    res.json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 2. Contact Create
app.post('/api/contact', async (req, res) => {
  try {
    const data = await salesforceRequest('POST', 'sobjects/Contact', req.body);
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 3. Account Update
app.patch('/api/account/:id', async (req, res) => {
  try {
    const accountId = req.params.id;
    const data = await salesforceRequest('PATCH', `sobjects/Account/${accountId}`, req.body);
    res.json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 4. Opportunity Create
app.post('/api/opportunity', async (req, res) => {
  try {
    const data = await salesforceRequest('POST', 'sobjects/Opportunity', req.body);
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 5. Opportunity Update
app.patch('/api/opportunity/:id', async (req, res) => {
  try {
    const opportunityId = req.params.id;
    const data = await salesforceRequest('PATCH', `sobjects/Opportunity/${opportunityId}`, req.body);
    res.json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 6. DonationSummary Create
app.post('/api/donationsummary', async (req, res) => {
  try {
    const data = await salesforceRequest('POST', 'sobjects/DonationSummary__c', req.body);
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
