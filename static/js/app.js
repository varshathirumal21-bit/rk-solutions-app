let currentUser = null;
let currentBanners = [];
let bannerTimer = null;
let currentBannerIdx = 0;
let tempCustomerPayload = null;
const screenHistory = [];
let resendTimerInterval = null;

const currentLoadedScriptsMap = {};

document.addEventListener('DOMContentLoaded', async () => {
  cleanInputsOnLoad();
  setupVirtualOtpCollector();
  checkSession();
});

function cleanInputsOnLoad() {
  const emailInput = document.getElementById('login-email');
  if (emailInput) {
    emailInput.value = '';
    emailInput.setAttribute('value', '');
  }
  resetVirtualOtp();
}

async function checkSession() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.logged_in) {
      currentUser = data.user;
      renderAppShell();
    } else {
      showLoginScreen();
    }
  } catch (err) {
    showLoginScreen();
  }
}

function showLoginScreen() {
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  cleanInputsOnLoad();
}

function renderAppShell() {
  document.getElementById('screen-login').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  const memberId = currentUser.member_id;
  const userName = currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Partner');

  document.getElementById('header-member-id').innerText = memberId;
  document.getElementById('user-subtext').innerText = `Member ID: ${memberId}`;
  document.getElementById('referral-url').value = `https://rksolutions.app/ref/${memberId}`;

  document.getElementById('prof-name').innerText = userName;
  document.getElementById('prof-email').innerText = currentUser.email || '---';
  document.getElementById('prof-city').innerText = currentUser.city || 'Coimbatore';
  document.getElementById('prof-member-id').innerText = `Member ID: ${memberId}`;

  const adminBtn = document.getElementById('header-admin-btn');
  if (adminBtn) adminBtn.classList.toggle('hidden', currentUser.role !== 'admin');

  // Only the admin gets the advertisement manager button (the server enforces this too).
  const adsAdminBox = document.getElementById('ads-admin-actions');
  if (adsAdminBox) adsAdminBox.classList.toggle('hidden', currentUser.role !== 'admin');

  startBannerPolling();

  if (currentUser.role === 'admin') {
    // Admin always lands on the Admin Team Members page.
    switchTab('admin-team', false);
  } else {
    switchTab('dashboard', false);
  }
}

function switchTab(tabId, addToHistory = true) {
  const currentActive = document.querySelector('.sub-screen.active');
  const currentActiveId = currentActive ? currentActive.id.replace('screen-', '') : null;

  if (addToHistory && currentActiveId && currentActiveId !== tabId) {
    screenHistory.push(currentActiveId);
  }

  document.querySelectorAll('.sub-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  const targetScreen = document.getElementById(`screen-${tabId}`);
  if (targetScreen) targetScreen.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(btn => {
    const text = btn.innerText.toLowerCase().trim();
    if (
      (tabId === 'dashboard' && text === 'home') ||
      (tabId === 'customers' && text === 'customers') ||
      (tabId.startsWith('training') && text === 'training') ||
      (tabId === 'reports' && text === 'reports') ||
      (tabId === 'profile' && text === 'profile')
    ) {
      btn.classList.add('active');
    }
  });

  const titles = {
    'dashboard': 'Dashboard',
    'customers': 'Customer List',
    'training': 'Training & Resources',
    'training-videos': 'Training Videos',
    'training-scripts': 'Sales Scripts',
    'training-faq': 'FAQ',
    'training-posters': 'Posters',
    'training-smartbook': 'Sample Smart Book',
    'reports': 'My Reports',
    'profile': 'My Profile',
    'payment-success': 'Payment Confirmation',
    'admin': 'Admin Portal',
    'admin-team': 'Admin Team Members'
  };
  document.getElementById('header-title').innerText = titles[tabId] || 'RK Solutions';

  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'customers') loadCustomerList();
  if (tabId === 'reports') loadReports();
  if (tabId === 'admin') loadAdminPanel();
  document.body.classList.toggle('admin-team-wide', tabId === 'admin-team');
  if (tabId === 'admin-team') loadAdminTeam();
}

function navigatePreviousScreen() {
  if (screenHistory.length > 0) {
    const prev = screenHistory.pop();
    switchTab(prev, false);
  } else {
    switchTab('dashboard', false);
  }
}

// --------------------------------------------------------
// VIRTUAL 6-DIGIT OTP COLLECTOR
// --------------------------------------------------------
function resetVirtualOtp() {
  const collector = document.getElementById('otp-hidden-collector');
  if (collector) collector.value = '';
  for (let i = 0; i < 6; i++) {
    const box = document.getElementById(`otp-box-${i}`);
    if (box) {
      box.innerText = '';
      box.classList.remove('active-focus');
    }
  }
  updateLoginButtonState('');
}

function focusOtpCollector() {
  const collector = document.getElementById('otp-hidden-collector');
  if (collector) {
    collector.focus();
    updateVirtualOtpBoxes();
  }
}

function updateVirtualOtpBoxes() {
  const collector = document.getElementById('otp-hidden-collector');
  if (!collector) return;

  const val = collector.value.replace(/[^0-9]/g, '').slice(0, 6);
  collector.value = val;

  for (let i = 0; i < 6; i++) {
    const box = document.getElementById(`otp-box-${i}`);
    if (box) {
      box.innerText = val[i] || '';
      if (i === val.length && val.length < 6) {
        box.classList.add('active-focus');
      } else {
        box.classList.remove('active-focus');
      }
    }
  }
  updateLoginButtonState(val);
}

function updateLoginButtonState(otpVal) {
  const btn = document.getElementById('btn-verify-otp');
  if (!btn) return;
  if (otpVal.length === 6) {
    btn.disabled = false;
    btn.classList.remove('disabled-btn');
  } else {
    btn.disabled = true;
    btn.classList.add('disabled-btn');
  }
}

function setupVirtualOtpCollector() {
  const collector = document.getElementById('otp-hidden-collector');
  if (!collector) return;

  resetVirtualOtp();
  collector.addEventListener('input', updateVirtualOtpBoxes);
  collector.addEventListener('focus', updateVirtualOtpBoxes);
  collector.addEventListener('blur', () => {
    for (let i = 0; i < 6; i++) {
      const box = document.getElementById(`otp-box-${i}`);
      if (box) box.classList.remove('active-focus');
    }
  });

  const emailInput = document.getElementById('login-email');
  if (emailInput) {
    emailInput.addEventListener('input', resetVirtualOtp);
  }
}

