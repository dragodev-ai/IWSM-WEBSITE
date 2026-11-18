/** Enquiry confirmation is shown immediately once Google Sheets confirms the saved row; Excel/Gmail delivery runs asynchronously in the background. */
(function () {
  'use strict';

  var forms = document.querySelectorAll('form.lead-form');
  var modal = document.querySelector('.lead-confirm-modal');
  var closeButton = document.querySelector('.confirm-modal-close');
  var details = document.querySelector('#confirm-details-text');
  var coursePill = document.querySelector('#confirm-course-pill');
  var confettiCanvas = document.querySelector('#iwsm-confetti-canvas');
  var whatsappActions = document.querySelector('#confirm-whatsapp-actions');
  var previousFocus = null;
  var confettiFrame = null;
  var prewarmed = false;
  var uncertainMessage = 'We could not confirm that your enquiry was saved. Please try again. Your details are still here.';
  var publicEnquiryUrl = 'https://script.google.com/macros/s/AKfycbx_L4Hp3yDer-w-QT4CzrYwxFpwrPCUJRCuXYthJSxI0T0C60QmEn6OLZqQiBfQ-zvqBA/exec';

  function prewarmEndpoint() {
    if (prewarmed) return;
    prewarmed = true;
    try {
      ['https://script.google.com', 'https://script.googleusercontent.com'].forEach(function (href) {
        var link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = href;
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
      });
      // Non-blocking HEAD/GET warm-up of TLS socket
      window.fetch(publicEnquiryUrl, { method: 'HEAD', mode: 'no-cors' }).catch(function () {});
    } catch (e) {}
  }

  function stopConfetti() {
    if (confettiFrame) {
      window.cancelAnimationFrame(confettiFrame);
      confettiFrame = null;
    }
    if (confettiCanvas && confettiCanvas.getContext) {
      var ctx = confettiCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  }

  function launchConfettiBurst() {
    if (!confettiCanvas || !confettiCanvas.getContext) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    stopConfetti();
    var card = confettiCanvas.parentElement;
    var rect = card ? card.getBoundingClientRect() : { width: 440, height: 380 };
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(320, rect.width || 440);
    var h = Math.max(300, rect.height || 380);
    confettiCanvas.width = Math.round(w * dpr);
    confettiCanvas.height = Math.round(h * dpr);
    var ctx = confettiCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var colors = ['#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#fbbf24', '#34d399'];
    var pieces = [];
    var originX = w * 0.5;
    var originY = 82;
    for (var i = 0; i < 72; i++) {
      var angle = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.15;
      var speed = 4.2 + Math.random() * 6.8;
      pieces.push({
        x: originX + (Math.random() - 0.5) * 28,
        y: originY + (Math.random() - 0.5) * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        w: 6 + Math.random() * 5,
        h: 4 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.28,
        color: colors[i % colors.length],
        circle: i % 5 === 0,
        alpha: 1
      });
    }

    var start = performance.now();
    function tick(now) {
      var elapsed = now - start;
      ctx.clearRect(0, 0, w, h);
      var alive = 0;
      for (var j = 0; j < pieces.length; j++) {
        var p = pieces[j];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.19;
        p.vx *= 0.988;
        p.rot += p.vrot;
        if (elapsed > 1700) p.alpha = Math.max(0, 1 - (elapsed - 1700) / 850);
        if (p.alpha <= 0 || p.y > h + 24) continue;
        alive++;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.circle) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w * 0.5, -p.h * 0.5, p.w, p.h);
        }
        ctx.restore();
      }
      if (alive > 0 && elapsed < 2650) {
        confettiFrame = window.requestAnimationFrame(tick);
      } else {
        stopConfetti();
      }
    }
    confettiFrame = window.requestAnimationFrame(tick);
  }

  async function postEnquiryRequest(payload, signal) {
    var isStaticHost = /\.github\.io$/i.test(window.location.hostname || '');
    if (!isStaticHost) {
      try {
        var proxyReq = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        };
        if (signal) proxyReq.signal = signal;
        var proxyRes = await window.fetch('/.netlify/functions/collect-enquiry', proxyReq);
        var proxyType = (proxyRes.headers && proxyRes.headers.get('content-type')) || '';
        if (proxyRes.status !== 404 && proxyRes.status !== 405 && proxyType.indexOf('application/json') !== -1) {
          return { response: proxyRes, result: await proxyRes.json() };
        }
      } catch (proxyErr) {
        if (signal && signal.aborted) throw proxyErr;
      }
    }
    var directReq = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        public_form: 'iwsm-counselling-v1',
        full_name: payload.full_name,
        phone: payload.phone,
        email: payload.email,
        course: payload.course,
        submission_id: payload.submission_id,
        'bot-field': payload['bot-field']
      }),
      redirect: 'follow'
    };
    if (signal) directReq.signal = signal;
    var directRes = await window.fetch(publicEnquiryUrl, directReq);
    return { response: directRes, result: await directRes.json() };
  }

  function triggerBackgroundExcelDelivery() {
    try {
      window.fetch(publicEnquiryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ public_form: 'iwsm-counselling-v1', action: 'deliver_pending' }),
        keepalive: true,
        redirect: 'follow'
      }).catch(function () {});
    } catch (e) {}
  }

  function displayError(message) {
    var error = new Error(message);
    error.displayMessage = message;
    return error;
  }

  function submissionId() {
    var crypto = window.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch (error) { /* Try the LAN-compatible secure API below. */ }
    }
    if (!crypto || typeof crypto.getRandomValues !== 'function') {
      throw displayError('Your browser cannot securely submit this form. Please use an updated browser or contact IWSM admissions.');
    }
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (byte) { return ('0' + byte.toString(16)).slice(-2); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function closeConfirmation() {
    if (!modal) return;
    stopConfetti();
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    previousFocus = null;
  }

  if (modal && !modal.dataset.enquiryConfirmationBound) {
    modal.dataset.enquiryConfirmationBound = 'true';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');
    var title = modal.querySelector('.phonepe-title');
    if (title) {
      if (!title.id) title.setAttribute('id', 'iwsm-enquiry-confirm-title');
      modal.setAttribute('aria-labelledby', title.id);
    }
    if (details) modal.setAttribute('aria-describedby', 'confirm-details-text');
    if (closeButton) closeButton.addEventListener('click', closeConfirmation);
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeConfirmation();
    });
    document.addEventListener('keydown', function (event) {
      if (!modal.classList.contains('active')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeConfirmation();
      } else if (event.key === 'Tab' && closeButton) {
        event.preventDefault();
        closeButton.focus();
      }
    });
  }

  forms.forEach(function (form, index) {
    if (form.dataset.enquiryFormBound) return;
    form.dataset.enquiryFormBound = 'true';
    form.addEventListener('focusin', prewarmEndpoint, { once: true });
    form.addEventListener('pointerenter', prewarmEndpoint, { once: true });

    var nameInput = form.querySelector('input[name="fullname"]') || form.querySelector('input[placeholder*="Name"]');
    var phoneInput = form.querySelector('input[name="phone"]') || form.querySelector('input[type="tel"]');
    var emailInput = form.querySelector('input[name="email"]') || form.querySelector('input[type="email"]');
    var courseSelect = form.querySelector('select');
    var submitButton = form.querySelector('button[type="submit"]');
    var trap = form.querySelector('[name="bot-field"]');
    var inputs = [nameInput, phoneInput, emailInput, courseSelect];
    var pending = false;
    var retryFingerprint = '';
    var retryId = '';
    var status = form.querySelector('.submission-status');
    if (!status) {
      status = document.createElement('p');
      status.className = 'submission-status';
      form.appendChild(status);
    }
    if (!status.id) status.setAttribute('id', (form.id || 'iwsm-enquiry-' + index) + '-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    form.setAttribute('aria-busy', 'false');
    inputs.forEach(function (input) {
      if (!input) return;
      var describedBy = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (describedBy.indexOf(status.id) === -1) describedBy.push(status.id);
      input.setAttribute('aria-describedby', describedBy.join(' '));
    });

    function setStatus(message, isError) {
      status.setAttribute('role', isError ? 'alert' : 'status');
      status.setAttribute('aria-live', isError ? 'assertive' : 'polite');
      status.textContent = message;
    }

    function invalid(input, message) {
      if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
      setStatus(message, true);
    }

    function currentDetails() {
      return [
        nameInput ? nameInput.value.trim() : '',
        phoneInput ? phoneInput.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '') : '',
        emailInput ? emailInput.value.trim() : '',
        courseSelect ? courseSelect.value.trim() : ''
      ];
    }

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (pending) return;
      inputs.forEach(function (input) { if (input) input.removeAttribute('aria-invalid'); });
      var submittedDetails = currentDetails();
      var name = submittedDetails[0], phone = submittedDetails[1], email = submittedDetails[2], course = submittedDetails[3];

      if (!name || name.length > 120) return invalid(nameInput, 'Please enter your full name (up to 120 characters).');
      if (!/^[6-9]\d{9}$/.test(phone)) return invalid(phoneInput, 'Please enter a valid 10-digit Indian mobile number.');
      if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return invalid(emailInput, 'Please enter a valid email address, or leave this optional field blank.');
      if (!course || course.length > 300) return invalid(courseSelect, 'Please select your course or interest.');

      pending = true;
      form.setAttribute('aria-busy', 'true');
      var originalButtonHTML = submitButton ? submitButton.innerHTML : '';
      if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Submitting…'; }
      setStatus('Confirming your counselling request…', false);
      var timeoutId;

      try {
        if (window.location.protocol === 'file:') throw displayError('Please open the website through its local preview or published website to submit your enquiry.');
        var fingerprint = JSON.stringify(submittedDetails);
        if (fingerprint !== retryFingerprint || !retryId) {
          retryId = submissionId();
          retryFingerprint = fingerprint;
        }
        var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
        var payload = { full_name: name, phone: phone, email: email, course: course, submission_id: retryId, 'bot-field': trap ? trap.value : '' };
        var timeout = new Promise(function (resolve, reject) {
          timeoutId = window.setTimeout(function () {
            reject(displayError(uncertainMessage));
            if (controller) controller.abort();
          }, 30000);
        });
        var receipt = await Promise.race([
          postEnquiryRequest(payload, controller ? controller.signal : null),
          timeout
        ]);
        var result = receipt.result;
        if (!receipt.response.ok || !result || typeof result !== 'object' || Array.isArray(result) || result.success !== true) {
          var codeMsg = result && result.code === 'invalid_details'
            ? 'Please check your details and try again.'
            : result && result.code === 'rate_limited'
            ? 'Too many enquiries submitted right now. Please wait a minute and try again.'
            : '';
          var serverMessage = result && typeof result.error === 'string' ? result.error.slice(0, 300) : (codeMsg || uncertainMessage);
          throw displayError(serverMessage);
        }
        if (result.submission_id !== retryId || typeof result.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(result.month)) {
          throw displayError(uncertainMessage);
        }

        if (details) {
          details.textContent = 'Please have patience — the IWSM team will contact you soon.';
        }
        if (coursePill) {
          coursePill.textContent = name + ' • ' + course;
          coursePill.hidden = false;
        }
        if (whatsappActions) { whatsappActions.replaceChildren(); whatsappActions.style.display = 'none'; }
        if (modal) {
          previousFocus = submitButton || document.activeElement;
          modal.classList.add('active');
          modal.setAttribute('aria-hidden', 'false');
          window.requestAnimationFrame(launchConfettiBurst);
          if (closeButton) closeButton.focus();
        }
        if (JSON.stringify(currentDetails()) === fingerprint) {
          setStatus('You are on the right path! Please have patience — the IWSM team will contact you soon.', false);
          form.reset();
        } else {
          setStatus('Your submitted enquiry has been saved. Your newer changes are still in the form.', false);
        }
        retryId = '';
        retryFingerprint = '';

        // Trigger Excel export & Gmail delivery asynchronously in the background (0ms UI wait!)
        if (!result.duplicate) {
          triggerBackgroundExcelDelivery();
        }
      } catch (error) {
        setStatus(error && error.displayMessage ? error.displayMessage : uncertainMessage, true);
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        pending = false;
        form.setAttribute('aria-busy', 'false');
        if (submitButton) { submitButton.disabled = false; submitButton.innerHTML = originalButtonHTML; }
      }
    });
  });
})();
