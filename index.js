const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Initialize Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Firebase Admin Initialization (Requires serviceAccountKey.json)
// You need to download this from Firebase Console -> Project Settings -> Service Accounts
try {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin Initialized');
} catch (error) {
  console.warn('Firebase Admin SDK not initialized: serviceAccountKey.json missing');
}

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.send('Invoxa Backend is running!');
});

// Create Order
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', planId } = req.body;
    
    const options = {
      amount: amount * 100, // Amount in paise
      currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        planId
      }
    };

    const order = await razorpay.orders.create(options);
    res.status(200).json(order);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Verify Payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      userId,
      planId,
      userEmail,
      amount
    } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      // Payment Verified!
      
      // 1. Update User Plan in Firebase
      if (admin.apps.length > 0) {
        const userRef = admin.firestore().collection('users').doc(userId);
        const planName = planId === 'pro' ? 'Premium Pro' : 'Elite Business';
        const limit = planId === 'pro' ? 100 : 999999;
        
        await userRef.update({
          'subscription.planId': planId,
          'subscription.planName': planName,
          'subscription.status': 'active',
          'subscription.invoiceLimit': limit,
          'subscription.remainingInvoices': limit,
          'subscription.startDate': new Date().toISOString(),
          'subscription.expiryDate': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          'totalPaid': admin.firestore.FieldValue.increment(amount)
        });
      }

      // 2. Send Confirmation Email
      const mailOptions = {
        from: `"Invoxa" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: 'Your Invoxa Premium Plan is Active!',
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #18181b;">
            <h1 style="font-weight: 900; text-transform: uppercase;">Payment Successful!</h1>
            <p>Thank you for upgrading to <b>${planId === 'pro' ? 'Premium Pro' : 'Elite Business'}</b>.</p>
            <p>Your professional billing tools are now fully unlocked.</p>
            <hr />
            <p><b>Transaction ID:</b> ${razorpay_payment_id}</p>
            <p><b>Amount Paid:</b> ₹${amount}</p>
            <br />
            <p>Best regards,<br />Invoxa Team</p>
          </div>
        `
      };

      try {
        await transporter.sendMail(mailOptions);
      } catch (mailError) {
        console.warn('Failed to send confirmation email, but payment was successful:', mailError);
      }

      return res.status(200).json({ message: "Payment verified successfully" });
    } else {
      return res.status(400).json({ message: "Invalid signature sent!" });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Custom Password Reset Email Endpoint
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (admin.apps.length === 0) {
    return res.status(500).json({ error: 'Backend is not fully configured (missing serviceAccountKey.json)' });
  }

  try {
    // Generate a custom password reset link using Firebase Admin SDK
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    // Send the link using Nodemailer
    const mailOptions = {
      from: `"Invoxa" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Invoxa Password',
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #18181b; max-width: 600px; margin: 0 auto; border: 1px solid #f4f4f5; border-radius: 16px;">
          <h1 style="font-weight: 900; text-transform: uppercase; letter-spacing: -0.5px;">Password Reset</h1>
          <p style="color: #52525b; line-height: 1.6;">Hello,</p>
          <p style="color: #52525b; line-height: 1.6;">We received a request to reset the password for your Invoxa account associated with this email address.</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetLink}" style="display: inline-block; padding: 14px 28px; background-color: #18181b; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; font-size: 12px;">Reset Password</a>
          </div>
          <p style="color: #52525b; line-height: 1.6;">If you did not request a password reset, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #f4f4f5; margin: 30px 0;" />
          <p style="font-size: 11px; color: #a1a1aa; word-break: break-all;">If the button doesn't work, copy and paste this URL into your browser:<br/><br/>${resetLink}</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return res.status(200).json({ message: 'Password reset email sent successfully.' });

  } catch (error) {
    console.error('Error generating/sending reset email:', error);
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'No user found with this email address.' });
    }
    return res.status(500).json({ error: 'Failed to send reset email. Ensure Email App Password is set.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
// Nodemon restart trigger