// --------------------------------------------------------
// SEND REAL EMAIL OTP (BREVO FREE REST API)
// --------------------------------------------------------
async function sendLoginEmailOTP() {
  const emailInput = document.getElementById('login-email');
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    alert('Please enter a valid email address (e.g. name@gmail.com).');
    return;
  }

  resetVirtualOtp();
  const btn = document.getElementById('btn-send-otp');
  btn.disabled = true;
  btn.innerText = 'Sending OTP...';

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ email: email, purpose: 'LOGIN' })
    });
    
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      startResendCooldown(data.cooldown || 60);
      focusOtpCollector();
    } else {
      alert(data.message || 'Error delivering verification code.');
      btn.disabled = false;
      btn.innerText = 'Send OTP';
    }
  } catch (err) {
    console.error('Fetch error:', err);
    alert('Error communicating with server. Check terminal console.');
    btn.disabled = false;
    btn.innerText = 'Send OTP';
  }
}

function startResendCooldown(durationSeconds = 60) {
  const btn = document.getElementById('btn-send-otp');
  const timerLabel = document.getElementById('otp-timer-label');
  let seconds = durationSeconds;

  btn.disabled = true;
  timerLabel.classList.remove('hidden');

  if (resendTimerInterval) clearInterval(resendTimerInterval);

  resendTimerInterval = setInterval(() => {
    seconds--;
    timerLabel.innerText = `Resend OTP in ${seconds}s`;
    btn.innerText = `Wait (${seconds}s)`;

    if (seconds <= 0) {
      clearInterval(resendTimerInterval);
      btn.disabled = false;
      btn.innerText = 'Resend OTP';
      timerLabel.classList.add('hidden');
    }
  }, 1000);
}

// --------------------------------------------------------
// VERIFY 6-DIGIT EMAIL OTP
// --------------------------------------------------------
async function verifyLoginEmailOTP() {
  const emailInput = document.getElementById('login-email');
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const collector = document.getElementById('otp-hidden-collector');
  const digits = collector ? collector.value.trim() : '';

  if (digits.length !== 6) {
    alert('Please enter the complete 6-digit verification code.');
    return;
  }

  const btn = document.getElementById('btn-verify-otp');
  btn.disabled = true;
  btn.innerText = 'Verifying...';

  try {
    const res = await fetch('/api/auth/verify-otp-login', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ email: email, otp: digits })
    });
    const data = await res.json();
    if (data.success) {
      currentUser = data.user;
      renderAppShell();
    } else {
      alert(data.message);
      resetVirtualOtp();
      focusOtpCollector();
    }
  } catch (err) {
    alert('Failed to verify OTP. Please try again.');
  } finally {
    btn.innerText = 'Login';
  }
}

async function logoutApp() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
}

// --------------------------------------------------------
// DASHBOARD
// --------------------------------------------------------
async function loadDashboard() {
  if (currentUser && currentUser.member_id) {
    document.getElementById('user-subtext').innerText = `Member ID: ${currentUser.member_id}`;
    document.getElementById('header-member-id').innerText = currentUser.member_id;
  }

  const dateVal = document.getElementById('dash-date-filter').value;
  let url = '/api/dashboard';
  if (dateVal) url += `?date=${dateVal}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.success) {
    document.getElementById('metric-membership').innerText = data.metrics.membership_count;
    document.getElementById('metric-smartbook').innerText = data.metrics.smartbook_count;
    document.getElementById('metric-earnings').innerText = `₹${data.metrics.paid_earnings.toLocaleString()}`;
    document.getElementById('metric-wallet').innerText = `₹${data.metrics.wallet_balance.toLocaleString()}`;

    currentBanners = data.banners;
    startBannerRotation();
  }
}

function onDashboardDateChange() { loadDashboard(); }

function startBannerRotation() {
  if (bannerTimer) { clearInterval(bannerTimer); bannerTimer = null; }

  const container = document.querySelector('.banner-container');
  if (container) container.classList.toggle('hidden', !currentBanners.length);
  if (!currentBanners.length) return;

  renderBannerDots();
  renderBannerSlide(0);
  if (currentBanners.length > 1) {
    bannerTimer = setInterval(() => {
      currentBannerIdx = (currentBannerIdx + 1) % currentBanners.length;
      renderBannerSlide(currentBannerIdx);
    }, 3000);
  }
}

function renderBannerDots() {
  const dotsBox = document.getElementById('banner-dots');
  if (!dotsBox) return;
  dotsBox.innerHTML = '';
  currentBanners.forEach((b, i) => {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.addEventListener('click', (ev) => { ev.stopPropagation(); setBanner(i); });
    dotsBox.appendChild(dot);
  });
}

function renderBannerSlide(idx) {
  currentBannerIdx = idx;
  const b = currentBanners[idx];
  if (!b) return;

  document.getElementById('banner-title').innerText = b.title || '';
  document.getElementById('banner-subtitle').innerText = b.subtitle || '';

  const slide = document.querySelector('.banner-container');
  if (slide) {
    if (b.image_url) {
      const safeUrl = String(b.image_url).replace(/"/g, '%22');
      slide.style.backgroundImage = `linear-gradient(rgba(15,23,42,0.50), rgba(15,23,42,0.50)), url("${safeUrl}")`;
      slide.style.backgroundSize = 'cover';
      slide.style.backgroundPosition = 'center';
    } else {
      slide.style.backgroundImage = '';
      slide.style.backgroundSize = '';
      slide.style.backgroundPosition = '';
    }
    const link = /^https?:\/\//i.test(b.action_url || '') ? b.action_url : '';
    slide.style.cursor = link ? 'pointer' : '';
    slide.onclick = link ? () => window.open(link, '_blank', 'noopener') : null;
  }

  const dots = document.querySelectorAll('#banner-dots .dot');
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

function setBanner(idx) { renderBannerSlide(idx); }

// Advertisements are managed by the admin only. Users' dashboards re-check them regularly,
// so a change made by the admin shows up without the user having to log in again.
let bannerPollTimer = null;

function bannerSignature(list) {
  return JSON.stringify((list || []).map(b => [b.slot, b.title, b.subtitle, b.image_url, b.action_url]));
}

async function refreshBannersNow(force = false) {
  try {
    const res = await fetch('/api/banners');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && (force || bannerSignature(data.banners) !== bannerSignature(currentBanners))) {
      currentBanners = data.banners;
      startBannerRotation();
    }
  } catch (err) { /* network hiccup: try again on the next cycle */ }
}

function startBannerPolling() {
  if (bannerPollTimer) return;
  const tick = () => {
    const dash = document.getElementById('screen-dashboard');
    if (!currentUser || document.hidden || !dash || !dash.classList.contains('active')) return;
    refreshBannersNow(false);
  };
  bannerPollTimer = setInterval(tick, 30000);
  document.addEventListener('visibilitychange', tick);
}

// --------------------------------------------------------
// ADMIN ONLY: MANAGE THE 3 DASHBOARD ADVERTISEMENTS
// --------------------------------------------------------
const AD_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const AD_ALLOWED_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

function openAdsManager() {
  if (!currentUser || currentUser.role !== 'admin') return;
  openModal('modal-manage-ads');
  loadAdsManager();
}

async function loadAdsManager() {
  const box = document.getElementById('ads-slots-container');
  box.innerHTML = '<div class="text-center p-3 text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Loading advertisements...</div>';
  try {
    const res = await fetch('/api/admin/banners');
    const data = await res.json();
    if (!data.success) {
      box.innerHTML = `<div class="team-msg team-msg-warn">${escapeHtml(data.message || 'Unable to load advertisements.')}</div>`;
      return;
    }
    box.innerHTML = '';
    data.slots.forEach(entry => box.appendChild(buildAdSlotCard(entry.slot, entry.banner)));
  } catch (err) {
    box.innerHTML = '<div class="team-msg team-msg-warn">Unable to load advertisements. Please try again.</div>';
  }
}

function buildAdSlotCard(slot, banner) {
  const card = document.createElement('div');
  card.className = 'ad-slot-card';
  card.innerHTML = `
    <div class="ad-slot-head">
      <strong>Advertisement ${slot}</strong>
      <span class="ad-slot-state ${banner ? 'ad-state-live' : 'ad-state-empty'}">${banner ? 'Live' : 'Empty'}</span>
    </div>
    <div class="ad-preview" id="ad-preview-${slot}"><span>No image</span></div>
    <input type="file" id="ad-file-${slot}" accept=".png,.jpg,.jpeg,.gif,.webp,image/*" onchange="onAdFilePicked(${slot}, this)">
    <input type="text" id="ad-title-${slot}" placeholder="Title" maxlength="120">
    <input type="text" id="ad-subtitle-${slot}" placeholder="Short description" maxlength="240">
    <input type="url" id="ad-link-${slot}" placeholder="Link when tapped (optional, https://...)">
    <div class="ad-slot-actions">
      <button type="button" class="btn btn-primary btn-sm" onclick="saveAdSlot(${slot})">
        <i class="fa-solid fa-floppy-disk"></i> ${banner ? 'Update' : 'Add'}
      </button>
      ${banner ? `<button type="button" class="btn btn-danger btn-sm" onclick="deleteAdSlot(${slot})"><i class="fa-solid fa-trash"></i> Delete</button>` : ''}
    </div>
    <div class="ad-slot-msg" id="ad-msg-${slot}"></div>`;

  if (banner) {
    card.querySelector(`#ad-title-${slot}`).value = banner.title || '';
    card.querySelector(`#ad-subtitle-${slot}`).value = banner.subtitle || '';
    card.querySelector(`#ad-link-${slot}`).value = banner.action_url || '';
    setAdPreview(card.querySelector(`#ad-preview-${slot}`), banner.image_url);
  }
  return card;
}

