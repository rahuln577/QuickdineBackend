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

    // Verify signature
    const generatedSignature = razorpay.webhooks.generateSignature(
      orderId + "|" + paymentId,
      process.env.RAZORPAY_WEBHOOK_SECRET
    );

    if (generatedSignature !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Update order in Realtime Database
    const db = getDB();
    const ordersRef = db.ref('orders');
    
    // Find order by razorpayOrderId and userId
    const snapshot = await ordersRef
      .orderByChild('razorpayOrderId')
      .equalTo(orderId)
      .once('value');

    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Order not found' });
    }

    let orderKey = null;
    let orderData = null;
    
    snapshot.forEach((childSnapshot) => {
      if (childSnapshot.val().userId === userId) {
        orderKey = childSnapshot.key;
        orderData = childSnapshot.val();
      }
    });

    if (!orderKey) {
      return res.status(404).json({ error: 'Order not found for user' });
    }

    // Update the order
    await ordersRef.child(orderKey).update({
      status: 'paid',
      paymentId,
      paymentSignature: signature,
      paidAt: Date.now()
    });

    res.json({ 
      success: true, 
      orderId: orderKey 
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ 
      error: 'Payment verification failed',
      details: error.message 
    });
  }
};

module.exports = { createOrder, verifyPayment };