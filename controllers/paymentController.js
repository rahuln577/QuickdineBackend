const { getDB } = require('../config/firebase'); // Changed to use getDB
const crypto = require('crypto');
const Razorpay = require('razorpay');

const createOrder = async (req, res) => {
  try {
    const {
      amount,
      currency = 'INR', // Default to INR if not provided
      items,
      orderType = 'dine_in', // Default to dine_in
      restaurantUid,
      restaurantName,
      restaurantAddress,
      customerName,
      customerUid, // userId will come from this
      // Include any other fields you expect from the frontend
    } = req.body;

    // Validate required fields
    if (!amount || !items || !restaurantUid || !customerUid) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await newOrderRef.set({
      razorpayOrderId: razorpayOrder.id,
      status: 'created',
      amount: Number(amount), // Ensure it's a number
      currency,
      userId: customerUid, // Using the customerUid from request
      items: Array.isArray(items) ? items : [], // Ensure items is an array
      orderType,
      restaurantUid,
      restaurantName: restaurantName || 'Unknown Restaurant',
      restaurantAddress: restaurantAddress || '',
      customerName: customerName || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // Better than Date.now()
      // Additional metadata
      paymentGateway: 'razorpay',
      platform: 'web', // Can detect from headers if needed
      orderNumber: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}` // Simple order number
    });


    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: amount * 100,
      currency: currency || 'INR',
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1
    });

    // Save to Realtime Database
    const db = getDB();
    const ordersRef = db.ref('orders');
    const newOrderRef = ordersRef.push(); // Generates a new unique ID

    await newOrderRef.set({
      razorpayOrderId: razorpayOrder.id,
      status: 'created',  // Initial status
      amount: totalPrice,  // Should match the payment amount
      currency: 'INR',     // Fixed as INR or use parameter
      userId: customerUid, // From your frontend data
      items: orderItems,   // The mapped items array
      orderType: orderType || 'dine_in',  // Default to dine_in
      restaurantUid: restaurantUid,
      restaurantName: restaurantName,
      restaurantAddress: restaurantAddress,
      userId: userId,
      customerName: customerName,  // From frontend
      orderNumber: generateOrderNumber(), // You might want to generate this
      timestamp: Date.now(),       // Using client timestamp
      // Additional useful fields:
      paymentGateway: 'razorpay',
      platform: 'web'             // or 'android'/'ios' if applicable
    });

    res.json({
      id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      firebaseOrderId: newOrderRef.key // Using the RTDB generated key
    });

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      error: 'Failed to create order',
      details: error.message
    });
  }
};

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const verifyPayment = async (req, res) => {
  const { order_id, payment_id, razorpay_signature } = req.body;

  // 1. Generate HMAC-SHA256 signature
  const generated_signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${order_id}|${payment_id}`)
    .digest('hex');

  // 2. Compare signatures
  if (generated_signature !== razorpay_signature) {
    console.error('Signature Mismatch', {
      input: `${order_id}|${payment_id}`,
      generated: generated_signature,
      received: razorpay_signature
    });
    return res.status(400).json({
      verified: false,
      error: 'Invalid signature'
    });
  }

  // 3. Verify payment status via API
  try {
    const payment = await razorpay.payments.fetch(payment_id);
    return res.json({
      verified: payment.status === 'captured',
      payment_status: payment.status
    });
  } catch (error) {
    console.error('Payment fetch error:', error);
    return res.status(500).json({
      verified: false,
      error: 'Payment verification failed'
    });
  }
};

module.exports = { createOrder, verifyPayment };