function setAdPreview(previewEl, url) {
  if (!previewEl) return;
  if (url) {
    previewEl.style.backgroundImage = `url("${String(url).replace(/"/g, '%22')}")`;
    previewEl.classList.add('has-image');
  } else {
    previewEl.style.backgroundImage = '';
    previewEl.classList.remove('has-image');
  }
}

function onAdFilePicked(slot, input) {
  const msg = document.getElementById(`ad-msg-${slot}`);
  msg.innerHTML = '';
  const file = input.files && input.files[0];
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!AD_ALLOWED_EXT.includes(ext)) {
    msg.innerHTML = '<div class="team-msg team-msg-warn">Please choose a PNG, JPG, GIF or WEBP image.</div>';
    input.value = '';
    return;
  }
  if (file.size > AD_MAX_IMAGE_BYTES) {
    msg.innerHTML = '<div class="team-msg team-msg-warn">Image is larger than 5 MB.</div>';
    input.value = '';
    return;
  }
  setAdPreview(document.getElementById(`ad-preview-${slot}`), URL.createObjectURL(file));
}

async function saveAdSlot(slot) {
  const msg = document.getElementById(`ad-msg-${slot}`);
  const fd = new FormData();
  fd.append('title', document.getElementById(`ad-title-${slot}`).value.trim());
  fd.append('subtitle', document.getElementById(`ad-subtitle-${slot}`).value.trim());
  fd.append('action_url', document.getElementById(`ad-link-${slot}`).value.trim());
  const fileInput = document.getElementById(`ad-file-${slot}`);
  if (fileInput.files && fileInput.files[0]) fd.append('image', fileInput.files[0]);

  msg.innerHTML = '<span class="text-sm text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Saving...</span>';
  try {
    const res = await fetch(`/api/admin/banners/${slot}`, { method: 'POST', body: fd });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (data && data.success) {
      await loadAdsManager();
      const freshMsg = document.getElementById(`ad-msg-${slot}`);
      if (freshMsg) freshMsg.innerHTML = '<div class="team-msg team-msg-ok"><i class="fa-solid fa-circle-check"></i> Saved. Users will see this on their dashboard.</div>';
      refreshBannersNow(true);
    } else {
      msg.innerHTML = `<div class="team-msg team-msg-warn">${escapeHtml((data && data.message) || `Could not save (server error ${res.status}).`)}</div>`;
    }
  } catch (err) {
    msg.innerHTML = '<div class="team-msg team-msg-warn">Network error. Please try again.</div>';
  }
}

async function deleteAdSlot(slot) {
  if (!confirm(`Delete Advertisement ${slot}? It will disappear from every user's dashboard.`)) return;
  const msg = document.getElementById(`ad-msg-${slot}`);
  try {
    const res = await fetch(`/api/admin/banners/${slot}`, { method: 'DELETE' });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (data && data.success) {
      await loadAdsManager();
      refreshBannersNow(true);
    } else {
      msg.innerHTML = `<div class="team-msg team-msg-warn">${escapeHtml((data && data.message) || 'Could not delete the advertisement.')}</div>`;
    }
  } catch (err) {
    msg.innerHTML = '<div class="team-msg team-msg-warn">Network error. Please try again.</div>';
  }
}

function copyReferralLink() {
  const input = document.getElementById('referral-url');
  navigator.clipboard.writeText(input.value);
  alert('Referral link copied to clipboard!');
}

