const { db } = require('../config/firebase');
const razorpay = require('../config/razorpay');
const { FieldValue } = require('firebase-admin/firestore');

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

    // Save to Firestore
    const orderRef = await db.collection('orders').add({
      razorpayOrderId: razorpayOrder.id,
      status: 'created',
      amount,
      currency: currency || 'INR',
      userId,
      items,
      orderType: orderType || 'dine_in',
      createdAt: FieldValue.serverTimestamp()
    });

    res.json({
      id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      firebaseOrderId: orderRef.id
    });

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
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

    // Update order in Firestore
    const ordersRef = db.collection('orders');
    const query = await ordersRef
      .where('razorpayOrderId', '==', orderId)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (query.empty) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const orderDoc = query.docs[0];
    await orderDoc.ref.update({
      status: 'paid',
      paymentId,
      paymentSignature: signature,
      paidAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, orderId: orderDoc.id });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
};
module.exports = { createOrder, verifyPayment };