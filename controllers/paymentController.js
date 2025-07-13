const { getDB } = require('../config/firebase'); // Changed to use getDB
const razorpay = require('../config/razorpay');
const crypto = require('crypto');

const createOrder = async (req, res) => {
  try {
    const { amount, currency, items, orderType } = req.body;
    const userId = req.user.uid;

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
      status: 'created',
      amount,
      currency: currency || 'INR',
      userId,
      items,
      orderType: orderType || 'dine_in',
      createdAt: Date.now() // Using Date.now() instead of serverTimestamp
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

const Razorpay = require('razorpay');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;

    // Razorpay's official verification method
    const isValid = razorpay.validateWebhookSignature(
      `${orderId}|${paymentId}`,
      signature,
      process.env.RAZORPAY_WEBHOOK_SECRET
    );

    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature',
        message: 'Payment verification failed'
      });
    }

    // Verify payment status through API
    const payment = await razorpay.payments.fetch(paymentId);
    
    if (payment.status !== 'captured') {
      return res.status(400).json({
        success: false,
        error: `Payment status: ${payment.status}`
      });
    }

    // Update your database
    await updateOrderStatus(orderId, {
      status: 'paid',
      paymentId,
      paymentSignature: signature,
      paidAt: new Date()
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Payment verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Payment verification failed',
      details: error.message
    });
  }
};

module.exports = { createOrder, verifyPayment };