/**
 * IWSM Supabase Client & WhatsApp Notification Dispatcher
 * Handles:
 * 1. Storing leads in Supabase database (`leads` table)
 * 2. Dispatching automated WhatsApp notifications to both admission numbers (+91 8107911127 & +91 8690211127)
 */

(function () {
  'use strict';

  // ============================================================================
  // Supabase Configuration
  // ============================================================================
  // Replace these with your Supabase Project settings from:
  // Supabase Dashboard -> Project Settings -> API
  const SUPABASE_CONFIG = {
    url: window.IWSM_SUPABASE_URL || 'https://yrhsinstwwjqhixxxacx.supabase.co',
    anonKey: window.IWSM_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_PUBLIC_KEY',
    tableName: 'leads',
    recipientNumbers: ['918107911127', '918690211127']
  };

  let supabaseClient = null;

  // Initialize Supabase if credentials are valid
  function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;

    if (
      window.supabase &&
      SUPABASE_CONFIG.url &&
      !SUPABASE_CONFIG.url.includes('YOUR_PROJECT_ID') &&
      SUPABASE_CONFIG.anonKey &&
      !SUPABASE_CONFIG.anonKey.includes('YOUR_SUPABASE_ANON_PUBLIC_KEY')
    ) {
      try {
        supabaseClient = window.supabase.createClient(
          SUPABASE_CONFIG.url,
          SUPABASE_CONFIG.anonKey
        );
        console.log('✅ [IWSM] Supabase client initialized successfully.');
      } catch (err) {
        console.warn('⚠️ [IWSM] Supabase initialization error:', err.message);
      }
    }
    return supabaseClient;
  }

  // ============================================================================
  // Lead Submission to Supabase
  // ============================================================================
  async function submitLeadToSupabase(leadData) {
    const payload = {
      full_name: leadData.name,
      phone: leadData.phone,
      email: leadData.email && leadData.email !== 'N/A' ? leadData.email : null,
      course: leadData.course,
      source: 'IWSM Website Hero Form',
      created_at: new Date().toISOString()
    };

    const client = getSupabaseClient();
    let savedToSupabase = false;
    let supabaseError = null;

    if (client) {
      try {
        const { data, error } = await client
          .from(SUPABASE_CONFIG.tableName)
          .insert([payload]);

        if (error) {
          supabaseError = error.message;
          console.error('❌ [IWSM] Supabase insert failed:', error);
        } else {
          savedToSupabase = true;
          console.log('🎉 [IWSM] Lead saved to Supabase successfully:', data);
        }
      } catch (err) {
        supabaseError = err.message;
        console.error('❌ [IWSM] Supabase network exception:', err);
      }
    } else {
      console.info(
        'ℹ️ [IWSM] Supabase project credentials pending. Lead stored in local backup. Please configure SUPABASE_URL and SUPABASE_ANON_KEY.'
      );
    }

    // Always maintain a safe local backup
    try {
      const backup = JSON.parse(localStorage.getItem('iwsm_leads_backup') || '[]');
      backup.push({ ...payload, savedToSupabase, backupTime: new Date().toISOString() });
      localStorage.setItem('iwsm_leads_backup', JSON.stringify(backup));
    } catch (e) {
      console.warn('Local backup warning:', e);
    }

    return {
      success: savedToSupabase,
      error: supabaseError,
      payload
    };
  }

  // ============================================================================
  // WhatsApp Notification Dispatcher
  // ============================================================================
  async function dispatchWhatsAppAlerts(leadData) {
    const payload = {
      full_name: leadData.name,
      phone: leadData.phone,
      email: leadData.email,
      course: leadData.course,
      timestamp: new Date().toISOString()
    };

    let serverlessResult = null;

    // 1. Attempt Netlify Serverless Function call
    try {
      const response = await fetch('/.netlify/functions/notify-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        serverlessResult = await response.json();
        console.log('✅ [IWSM] WhatsApp notification dispatched via Netlify function.');
      }
    } catch (err) {
      // Offline / Local development fallback
      console.log('ℹ️ [IWSM] Serverless function not active locally. Using direct WhatsApp routing.');
    }

    // 2. Generate formatted WhatsApp direct messages for both admission lines
    const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const formattedMessage = encodeURIComponent(
      `🚨 *NEW IWSM ADMISSION ENQUIRY* 🚨\n` +
      `────────────────────────────\n` +
      `👤 *Student Name:* ${leadData.name}\n` +
      `📱 *Mobile Number:* +91 ${leadData.phone}\n` +
      `📧 *Email:* ${leadData.email || 'Not provided'}\n` +
      `🎓 *Course:* ${leadData.course}\n` +
      `🕒 *Time (IST):* ${dateStr}\n` +
      `────────────────────────────\n` +
      `👉 *Connect with Student:* https://wa.me/91${leadData.phone.replace(/\D/g, '')}`
    );

    const links = SUPABASE_CONFIG.recipientNumbers.map((num) => ({
      number: num,
      url: `https://wa.me/${num}?text=${formattedMessage}`
    }));

    return {
      serverlessResult,
      links,
      payload
    };
  }

  // Expose to window for global access
  window.IWSM_BACKEND = {
    config: SUPABASE_CONFIG,
    getSupabaseClient,
    submitLeadToSupabase,
    dispatchWhatsAppAlerts
  };
})();
