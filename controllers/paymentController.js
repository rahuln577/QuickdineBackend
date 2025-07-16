const { getDB } = require('../config/firebase'); // Changed to use getDB
const crypto = require('crypto');
const Razorpay = require('razorpay');

const createOrder = async (req, res) => {
  try {
    const { amount, currency, items, orderType, orderData } = req.body;
    const userId = req.user.uid;
    const user = req.user; // Assuming you have the user object from auth middleware

    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: amount * 100, // Razorpay expects amount in paise
      currency: currency || 'INR',
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1
    });

    // Get database reference
    const db = getDB();
    
    // Create paths matching the frontend structure
    const customerOrderRef = db.ref(`CustomerUsers/${userId}/orderHistory`).push();
    const globalOrderRef = db.ref('orders').push();
    
    // Prepare order data matching the frontend structure
    const firebaseOrderData = {
      // Razorpay information
      razorpayOrderId: razorpayOrder.id,
      
      // Order metadata
      orderNumber: `ORD-${Date.now()}`,
      restaurantName: orderData?.restaurantName || 'Unknown Restaurant',
      restaurantAddress: orderData?.restaurantAddress || '',
      restaurantUid: orderData?.restaurantUid || '',
      totalPrice: amount,
      status: 'created', // Will transition to 'paid' after successful payment
      timestamp: Date.now(),
      customerName: user.displayName || 'Customer',
      customerUid: userId,
      
      // Order items (standardized format)
      items: items.map(item => ({
        name: item.name || item.foodName || 'Unknown Item',
        price: item.price || 0,
        quantity: item.quantity || 1
      })),
      
      // Additional fields
      orderType: orderType || 'dine_in',
      createdAt: Date.now(),
      
      // References
      globalOrderId: globalOrderRef.key, // Link to global orders collection
      customerOrderId: customerOrderRef.key // Link to customer's order history
    };

    // Save to both locations (transaction would be better here)
    await customerOrderRef.set(firebaseOrderData);
    await globalOrderRef.set(firebaseOrderData);

    res.json({
      id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      firebaseOrderId: customerOrderRef.key, // Return the customer-specific ID
      orderData: firebaseOrderData // Return full order data for client-side use
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