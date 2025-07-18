const { getDB } = require('../config/firebase'); // Changed to use getDB
const crypto = require('crypto');
const Razorpay = require('razorpay');

const createOrder = async (req, res) => {
  try {
    const { amount, currency, items, orderType, customerUid, restaurantName, restaurantUid } = req.body;
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
    const ordersRef = db.ref(`orders/${restaurantUid}`);
    const newOrderRef = ordersRef.push();
    
    // Transaction to safely increment order number
    const latestOrderNumberRef = db.ref(`orders/${restaurantUid}/latestOrderNumber`);
    const { snapshot } = await latestOrderNumberRef.transaction((currentNumber) => {
      return (currentNumber || 99) + 1;
    });

    const newOrderNumber = snapshot.val() >= 500 ? 100 : snapshot.val();
    
    const orderData = {
      razorpayOrderId: razorpayOrder.id,
      status: 'created',
      totalPrice: amount,
      currency: currency || 'INR',
      userId,
      items,
      orderType: orderType || 'dine_in',
      timestamp: Date.now(),
      customerUid,
      restaurantName,
      restaurantUid,
      orderNumber: newOrderNumber
    };

    // Save all data in one atomic operation
    const updates = {
      [`orders/${restaurantUid}/${newOrderRef.key}`]: orderData,
      [`orders/${restaurantUid}/latestOrderNumber`]: newOrderNumber,
      [`CustomerUsers/${userId}/orderHistory/${newOrderRef.key}`]: orderData
    };

    await db.ref().update(updates);

    res.json({
      id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      firebaseOrderId: newOrderRef.key,
      orderNumber: newOrderNumber
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