function shareSocial(network) {
  const link = document.getElementById('referral-url').value;
  navigator.clipboard.writeText(link);

  if (network === 'whatsapp') {
    const msg = encodeURIComponent(`Join RK Solutions Smart Book Affiliate Program: ${link}`);
    window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
  } else if (network === 'instagram') {
    alert("Referral Link copied to clipboard! Opening Instagram...");
    window.open('https://www.instagram.com/direct/inbox/', '_blank');
  } else if (network === 'facebook') {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`, '_blank');
  }
}

// --------------------------------------------------------
// CUSTOMERS & PAYMENT CONFIRMATION FLOW
// --------------------------------------------------------
let activeStatusFilter = 'All';

function filterByStatus(status, btn) {
  activeStatusFilter = status;
  document.querySelectorAll('.status-pills .pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  loadCustomerList();
}

async function loadCustomerList() {
  const search = document.getElementById('cust-search').value.trim();
  const dateVal = document.getElementById('cust-date-filter').value;

  let url = `/api/customers?status=${activeStatusFilter}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (dateVal) url += `&date=${dateVal}`;

  const res = await fetch(url);
  const data = await res.json();
  const container = document.getElementById('customer-list-container');
  container.innerHTML = '';

  if (data.customers.length === 0) {
    container.innerHTML = `<div class="text-center text-gray p-3">No customers found.</div>`;
    return;
  }

  data.customers.forEach(c => {
    const card = document.createElement('div');
    card.className = 'customer-item-card';
    card.innerHTML = `
      <div class="cust-details">
        <strong>${c.name}</strong>
        <span>${c.phone} • ${c.city || 'Tamil Nadu'}</span>
        <div><span class="badge-status badge-${c.status}">${c.status}</span> <span class="text-sm text-gray">${c.created_date}</span></div>
      </div>
      <div class="cust-actions">
        <a href="https://wa.me/91${c.phone.replace(/[^0-9]/g, '').slice(-10)}" target="_blank" class="whatsapp-chat-btn" title="Open WhatsApp Chat">
          <i class="fa-brands fa-whatsapp"></i>
        </a>
        <button class="btn btn-outline btn-sm" onclick="openEditCustomerModal(${c.id}, '${escapeQuotes(c.name)}', '${c.status}', '${escapeQuotes(c.comments || '')}')">
          Edit
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

async function openAddCustomerModal() {
  const res = await fetch('/api/customers/next-id');
  const data = await res.json();
  document.getElementById('cust-auto-id').value = data.next_id;
  document.getElementById('cust-name').value = '';
  document.getElementById('cust-phone').value = '';
  document.getElementById('cust-city').value = '';
  document.getElementById('cust-youtube').value = '';
  document.getElementById('cust-kw1').value = '';
  document.getElementById('cust-kw2').value = '';
  document.getElementById('cust-kw3').value = '';
  document.getElementById('cust-comments').value = '';
  openModal('modal-add-customer');
}

function onPlanSelected() {
  const plan = document.getElementById('cust-plan');
  const amount = plan.options[plan.selectedIndex].getAttribute('data-amount');
  document.getElementById('upi-amount-display').innerText = `Amount: ₹${amount}`;
}

function proceedToPaymentGateway() {
  const name = document.getElementById('cust-name').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  const youtubeUrl = document.getElementById('cust-youtube').value.trim();

  if (!name || !phone) {
    alert('Please enter customer name and phone number.');
    return;
  }

  tempCustomerPayload = {
    name,
    phone,
    city: document.getElementById('cust-city').value.trim(),
    plan_name: document.getElementById('cust-plan').value,
    youtube_url: youtubeUrl,
    keyword_1: document.getElementById('cust-kw1').value.trim(),
    keyword_2: document.getElementById('cust-kw2').value.trim(),
    keyword_3: document.getElementById('cust-kw3').value.trim(),
    comments: document.getElementById('cust-comments').value.trim()
  };

  closeModal('modal-add-customer');
  onPlanSelected();
  openModal('modal-payment-upi');
}

function backToAddCustomerModal() {
  closeModal('modal-payment-upi');
  openModal('modal-add-customer');
}

function sendScreenshotWhatsApp() {
  const text = encodeURIComponent(`Hello RK Solutions team, I am sending payment screenshot for customer ${tempCustomerPayload.name} (${tempCustomerPayload.phone}).`);
  window.open(`https://wa.me/919940461351?text=${text}`, '_blank');
}

async function confirmPaymentAndSaveCustomer() {
  const res = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tempCustomerPayload)
  });
  const data = await res.json();
  if (data.success) {
    closeModal('modal-payment-upi');
    document.getElementById('success-cust-id').innerText = data.customer_id;
    document.getElementById('success-cust-name').innerText = tempCustomerPayload.name;
    const amountVal = tempCustomerPayload.plan_name === 'Smart Book' ? '₹300.00' : '₹955.00';
    document.getElementById('success-amount').innerText = amountVal;
    switchTab('payment-success');
  } else {
    alert(data.message);
  }
}

function openEditCustomerModal(id, name, status, comments) {
  document.getElementById('edit-cust-id').value = id;
  document.getElementById('edit-cust-name').value = name;
  document.getElementById('edit-cust-status').value = status;
  document.getElementById('edit-cust-comments').value = comments;
  openModal('modal-edit-customer');
}

async function saveCustomerStatus() {
  const id = document.getElementById('edit-cust-id').value;
  const status = document.getElementById('edit-cust-status').value;
  const comments = document.getElementById('edit-cust-comments').value;

  const res = await fetch(`/api/customers/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, comments })
  });
  const data = await res.json();
  if (data.success) {
    closeModal('modal-edit-customer');
    loadCustomerList();
  } else {
    alert(data.message);
  }
}

function exportData(fmt) {
  window.location.href = `/api/customers/export/${fmt}`;
}

// --------------------------------------------------------
// ADVANCED TRAINING & RESOURCES - SUBPAGES & LANGUAGE FILTERS
// --------------------------------------------------------
let currentTrainingLanguage = 'English';

function onLanguageChanged() {
  currentTrainingLanguage = document.getElementById('training-language-select').value;
}

function returnToTrainingHub() {
  switchTab('training');
  document.getElementById('training-language-select').value = currentTrainingLanguage;
}

async function navigateToTrainingSection(category) {
  currentTrainingLanguage = document.getElementById('training-language-select').value;
  
  if (category === 'video') {
    switchTab('training-videos');
    document.getElementById('badge-lang-videos').innerText = currentTrainingLanguage;
    document.getElementById('videos-page-title').innerText = `Training Videos (${currentTrainingLanguage})`;
    await loadTrainingVideosPage(currentTrainingLanguage);
  }
  else if (category === 'sales_script') {
    switchTab('training-scripts');
    document.getElementById('badge-lang-scripts').innerText = currentTrainingLanguage;
    document.getElementById('scripts-page-title').innerText = `Sales Scripts (${currentTrainingLanguage})`;
    await loadSalesScriptsPage(currentTrainingLanguage);
  }
  else if (category === 'faq') {
    switchTab('training-faq');
    document.getElementById('badge-lang-faq').innerText = currentTrainingLanguage;
    document.getElementById('faq-page-title').innerText = `FAQs (${currentTrainingLanguage})`;
    await loadFaqPage(currentTrainingLanguage);
  }
  else if (category === 'poster') {
    switchTab('training-posters');
    document.getElementById('badge-lang-posters').innerText = currentTrainingLanguage;
    document.getElementById('posters-page-title').innerText = `Marketing Posters (${currentTrainingLanguage})`;
    await loadPostersPage(currentTrainingLanguage);
  }
  else if (category === 'smart_book') {
    switchTab('training-smartbook');
    document.getElementById('badge-lang-smartbook').innerText = currentTrainingLanguage;
    document.getElementById('smartbook-page-title').innerText = `Sample Smart Books (${currentTrainingLanguage})`;
    await loadSmartBooksPage(currentTrainingLanguage);
  }
}

async function loadTrainingVideosPage(lang) {
  const container = document.getElementById('videos-list-container');
  container.innerHTML = '<div class="text-center p-3 text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Loading videos...</div>';

  try {
    const res = await fetch(`/api/training/resources?category=video&language=${encodeURIComponent(lang)}`);
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><i class="fa-solid fa-film"></i><p>No training videos available for ${lang}.</p></div>`;
      return;
    }

    data.items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'script-card-item';
      card.innerHTML = `
        <div style="flex: 1;">
          <span class="script-card-title">${item.title}</span>
          <div class="text-sm text-gray"><i class="fa-regular fa-clock"></i> 30 Mins Tutorial Module</div>
        </div>
        <div class="script-actions-row">
          <a href="${item.content || 'https://www.youtube.com'}" target="_blank" class="btn btn-primary btn-sm">
            <i class="fa-solid fa-play"></i> Watch
          </a>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state-box"><p class="text-danger">Failed to load videos. Please try again.</p></div>`;
  }
}

