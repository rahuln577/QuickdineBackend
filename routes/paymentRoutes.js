const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { createOrder, verifyPayment } = require('../controllers/paymentController');
const Razorpay = require('razorpay');

const router = express.Router();

router.post('/create-order', authenticate, createOrder);
router.post('/verify-payment', authenticate, verifyPayment);
router.post('/:orderId/fail', authenticate, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reason } = req.body;
        
        // Validate order exists
        const orderRef = firestore.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();
        
        if (!orderDoc.exists) {
            return res.status(404).json({ 
                success: false,
                message: 'Order not found'
            });
        }
        
        // Update order status to failed
        await orderRef.update({
            status: 'failed',
            failedAt: new Date(),
            failureReason: reason || 'Payment failed',
            updatedAt: new Date()
        });
        
        // Optionally: Notify restaurant or customer
        
        res.json({ 
            success: true,
            message: 'Order marked as failed'
        });
        
    } catch (error) {
        console.error('Failed to mark order as failed:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

router.post('/:orderId/cancel', authenticate, async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.uid; // Get from authenticated user

        // Get the order first to verify ownership
        const orderRef = db.ref(`orders/${orderId}`);
        const snapshot = await orderRef.once('value');
        
        if (!snapshot.exists()) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const orderData = snapshot.val();
        
        // Verify the user owns this order
        if (orderData.userId !== userId) {
            return res.status(403).json({ error: 'Not authorized to cancel this order' });
        }

        // Only allow cancellation if order is still pending
        if (orderData.status !== 'created') {
            return res.status(400).json({ 
                error: `Order cannot be cancelled in current state (${orderData.status})`
            });
        }

        // Update order status to cancelled
        await orderRef.update({
            status: 'cancelled',
            cancelledAt: Date.now(),
            cancelledBy: userId
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({ 
            error: 'Failed to cancel order',
            details: error.message 
        });
    }
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/**
 * Initiates a refund for a given order
 * @param {string} orderId - Your internal order ID
 * @param {number} amount - Amount to refund (in paise for INR)
 * @param {string} [reason] - Reason for refund
 * @param {string} [speed] - Refund speed ('normal' or 'optimum')
 * @returns {Promise<Object>} Refund details
 */
async function initiateRefund(orderId, amount, reason = 'User requested cancellation', speed = 'normal') {
  try {
    // 1. Get the order document from Firestore
    const orderRef = firestore.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();
    
    if (!orderDoc.exists) {
      throw new Error('Order not found in database');
    }
    
    const orderData = orderDoc.data();
    
    // 2. Validate the order can be refunded
    if (!orderData.paymentId) {
      throw new Error('No payment ID associated with this order');
    }
    
    if (orderData.paymentStatus !== 'captured') {
      throw new Error(`Payment status is ${orderData.paymentStatus}, cannot refund`);
    }
    
    if (orderData.amountRefunded && orderData.amountRefunded >= orderData.totalAmount) {
      throw new Error('Full amount already refunded');
    }
    
    // 3. Prepare refund payload
    const refundPayload = {
      payment_id: orderData.paymentId,
      amount: amount, // in paise
      speed: speed, // 'normal' or 'optimum'
      notes: {
        reason: reason,
        order_id: orderId,
        initiated_by: 'system' // or user ID if available
      }
    };
    
    // 4. Create refund using Razorpay API
    const refundResponse = await razorpay.payments.refund(refundPayload);
    
    // 5. Update Firestore with refund details
    const refundData = {
      refundId: refundResponse.id,
      refundAmount: refundResponse.amount,
      refundStatus: refundResponse.status,
      refundCreatedAt: new Date(refundResponse.created_at * 1000),
      refundReason: reason,
      refundSpeed: speed
    };
    
    // Calculate new refund totals
    const newRefundedAmount = (orderData.amountRefunded || 0) + refundResponse.amount;
    const isFullRefund = newRefundedAmount >= orderData.totalAmount;
    
    await orderRef.update({
      refunds: firestore.FieldValue.arrayUnion(refundData),
      amountRefunded: newRefundedAmount,
      paymentStatus: isFullRefund ? 'refunded' : 'partially_refunded',
      updatedAt: new Date()
    });
    
    // 6. Optionally: Send refund receipt to customer
    await sendRefundNotification(orderData.customerUid, {
      orderId,
      amount: refundResponse.amount / 100, // Convert to rupees
      currency: refundResponse.currency,
      refundId: refundResponse.id
    });
    
    return {
      success: true,
      refundId: refundResponse.id,
      amount: refundResponse.amount,
      status: refundResponse.status,
      message: 'Refund initiated successfully'
    };
    
  } catch (error) {
    console.error(`Refund failed for order ${orderId}:`, error);
    
    // Log the refund failure in Firestore
    if (orderRef) {
      await orderRef.update({
        refundAttempts: firestore.FieldValue.arrayUnion({
          timestamp: new Date(),
          amount,
          error: error.message,
          status: 'failed'
        }),
        updatedAt: new Date()
      });
    }
    
    throw new Error(`Refund failed: ${error.message}`);
  }
}

module.exports = router;