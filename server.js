const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
const PORT = 4242;

// Middleware to parse JSON
app.use(express.json());

// This is a public sample test API key.
// Don’t submit any personally identifiable information in requests made with this key.
// Sign in to see your own test API key embedded in code samples.
const stripe = require('stripe')(`${process.env.VITE_STRIPE_CLIENT_SECRET}`);

// const stripe = require("stripe")('sk_test_51QX2EjD1HGHWO4740PkSZeF6kW0QpepPxc8BNFLpEDEZXuIXdABA9sTEs0zAWKFJyLmNSnEPatPGqx9TlzW49gKU00UmX8e3aw');
console.log('VITE_STRIPE_CLIENT_SECRET', process.env.VITE_STRIPE_CLIENT_SECRET);
const calculateOrderAmount = items => {
  // Calculate the order total on the server to prevent
  // people from directly manipulating the amount on the client
  let total = 0;
  items.forEach(item => {
    total += item.amount;
  });
  return total;
};

app.post('/create-payment-intent', async (req, res) => {
  const { items } = req.body;
  console.log('🚀 ~ app.post ~ items:', items);

  // Create a PaymentIntent with the order amount and currency
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: calculateOrderAmount(items),
      currency: 'usd',
      // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.statusCode(200).send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.statusCode(500).send(error);
  }
});

// Salesforce base configuration
const BASE_URL =
  process.env.BASE_URL || 'https://chfusa--dec2024.sandbox.my.salesforce.com';
const API_VERSION = process.env.API_VERSION || 'v57.0';
let accessToken;

// Middleware to set Authorization header
app.use((req, res, next) => {
  req.headers['Authorization'] = `Bearer ${accessToken}`;
  next();
});

// Helper function to make Salesforce API requests
const salesforceRequest = async (method, endpoint, data = {}) => {
  try {
    const url = `${BASE_URL}/services/data/${API_VERSION}/${endpoint}`;
    const response = await axios({
      method,
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
      data,
    });
    return response.data;
  } catch (error) {
    throw error.response ? error.response.data : error;
  }
};

// Refresh Access Token
const refreshAccessToken = async () => {
  try {
    const response = await axios.post(
      `${BASE_URL}/services/oauth2/token`,
      null,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        params: {
          grant_type: 'password',
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
          username: process.env.USERNAME,
          password: process.env.PASSWORD,
        },
      }
    );
    accessToken = response.data.access_token;
    console.log('Access token refreshed successfully');
  } catch (error) {
    console.error('Error refreshing access token:', error);
    throw error;
  }
};

// Wrapper APIs

// 1. Contact Query
app.get('/api/contact', async (req, res) => {
  try {
    const email = req.query.email;
    const query = `SELECT Id, Name, AccountId FROM Contact WHERE Email = '${email}'`;
    const data = await salesforceRequest(
      'GET',
      `query?q=${encodeURIComponent(query)}`
    );
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
    const data = await salesforceRequest(
      'PATCH',
      `sobjects/Account/${accountId}`,
      req.body
    );
    res.json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 4. Opportunity Create
app.post('/api/opportunity', async (req, res) => {
  try {
    const data = await salesforceRequest(
      'POST',
      'sobjects/Opportunity',
      req.body
    );
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 5. Opportunity Update
app.patch('/api/opportunity/:id', async (req, res) => {
  try {
    const opportunityId = req.params.id;
    const data = await salesforceRequest(
      'PATCH',
      `sobjects/Opportunity/${opportunityId}`,
      req.body
    );
    res.json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 6. DonationSummary Create
app.post('/api/donationsummary', async (req, res) => {
  try {
    const data = await salesforceRequest(
      'POST',
      'sobjects/DonationSummary__c',
      req.body
    );
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// Internal API for refreshing access token
app.post('/internal/refresh-token', async (req, res) => {
  try {
    await refreshAccessToken();
    res.status(200).json({ message: 'Access token refreshed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to refresh access token', error });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