function normalizeToSingleBullets(rawText) {
  if (!rawText) return '';
  return rawText.split('\n')
    .map(line => {
      let clean = line.trim();
      if (!clean) return '';
      while (clean.startsWith('•') || clean.startsWith('-') || clean.startsWith('*')) {
        clean = clean.substring(1).trim();
      }
      return clean ? `• ${clean}` : '';
    })
    .filter(l => l.length > 0)
    .join('\n');
}

async function loadSalesScriptsPage(lang) {
  const container = document.getElementById('scripts-list-container');
  container.innerHTML = '<div class="text-center p-3 text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Loading scripts...</div>';

  try {
    const res = await fetch(`/api/training/resources?category=sales_script&language=${encodeURIComponent(lang)}`);
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><i class="fa-solid fa-file-circle-xmark"></i><p>No sales scripts available for ${lang}.</p></div>`;
      return;
    }

    data.items.forEach((item) => {
      currentLoadedScriptsMap[item.id] = {
        id: item.id,
        title: item.title,
        content: normalizeToSingleBullets(item.content),
        language: item.language
      };

      const card = document.createElement('div');
      card.className = 'script-card-item';
      card.innerHTML = `
        <div class="script-card-title">
          ${item.title}
        </div>
        <div class="script-actions-row">
          <button class="btn btn-outline btn-sm" onclick="handleScriptView(${item.id})">
            <i class="fa-regular fa-eye"></i> View
          </button>
          <button class="btn btn-primary btn-sm" onclick="handleScriptCopy(${item.id})">
            <i class="fa-regular fa-copy"></i> Copy
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state-box"><p class="text-danger">Failed to load sales scripts. Please try again.</p></div>`;
  }
}

let activeScriptFullText = "";

function handleScriptView(scriptId) {
  const scriptObj = currentLoadedScriptsMap[scriptId];
  if (!scriptObj) {
    alert("Script not found. Please refresh.");
    return;
  }
  activeScriptFullText = `${scriptObj.title}\n\n${scriptObj.content}`;
  document.getElementById('script-full-title').innerText = scriptObj.title;
  document.getElementById('script-full-content').innerText = scriptObj.content;
  openModal('modal-script-fullview');
}

async function handleScriptCopy(scriptId) {
  const scriptObj = currentLoadedScriptsMap[scriptId];
  if (!scriptObj) {
    alert("Script not found. Please refresh.");
    return;
  }
  const fullTextToCopy = `${scriptObj.title}\n\n${scriptObj.content}`;
  await executeClipboardCopy(fullTextToCopy);
}

function copyFullScriptText() {
  executeClipboardCopy(activeScriptFullText);
}

async function executeClipboardCopy(text) {
  if (!text) {
    alert("No content available to copy.");
    return;
  }
  let success = false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch (err) {
      success = false;
    }
  }
  if (!success) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.top = "-9999px";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      success = document.execCommand('copy');
      document.body.removeChild(textArea);
    } catch (err) {
      success = false;
    }
  }

  if (success) {
    alert("Copied successfully!");
  } else {
    alert("Failed to copy to clipboard. Please copy manually.");
  }
}

// --------------------------------------------------------
// FAQ (LANGUAGE-SPECIFIC NATIVE QUESTIONS & ANSWERS)
// --------------------------------------------------------
async function loadFaqPage(lang) {
  const container = document.getElementById('faq-list-container');
  container.innerHTML = '<div class="text-center p-3 text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Loading FAQs...</div>';

  try {
    const res = await fetch(`/api/training/resources?category=faq&language=${encodeURIComponent(lang)}`);
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      const emptyMsgs = {
        'English': 'No FAQs available in English.',
        'Tamil': 'தமிழில் அடிக்கடி கேட்கப்படும் கேள்விகள் எதுவும் கிடைக்கவில்லை.',
        'Telugu': 'తెలుగులో తరచుగా అడిగే ప్రశ్నలు అందుబాటులో లేవు.',
        'Hindi': 'हिंदी में कोई अक्सर पूछे जाने वाले प्रश्न उपलब्ध नहीं हैं।',
        'Kannada': 'ಕನ್ನಡದಲ್ಲಿ ಯಾವುದೇ ಪದೇ ಪದೇ ಕೇಳಲಾಗುವ ಪ್ರಶ್ನೆಗಳು ಲಭ್ಯವಿಲ್ಲ.'
      };
      container.innerHTML = `<div class="empty-state-box"><i class="fa-solid fa-circle-question"></i><p>${emptyMsgs[lang] || 'No FAQs available.'}</p></div>`;
      return;
    }

    data.items.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'faq-accordion-item';
      card.onclick = () => {
        const a = card.querySelector('.faq-a-text');
        const icon = card.querySelector('.faq-q-text i');
        a.classList.toggle('hidden');
        if (icon) {
          icon.classList.toggle('fa-chevron-down');
          icon.classList.toggle('fa-chevron-up');
        }
      };
      card.innerHTML = `
        <div class="faq-q-text">
          <span>Q${idx + 1}: ${item.title}</span>
          <i class="fa-solid fa-chevron-down"></i>
        </div>
        <div class="faq-a-text hidden">${item.content}</div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state-box"><p class="text-danger">Failed to load FAQs. Please try again.</p></div>`;
  }
}

