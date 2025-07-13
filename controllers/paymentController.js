const { getDB } = require('../config/firebase'); // Changed to use getDB
const razorpay = require('../config/razorpay');

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

const verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;
    const userId = req.user.uid;

    // 1. Verify the signature manually
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(orderId + "|" + paymentId)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error('Signature verification failed', {
        expected: expectedSignature,
        received: signature
      });
      return res.status(400).json({
        success: false,
        error: 'Invalid signature'
      });
    }

    // 2. Verify payment with Razorpay API
    const payment = await razorpay.payments.fetch(paymentId);

    if (!payment || payment.status !== 'captured') {
      return res.status(400).json({
        success: false,
        error: payment ? `Payment not captured (status: ${payment.status})` : 'Payment not found'
      });
    }

    // 3. Find and update the order
    const ordersRef = db.ref('orders');
    const snapshot = await ordersRef
      .orderByChild('razorpayOrderId')
      .equalTo(orderId)
      .once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    let orderKey = null;
    snapshot.forEach((childSnapshot) => {
      if (childSnapshot.val().userId === userId) {
        orderKey = childSnapshot.key;
      }
    });

    if (!orderKey) {
      return res.status(403).json({
        success: false,
        error: 'Order does not belong to user'
      });
    }

    await ordersRef.child(orderKey).update({
      status: 'paid',
      paymentId,
      paymentSignature: signature,
      paidAt: Date.now(),
      paymentStatus: payment.status
    });

    res.json({
      success: true,
      orderId: orderKey,
      paymentStatus: payment.status
    });

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