require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();

// Middleware
const corsOptions = {
  origin: 'https://flourishing-peony-e65bc5.netlify.app',
  credentials: true,
  optionsSuccessStatus: 200,
  exposedHeaders: [
    'x-razorpay-signature',
    'x-rtb-fingerprint-id',
    'x-razorpay-order-id',
    'content-type',
    'authorization'
  ],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'x-razorpay-signature'
  ]
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// Routes
app.use('/api/payments', paymentRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});