async function loadPostersPage(lang) {
  const container = document.getElementById('posters-grid-container');
  container.innerHTML = '<div class="text-center p-3 text-gray" style="grid-column: span 2;"><i class="fa-solid fa-spinner fa-spin"></i> Loading posters...</div>';

  try {
    const res = await fetch(`/api/training/resources?category=poster&language=${encodeURIComponent(lang)}`);
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state-box" style="grid-column: span 2;"><i class="fa-solid fa-images"></i><p>No posters available for ${lang}.</p></div>`;
      return;
    }

    data.items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'poster-preview-card';
      card.innerHTML = `
        <img src="${item.file_url || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600'}" class="poster-img-element" alt="Poster">
        <div style="padding: 8px;">
          <strong class="text-sm" style="display:block; margin-bottom: 6px;">${item.title}</strong>
          <a href="${item.file_url || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600'}" download="Poster_${lang}_${item.id}.jpg" target="_blank" class="btn btn-outline btn-sm w-100">
            <i class="fa-solid fa-download"></i> Download
          </a>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state-box" style="grid-column: span 2;"><p class="text-danger">Failed to load posters. Please try again.</p></div>`;
  }
}

async function loadSmartBooksPage(lang) {
  const container = document.getElementById('smartbook-list-container');
  container.innerHTML = '<div class="text-center p-3 text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Loading materials...</div>';

  try {
    const res = await fetch(`/api/training/resources?category=smart_book&language=${encodeURIComponent(lang)}`);
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><i class="fa-solid fa-book-bookmark"></i><p>No sample materials available for ${lang}.</p></div>`;
      return;
    }

    data.items.forEach((item) => {
      const isPdf = item.content === 'pdf' || item.title.includes('[PDF]');
      const card = document.createElement('div');
      card.className = 'script-card-item';
      card.innerHTML = `
        <div class="file-name-meta" style="margin-bottom: 8px; flex: 1;">
          <i class="${isPdf ? 'fa-solid fa-file-pdf file-icon-pdf' : 'fa-solid fa-file-excel file-icon-excel'}"></i>
          <div>
            <strong>${item.title}</strong>
            <div class="text-sm text-gray">${item.description || 'Verified syllabus material'}</div>
          </div>
        </div>
        <div class="script-actions-row">
          <button class="btn btn-outline btn-sm" onclick="downloadSampleSmartBookFile(${item.id}, '${isPdf ? 'pdf' : 'xlsx'}')">
            <i class="fa-solid fa-download"></i> Download ${isPdf ? 'PDF' : 'Excel'}
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state-box"><p class="text-danger">Failed to load Smart Books. Please try again.</p></div>`;
  }
}

function downloadSampleSmartBookFile(id, ext) {
  window.open(`/api/reports/download-file/smartbook_${id}_${ext}`, '_blank');
}

// --------------------------------------------------------
// ADMIN MATERIAL MANAGEMENT
// --------------------------------------------------------
function openAdminUploadModal() {
  openModal('modal-admin-upload');
}

async function submitAdminMaterial(e) {
  e.preventDefault();
  const form = document.getElementById('admin-material-form');
  const formData = new FormData();

  formData.append('category', document.getElementById('adm-mat-cat').value);
  formData.append('language', document.getElementById('adm-mat-lang').value);
  formData.append('title', document.getElementById('adm-mat-title').value);
  formData.append('description', document.getElementById('adm-mat-desc').value);
  formData.append('content', document.getElementById('adm-mat-content').value);

  const fileInput = document.getElementById('adm-mat-file');
  if (fileInput.files.length > 0) {
    formData.append('file', fileInput.files[0]);
  }

  const res = await fetch('/api/admin/materials', {
    method: 'POST',
    body: formData
  });
  const data = await res.json();
  if (data.success) {
    alert(data.message);
    closeModal('modal-admin-upload');
    form.reset();
  } else {
    alert(data.message || 'Error uploading material');
  }
}

// --------------------------------------------------------
// MY REPORTS
// --------------------------------------------------------
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function reportFileIconClass(type) {
  switch (type) {
    case 'pdf': return 'fa-solid fa-file-pdf file-icon-pdf';
    case 'excel': return 'fa-solid fa-file-excel file-icon-excel';
    case 'word': return 'fa-solid fa-file-word file-icon-word';
    case 'ppt': return 'fa-solid fa-file-powerpoint file-icon-ppt';
    case 'image': return 'fa-solid fa-file-image file-icon-image';
    case 'zip': return 'fa-solid fa-file-zipper file-icon-zip';
    case 'text': return 'fa-solid fa-file-lines file-icon-other';
    default: return 'fa-solid fa-file file-icon-other';
  }
}

