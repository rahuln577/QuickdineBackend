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

const verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;
    
    // 1. Create the HMAC SHA256 signature
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET);
    hmac.update(`${orderId}|${paymentId}`);
    const generatedSignature = hmac.digest('hex');

    // Debug logs (remove in production)
    console.log('Signature Verification:', {
      input: `${orderId}|${paymentId}`,
      generated: generatedSignature,
      received: signature,
      secretPresent: !!process.env.RAZORPAY_WEBHOOK_SECRET
    });

    // 2. Verify the signatures match
    if (generatedSignature !== signature) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature',
        debug: {
          expectedLength: generatedSignature.length,
          receivedLength: signature.length
        }
      });
    }

    // 3. Verify payment status with Razorpay API
    const payment = await razorpay.payments.fetch(paymentId);
    if (payment.status !== 'captured') {
      return res.status(400).json({
        success: false,
        error: `Payment status: ${payment.status}`
      });
    }

    // 4. Update your database
    await updateOrderStatus(orderId, {
      status: 'paid',
      paymentId,
      paymentSignature: signature,
      paidAt: new Date()
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Payment verification failed',
      details: error.message
    });
  }
};

module.exports = { createOrder, verifyPayment };