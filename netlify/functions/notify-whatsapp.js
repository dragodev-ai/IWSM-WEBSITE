/**
 * Netlify Serverless Function: WhatsApp Lead Notification Dispatcher
 * Dispatches lead alerts to both IWSM admission numbers:
 * 1. +91 8107911127
 * 2. +91 8690211127
 */

const RECIPIENT_NUMBERS = ['918107911127', '918690211127'];

exports.handler = async function (event, context) {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const { full_name, phone, email, course, timestamp } = payload;

    if (!full_name || !phone) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'full_name and phone are required fields.' })
      };
    }

    const formattedDate = timestamp 
      ? new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) 
      : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Format Alert Message for Counselors
    const message = [
      '🚨 *NEW IWSM ADMISSION ENQUIRY* 🚨',
      '────────────────────────────',
      `👤 *Student Name:* ${full_name}`,
      `📱 *Mobile Number:* +91 ${phone}`,
      `📧 *Email:* ${email || 'Not provided'}`,
      `🎓 *Course:* ${course || 'Gamma Plan'}`,
      `🕒 *Time (IST):* ${formattedDate}`,
      '────────────────────────────',
      `👉 *Direct WhatsApp with Student:* https://wa.me/91${phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${full_name}, thank you for enquiring about ${course} at IWSM Jaipur! When is a good time to speak?`)}`
    ].join('\n');

    // Optional WhatsApp Gateway API Dispatch (if environment variables are provided)
    const gatewayUrl = process.env.WHATSAPP_WEBHOOK_URL;
    const gatewayToken = process.env.WHATSAPP_API_TOKEN;
    let gatewayDispatched = false;

    if (gatewayUrl) {
      try {
        await fetch(gatewayUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(gatewayToken ? { 'Authorization': `Bearer ${gatewayToken}` } : {})
          },
          body: JSON.stringify({
            recipients: RECIPIENT_NUMBERS,
            message: message,
            lead: payload
          })
        });
        gatewayDispatched = true;
      } catch (err) {
        console.warn('[notify-whatsapp] Gateway dispatch warning:', err.message);
      }
    }

    // Prepare deep links for both numbers
    const waLinks = RECIPIENT_NUMBERS.map(num => ({
      number: num,
      link: `https://wa.me/${num}?text=${encodeURIComponent(message)}`
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        recipients: RECIPIENT_NUMBERS,
        gatewayDispatched,
        waLinks,
        messagePreview: message
      })
    };
  } catch (error) {
    console.error('[notify-whatsapp] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};