async function loadReports() {
  const dateVal = document.getElementById('reports-date-filter').value;
  let url = '/api/reports';
  if (dateVal) url += `?date=${encodeURIComponent(dateVal)}`;

  const container = document.getElementById('reports-container');
  let data;
  try {
    const res = await fetch(url);
    data = await res.json();
  } catch (err) {
    container.innerHTML = `<div class="text-center text-gray p-3">Unable to load reports. Please try again.</div>`;
    return;
  }
  container.innerHTML = '';

  if (!data.reports || data.reports.length === 0) {
    container.innerHTML = `<div class="text-center text-gray p-3">No reports are available yet.</div>`;
    return;
  }

  data.reports.forEach(grp => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'report-date-group';
    groupDiv.innerHTML = `<div class="report-date-title"><i class="fa-regular fa-calendar"></i> ${escapeHtml(grp.date)} — ${escapeHtml(grp.customer_name)}</div>`;

    grp.files.forEach(f => {
      const fileRow = document.createElement('div');
      fileRow.className = 'report-file-item';
      const folderLine = f.folder ? `<small class="report-folder-path"><i class="fa-regular fa-folder"></i> ${escapeHtml(f.folder)}</small>` : '';
      fileRow.innerHTML = `
        <div class="file-name-meta">
          <i class="${reportFileIconClass(f.type)}"></i>
          <span class="report-file-label">${escapeHtml(f.name)}${folderLine}</span>
        </div>
        <div class="file-action-buttons">
          ${(f.type === 'pdf' || f.type === 'image') ? `<button class="btn btn-secondary btn-sm" title="View" onclick="viewReportFile(${Number(f.id)})"><i class="fa-regular fa-eye"></i></button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="downloadReportFile(${Number(f.id)})"><i class="fa-solid fa-download"></i> Download</button>
          <button class="btn btn-secondary btn-sm" onclick="shareReportFile(${Number(f.id)})"><i class="fa-solid fa-share"></i> Share</button>
        </div>
      `;
      groupDiv.appendChild(fileRow);
    });

    container.appendChild(groupDiv);
  });
}

function downloadReportFile(fileId) {
  window.open(`/api/reports/download-file/${fileId}`, '_blank');
}

function viewReportFile(fileId) {
  window.open(`/api/reports/download-file/${fileId}?inline=1`, '_blank');
}

async function shareReportFile(fileId) {
  try {
    const res = await fetch(`/api/reports/share/${fileId}`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || 'Unable to create a share link.');
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: data.name,
          text: `${data.name} (link valid for ${data.expires_in_days} days)`,
          url: data.url
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    await executeClipboardCopy(data.url);
  } catch (err) {
    alert('Unable to share this file right now.');
  }
}

// --------------------------------------------------------
// PASSWORD RESET (VIA EMAIL OTP)
// --------------------------------------------------------
function openChangePasswordModal() { openModal('modal-change-password'); }

async function requestPasswordResetOTP() {
  const email = currentUser.email;
  const res = await fetch('/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, purpose: 'RESET_PASSWORD' })
  });
  const data = await res.json();
  if (data.success) {
    document.getElementById('pwd-otp-group').classList.remove('hidden');
    alert(data.message);
  } else {
    alert(data.message);
  }
}

async function submitPasswordReset() {
  const otp = document.getElementById('reset-otp-input').value.trim();
  const newPwd = document.getElementById('reset-new-pwd').value.trim();

  const res = await fetch('/api/auth/reset-password-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: currentUser.email, otp: otp, new_password: newPwd })
  });
  const data = await res.json();
  if (data.success) {
    alert(data.message);
    closeModal('modal-change-password');
  } else {
    alert(data.message);
  }
}

// --------------------------------------------------------
// ADMIN PANEL
// --------------------------------------------------------
async function loadAdminPanel() {
  const res = await fetch('/api/admin/requests');
  const data = await res.json();
  if (!data.success) return;

  document.getElementById('admin-pending-count').innerText = `Pending: ${data.summary.pending}`;
  document.getElementById('admin-processed-count').innerText = `Processed: ${data.summary.processed}`;

  const tbody = document.getElementById('admin-requests-tbody');
  tbody.innerHTML = '';

  data.requests.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.request_date}</td>
      <td>${r.name}</td>
      <td>${r.code}</td>
      <td><a href="${r.youtube_url || '#'}" target="_blank">View Channel</a></td>
      <td>${r.keyword_1 || '-'}</td>
      <td>${r.keyword_2 || '-'}</td>
      <td>${r.keyword_3 || '-'}</td>
      <td>
        <button class="btn btn-sm ${r.uploaded_all_files ? 'btn-primary' : 'btn-secondary'}" onclick="toggleAdminOrder(${r.order_id})">
          ${r.uploaded_all_files ? 'Yes (Completed)' : 'No (Pending)'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function toggleAdminOrder(orderId) {
  const res = await fetch(`/api/admin/requests/${orderId}/toggle-status`, { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    loadAdminPanel();
  }
}

// --------------------------------------------------------
// ADMIN DASHBOARD: TEAM MEMBERS + PER-MEMBER FILE / FOLDER UPLOADS
// --------------------------------------------------------
let adminTeamRows = [];
let activeTeamTarget = null;
let teamPendingFiles = [];
let teamUploadBusy = false;

const TEAM_ALLOWED_EXT = ['pdf','xls','xlsx','xlsm','csv','ods','doc','docx','rtf','odt','txt','ppt','pptx','png','jpg','jpeg','gif','webp','zip','rar','7z','json','xml'];
const TEAM_MAX_FILE_BYTES = 50 * 1024 * 1024;
const TEAM_BATCH_MAX_FILES = 10;
const TEAM_BATCH_MAX_BYTES = 80 * 1024 * 1024;

function openAdminTeamPage() {
  if (!currentUser || currentUser.role !== 'admin') return;
  switchTab('admin-team');
}

function formatDateDMY(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (isoDate || '-');
}

async function loadAdminTeam() {
  const tbody = document.getElementById('team-members-tbody');
  try {
    const res = await fetch('/api/admin/team-members');
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="8" class="team-empty">${escapeHtml(data.message || 'Unable to load team members.')}</td></tr>`;
      return;
    }
    adminTeamRows = data.members;
    document.getElementById('team-total-count').innerText = `Total: ${data.summary.total}`;
    document.getElementById('team-uploaded-count').innerText = `Uploaded: ${data.summary.uploaded}`;
    document.getElementById('team-pending-count').innerText = `Pending: ${data.summary.pending}`;

    if (adminTeamRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="team-empty">No team members have registered yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    adminTeamRows.forEach((m, idx) => {
      const tr = document.createElement('tr');
      const safeUrl = /^https?:\/\//i.test(m.youtube_url || '') ? m.youtube_url : '';
      const ytCell = safeUrl
        ? `<a class="team-yt-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>`
        : '<span class="team-dash">-</span>';
      const kw = v => v ? escapeHtml(v) : '<span class="team-dash">-</span>';
      const reqLine = m.request_id ? `<small class="team-req-id">Req ${escapeHtml(m.request_id)}</small>` : '';
      tr.innerHTML = `
        <td class="td-date">${escapeHtml(formatDateDMY(m.request_date))}</td>
        <td class="td-name">${escapeHtml(m.name)}</td>
        <td class="td-member"><strong>${escapeHtml(m.member_id)}</strong>${reqLine}</td>
        <td class="td-youtube">${ytCell}</td>
        <td>${kw(m.keyword_1)}</td>
        <td>${kw(m.keyword_2)}</td>
        <td>${kw(m.keyword_3)}</td>
        <td class="td-upload">
          <button class="team-upload-btn" title="Upload files / folders for ${escapeHtml(m.name)}" onclick="openTeamUploadModal(${idx})">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18H6.5a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.4 8 4.5 4.5 0 0 1 17.5 18H17"/><path d="M12 20v-9"/><path d="M8.5 14.5 12 11l3.5 3.5"/></svg>
          </button>
          <span class="team-status-pill ${m.uploaded ? 'pill-yes' : 'pill-no'}" title="${m.file_count} file(s) uploaded">${m.uploaded ? 'Yes' : 'No'}</span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="team-empty">Unable to load team members. Please try again.</td></tr>`;
  }
}

function openTeamUploadModal(idx) {
  const m = adminTeamRows[idx];
  if (!m) return;
  activeTeamTarget = m;
  teamPendingFiles = [];
  renderTeamPendingFiles();
  document.getElementById('team-upload-result').innerHTML = '';
  document.getElementById('team-progress-box').classList.add('hidden');
  document.getElementById('team-upload-target').innerHTML = `
    <strong>${escapeHtml(m.name)}</strong>
    <span>Member ID: ${escapeHtml(m.member_id)}${m.request_id ? ' &middot; Request ' + escapeHtml(m.request_id) : ''}</span>`;
  openModal('modal-team-upload');
  loadTeamExistingFiles();
}

function closeTeamUploadModal() {
  if (teamUploadBusy) {
    alert('Upload in progress. Please wait until it finishes.');
    return;
  }
  closeModal('modal-team-upload');
  activeTeamTarget = null;
}

async function loadTeamExistingFiles() {
  const box = document.getElementById('team-existing-files');
  if (!activeTeamTarget) return;
  box.innerHTML = '<span class="text-sm text-gray">Loading...</span>';
  try {
    let url = `/api/admin/team-members/${activeTeamTarget.user_id}/files`;
    if (activeTeamTarget.request_id) url += `?customer_id=${encodeURIComponent(activeTeamTarget.request_id)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success || data.files.length === 0) {
      box.innerHTML = '<span class="text-sm text-gray">No files uploaded yet.</span>';
      return;
    }
    box.innerHTML = '';
    data.files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'team-existing-row';
      row.innerHTML = `
        <i class="${reportFileIconClass(f.type)}"></i>
        <span class="team-existing-name">${escapeHtml(f.path || f.name)}</span>
        <small>${escapeHtml(formatDateDMY(f.upload_date))} &middot; ${formatFileSize(f.size)}</small>
        <button type="button" class="team-existing-dl" title="Download" onclick="downloadReportFile(${Number(f.id)})"><i class="fa-solid fa-download"></i></button>`;
      box.appendChild(row);
    });
  } catch (err) {
    box.innerHTML = '<span class="text-sm text-gray">Unable to load file list.</span>';
  }
}

function onTeamFilesPicked(input) {
  const picked = Array.from(input.files || []);
  const skipped = [];
  picked.forEach(file => {
    const path = file.webkitRelativePath && file.webkitRelativePath.length ? file.webkitRelativePath : file.name;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (file.name.indexOf('.') === -1 || !TEAM_ALLOWED_EXT.includes(ext)) {
      skipped.push(`${path} (type not allowed)`);
      return;
    }
    if (file.size === 0) { skipped.push(`${path} (empty file)`); return; }
    if (file.size > TEAM_MAX_FILE_BYTES) { skipped.push(`${path} (over 50 MB)`); return; }
    if (!teamPendingFiles.some(p => p.path === path && p.file.size === file.size)) {
      teamPendingFiles.push({ file, path });
    }
  });
  input.value = '';
  renderTeamPendingFiles();
  const resultBox = document.getElementById('team-upload-result');
  if (skipped.length) {
    resultBox.innerHTML = `<div class="team-msg team-msg-warn"><strong>${skipped.length} item(s) skipped:</strong><br>${skipped.slice(0, 8).map(escapeHtml).join('<br>')}${skipped.length > 8 ? '<br>...' : ''}</div>`;
  } else {
    resultBox.innerHTML = '';
  }
}

function renderTeamPendingFiles() {
  const box = document.getElementById('team-pending-box');
  const list = document.getElementById('team-pending-list');
  if (teamPendingFiles.length === 0) {
    box.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  const total = teamPendingFiles.reduce((sum, p) => sum + p.file.size, 0);
  document.getElementById('team-pending-summary').innerText = `${teamPendingFiles.length} file(s) selected · ${formatFileSize(total)}`;
  list.innerHTML = teamPendingFiles.slice(0, 50).map(p => `<li>${escapeHtml(p.path)} <small>${formatFileSize(p.file.size)}</small></li>`).join('')
    + (teamPendingFiles.length > 50 ? `<li>... and ${teamPendingFiles.length - 50} more</li>` : '');
  box.classList.remove('hidden');
}

function clearTeamPendingFiles() {
  if (teamUploadBusy) return;
  teamPendingFiles = [];
  renderTeamPendingFiles();
  document.getElementById('team-upload-result').innerHTML = '';
}

async function startTeamUpload() {
  if (teamUploadBusy || !activeTeamTarget) return;
  if (teamPendingFiles.length === 0) {
    alert('Please select files or a folder first.');
    return;
  }

  const batches = [];
  let current = [];
  let currentBytes = 0;
  teamPendingFiles.forEach(item => {
    if (current.length >= TEAM_BATCH_MAX_FILES || (current.length > 0 && currentBytes + item.file.size > TEAM_BATCH_MAX_BYTES)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += item.file.size;
  });
  if (current.length) batches.push(current);

  teamUploadBusy = true;
  const uploadBtn = document.getElementById('team-upload-btn');
  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
  const progressBox = document.getElementById('team-progress-box');
  const progressBar = document.getElementById('team-progress-bar');
  const progressText = document.getElementById('team-progress-text');
  progressBox.classList.remove('hidden');
  progressBar.style.width = '0%';

  let savedCount = 0;
  const rejected = [];
  const failedBatchFiles = [];
  let doneFiles = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    progressText.innerText = `Uploading batch ${i + 1} of ${batches.length}...`;
    const fd = new FormData();
    if (activeTeamTarget.request_id) fd.append('customer_id', activeTeamTarget.request_id);
    batch.forEach(item => {
      fd.append('files', item.file, item.file.name);
      fd.append('paths', item.path);
    });
    try {
      const res = await fetch(`/api/admin/team-members/${activeTeamTarget.user_id}/upload`, { method: 'POST', body: fd });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (data && Array.isArray(data.saved)) {
        savedCount += data.saved.length;
        (data.rejected || []).forEach(r => rejected.push(r));
      } else {
        const reason = (data && data.message) || `Server error (${res.status})`;
        batch.forEach(item => rejected.push({ name: item.path, reason }));
        failedBatchFiles.push(...batch);
      }
    } catch (err) {
      batch.forEach(item => rejected.push({ name: item.path, reason: 'Network error during upload.' }));
      failedBatchFiles.push(...batch);
    }
    doneFiles += batch.length;
    progressBar.style.width = `${Math.round((doneFiles / teamPendingFiles.length) * 100)}%`;
  }

  teamUploadBusy = false;
  uploadBtn.disabled = false;
  uploadBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload to Member';
  progressText.innerText = 'Upload finished.';

  const resultBox = document.getElementById('team-upload-result');
  let html = '';
  if (savedCount > 0) {
    html += `<div class="team-msg team-msg-ok"><i class="fa-solid fa-circle-check"></i> ${savedCount} file(s) uploaded for ${escapeHtml(activeTeamTarget.name)}. They now appear in this member's Reports tab.</div>`;
  }
  if (rejected.length > 0) {
    html += `<div class="team-msg team-msg-warn"><strong>${rejected.length} file(s) not uploaded:</strong><br>${rejected.slice(0, 10).map(r => `${escapeHtml(r.name)} — ${escapeHtml(r.reason)}`).join('<br>')}${rejected.length > 10 ? '<br>...' : ''}</div>`;
  }
  resultBox.innerHTML = html;

  teamPendingFiles = failedBatchFiles.length ? failedBatchFiles : [];
  renderTeamPendingFiles();
  loadTeamExistingFiles();
  loadAdminTeam();
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }