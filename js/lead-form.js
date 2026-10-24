/** Enquiry confirmation is shown only after the server confirms the saved row. */
(function () {
  'use strict';

  var forms = document.querySelectorAll('form.lead-form');
  var modal = document.querySelector('.lead-confirm-modal');
  var closeButton = document.querySelector('.confirm-modal-close');
  var details = document.querySelector('#confirm-details-text');
  var whatsappActions = document.querySelector('#confirm-whatsapp-actions');
  var previousFocus = null;
  var uncertainMessage = 'We could not confirm that your enquiry was saved. Please try again. Your details are still here.';

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
    // getRandomValues also works on ordinary LAN HTTP, where randomUUID may be absent.
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
        // The existing confirmation has one action; keep keyboard focus in it.
        event.preventDefault();
        closeButton.focus();
      }
    });
  }

  forms.forEach(function (form, index) {
    if (form.dataset.enquiryFormBound) return;
    form.dataset.enquiryFormBound = 'true';
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
      if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Saving your enquiry…'; }
      setStatus('Saving your enquiry…', false);
      var timeoutId;

      try {
        if (window.location.protocol === 'file:') throw displayError('Please open the website through its local preview or published website to submit your enquiry.');
        var fingerprint = JSON.stringify(submittedDetails);
        if (fingerprint !== retryFingerprint || !retryId) {
          retryId = submissionId();
          retryFingerprint = fingerprint;
        }
        var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
        var request = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: name, phone: phone, email: email, course: course, submission_id: retryId, 'bot-field': trap ? trap.value : '' })
        };
        if (controller) request.signal = controller.signal;
        // Promise.race still stops the UI waiting when AbortController/AbortSignal.timeout is unavailable.
        var timeout = new Promise(function (resolve, reject) {
          timeoutId = window.setTimeout(function () {
            reject(displayError(uncertainMessage));
            if (controller) controller.abort();
          }, 25000);
        });
        var receipt = await Promise.race([
          window.fetch('/.netlify/functions/collect-enquiry', request).then(async function (response) {
            return { response: response, result: await response.json() };
          }),
          timeout
        ]);
        var result = receipt.result;
        if (!receipt.response.ok || !result || typeof result !== 'object' || Array.isArray(result) || result.success !== true) {
          var serverMessage = result && typeof result.error === 'string' ? result.error.slice(0, 300) : uncertainMessage;
          throw displayError(serverMessage);
        }
        if (result.submission_id !== retryId || typeof result.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(result.month)) {
          throw displayError(uncertainMessage);
        }

        if (details) details.textContent = name + ', your enquiry for ' + course + ' has been saved. The IWSM team will contact you about course details.';
        if (whatsappActions) { whatsappActions.replaceChildren(); whatsappActions.style.display = 'none'; }
        if (modal) {
          previousFocus = submitButton || document.activeElement;
          modal.classList.add('active');
          modal.setAttribute('aria-hidden', 'false');
          if (closeButton) closeButton.focus();
        }
        if (JSON.stringify(currentDetails()) === fingerprint) {
          setStatus('Your enquiry has been saved. Thank you for choosing us.', false);
          form.reset();
        } else {
          // A slow response must not discard edits that were not in that saved request.
          setStatus('Your submitted enquiry has been saved. Your newer changes are still in the form.', false);
        }
        retryId = '';
        retryFingerprint = '';
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
