const ADMIN_DESIGNATED_EMAIL = 'varsha.thirumal21@gmail.com';

let currentUser = null;
let currentBanners = [];
let bannerTimer = null;
let currentBannerIdx = 0;
let tempCustomerPayload = null;
const screenHistory = [];
let resendTimerInterval = null;
let customerSubmitBusy = false;
let materialSubmitBusy = false;
let walletActionBusy = false;

const currentLoadedScriptsMap = {};
const adminMaterialsMap = {};
let adminWalletsList = [];

const MATERIAL_CATEGORY_META = {
  video: {
    label: 'Training Video',
    accept: '.mp4,.webm,.mov,.m4v,.avi,.mkv,video/*',
    hint: 'Supported formats: MP4, WEBM, MOV, M4V, AVI, MKV (up to 200 MB) or provide a video URL above.',
    contentLabel: 'Video URL (optional if uploading a video file)',
    contentPlaceholder: 'https://www.youtube.com/watch?v=...',
    showContent: true,
    fileLabel: 'Upload Video File'
  },
  sales_script: {
    label: 'Sales Script',
    accept: '.txt,.pdf,.doc,.docx,.rtf,.odt',
    hint: 'Supported formats: TXT, PDF, DOC, DOCX, RTF, ODT (up to 50 MB) and/or script text above.',
    contentLabel: 'Sales Script Content',
    contentPlaceholder: 'Enter script lines...',
    showContent: true,
    fileLabel: 'Attach Script Document (optional if entering text)'
  },
  poster: {
    label: 'Poster',
    accept: '.png,.jpg,.jpeg,.gif,.webp,image/*',
    hint: 'Supported formats: PNG, JPG, JPEG, GIF, WEBP (up to 10 MB).',
    contentLabel: '',
    contentPlaceholder: '',
    showContent: false,
    fileLabel: 'Upload Poster Image *'
  },
  smart_book: {
    label: 'Sample Smart Book',
    accept: '.pdf,.xls,.xlsx,.xlsm,.csv,.ods,.doc,.docx,.ppt,.pptx,.zip,.txt',
    hint: 'Supported formats: PDF, XLS, XLSX, CSV, DOC, DOCX, PPT, PPTX, ZIP, TXT (up to 50 MB).',
    contentLabel: '',
    contentPlaceholder: '',
    showContent: false,
    fileLabel: 'Upload Sample Smart Book File *'
  }
};

function isDesignatedAdmin() {
  return Boolean(
    currentUser &&
    currentUser.role === 'admin' &&
    String(currentUser.email || '').trim().toLowerCase() === ADMIN_DESIGNATED_EMAIL
  );
}

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
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
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
  closeSidebar();
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  cleanInputsOnLoad();
}

function updateSidebarWallet(balance) {
  const walletEl = document.getElementById('sidebar-wallet-balance');
  if (walletEl) {
    const num = Number(balance || 0);
    walletEl.innerText = `₹${num.toLocaleString()}`;
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  const opening = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', opening);
  if (backdrop) backdrop.classList.toggle('hidden', !opening);
}

function closeSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.add('hidden');
}

function sidebarNavigate(tabId) {
  closeSidebar();
  switchTab(tabId);
}

function renderAppShell() {
  document.getElementById('screen-login').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  const memberId = currentUser.member_id || '';
  const userName = currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Partner');
  const adminFlag = isDesignatedAdmin();

  // Partner ID displayed only on Dashboard directly under "Hi, Partner!"
  document.getElementById('user-subtext').innerText = memberId;
  document.getElementById('referral-url').value = `https://rksolutions.app/ref/${memberId}`;

  document.getElementById('prof-name').innerText = userName;
  document.getElementById('prof-email').innerText = currentUser.email || '---';
  document.getElementById('prof-city').innerText = currentUser.city || 'Coimbatore';

  updateSidebarWallet(currentUser.wallet_balance);

  const adminBtn = document.getElementById('header-admin-btn');
  if (adminBtn) adminBtn.classList.toggle('hidden', !adminFlag);

  const sidebarAdminBtn = document.getElementById('sidebar-admin-btn');
  if (sidebarAdminBtn) sidebarAdminBtn.classList.toggle('hidden', !adminFlag);

  const sidebarMatBtn = document.getElementById('sidebar-admin-materials-btn');
  if (sidebarMatBtn) sidebarMatBtn.classList.toggle('hidden', !adminFlag);

  const sidebarWalletsBtn = document.getElementById('sidebar-admin-wallets-btn');
  if (sidebarWalletsBtn) sidebarWalletsBtn.classList.toggle('hidden', !adminFlag);

  const adsAdminBox = document.getElementById('ads-admin-actions');
  if (adsAdminBox) adsAdminBox.classList.toggle('hidden', !adminFlag);

  startBannerPolling();

  if (adminFlag) {
    switchTab('admin-team', false);
  } else {
    switchTab('dashboard', false);
  }
}

function switchTab(tabId, addToHistory = true) {
  if ((tabId === 'admin' || tabId === 'admin-team' || tabId === 'admin-materials' || tabId === 'admin-wallets') && !isDesignatedAdmin()) {
    tabId = 'dashboard';
  }

  const currentActive = document.querySelector('.sub-screen.active');
  const currentActiveId = currentActive ? currentActive.id.replace('screen-', '') : null;

  if (addToHistory && currentActiveId && currentActiveId !== tabId) {
    screenHistory.push(currentActiveId);
  }

  document.querySelectorAll('.sub-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));

  const targetScreen = document.getElementById(`screen-${tabId}`);
  if (targetScreen) targetScreen.classList.add('active');

  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    const dt = btn.getAttribute('data-tab');
    if (dt === tabId || (tabId.startsWith('training') && dt === 'training')) {
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
    'wallet': 'Wallet & History',
    'profile': 'My Profile',
    'payment-success': 'Payment Confirmation',
    'admin': 'Admin Portal',
    'admin-team': 'Admin Team Members',
    'admin-materials': 'Manage Training Materials',
    'admin-wallets': 'Employee Wallets'
  };
  document.getElementById('header-title').innerText = titles[tabId] || 'RK Solutions';

  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'customers') loadCustomerList();
  if (tabId === 'training') updateTrainingHubCounts();
  if (tabId === 'reports') loadReports();
  if (tabId === 'wallet') loadWalletPage();
  if (tabId === 'admin') loadAdminPanel();
  document.body.classList.toggle('admin-team-wide', tabId === 'admin-team');
  if (tabId === 'admin-team') loadAdminTeam();
  if (tabId === 'admin-materials') loadAdminMaterials();
  if (tabId === 'admin-wallets') loadAdminWallets();
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
    document.getElementById('user-subtext').innerText = currentUser.member_id;
  }

  const dateVal = document.getElementById('dash-date-filter').value;
  let url = '/api/dashboard';
  if (dateVal) url += `?date=${encodeURIComponent(dateVal)}`;

  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();
  if (data.success) {
    document.getElementById('metric-membership').innerText = data.metrics.membership_count;
    document.getElementById('metric-smartbook').innerText = data.metrics.smartbook_count;
    document.getElementById('metric-earnings').innerText = `₹${Number(data.metrics.paid_earnings || 0).toLocaleString()}`;
    document.getElementById('metric-total-customers').innerText = data.metrics.total_customers || 0;

    updateDashboardStatusCounts(data.metrics.status_counts);
    updateSidebarWallet(data.metrics.wallet_balance);

    if (currentUser) {
      currentUser.wallet_balance = data.metrics.wallet_balance;
    }

    currentBanners = data.banners;
    startBannerRotation();
  }
}

function updateDashboardStatusCounts(counts) {
  if (!counts) return;
  ['All', 'New', 'Called', 'Interested', 'Joined'].forEach(label => {
    const el = document.getElementById('dash-pill-' + label);
    if (el) el.textContent = `${label} (${counts[label] || 0})`;
  });
}

function goToCustomersWithStatus(status) {
  activeStatusFilter = status;
  document.querySelectorAll('#screen-customers .status-pills .pill').forEach(p => {
    p.classList.toggle('active', p.id === `pill-${status}`);
  });
  switchTab('customers');
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

let bannerPollTimer = null;

function bannerSignature(list) {
  return JSON.stringify((list || []).map(b => [b.slot, b.title, b.subtitle, b.image_url, b.action_url]));
}

async function refreshBannersNow(force = false) {
  try {
    const res = await fetch('/api/banners', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && (force || bannerSignature(data.banners) !== bannerSignature(currentBanners))) {
      currentBanners = data.banners;
      startBannerRotation();
    }
  } catch (err) { /* ignore transient network error */ }
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
  if (!isDesignatedAdmin()) return;
  openModal('modal-manage-ads');
  loadAdsManager();
}

async function loadAdsManager() {
  const box = document.getElementById('ads-slots-container');
  box.innerHTML = '<div class="text-center p-3 text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Loading advertisements...</div>';
  try {
    const res = await fetch('/api/admin/banners', { cache: 'no-store' });
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

function toggleDateFilter() {
  const df = document.getElementById('cust-date-filter');
  if (df) df.focus();
}

function filterByStatus(status, btn) {
  activeStatusFilter = status;
  document.querySelectorAll('#screen-customers .status-pills .pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  loadCustomerList();
}

async function loadCustomerList() {
  const search = document.getElementById('cust-search').value.trim();
  const dateVal = document.getElementById('cust-date-filter').value;

  let url = `/api/customers?status=${encodeURIComponent(activeStatusFilter)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (dateVal) url += `&date=${encodeURIComponent(dateVal)}`;

  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();
  updateStatusCounts(data.status_counts);
  const container = document.getElementById('customer-list-container');
  container.innerHTML = '';

  if (!data.customers || data.customers.length === 0) {
    container.innerHTML = `<div class="text-center text-gray p-3">No customers found.</div>`;
    return;
  }

  data.customers.forEach(c => {
    const card = document.createElement('div');
    card.className = 'customer-item-card';
    card.innerHTML = `
      <div class="cust-details">
        <strong>${escapeHtml(c.name)}</strong>
        <span>${escapeHtml(c.phone)} • ${escapeHtml(c.city || 'Tamil Nadu')}</span>
        <div><span class="badge-status badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span> <span class="text-sm text-gray">${escapeHtml(c.created_date)}</span></div>
      </div>
      <div class="cust-actions">
        <a href="https://wa.me/91${String(c.phone || '').replace(/[^0-9]/g, '').slice(-10)}" target="_blank" class="whatsapp-chat-btn" title="Open WhatsApp Chat">
          <i class="fa-brands fa-whatsapp"></i>
        </a>
        <button class="btn btn-outline btn-sm" onclick="openEditCustomerModal(${c.id}, '${escapeQuotes(c.name)}', '${escapeQuotes(c.status)}', '${escapeQuotes(c.comments || '')}')">
          Edit
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateStatusCounts(counts) {
  if (!counts) return;
  ['All', 'New', 'Called', 'Interested', 'Joined'].forEach(label => {
    const el = document.getElementById('pill-' + label);
    if (el) el.textContent = `${label} (${counts[label] || 0})`;
  });
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

async function openAddCustomerModal() {
  const res = await fetch('/api/customers/next-id', { cache: 'no-store' });
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
  if (customerSubmitBusy || !tempCustomerPayload) return;
  customerSubmitBusy = true;
  const confirmBtn = document.getElementById('btn-confirm-save-customer');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerText = 'Saving...';
  }

  try {
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

      if (data.wallet_balance !== undefined) {
        updateSidebarWallet(data.wallet_balance);
        if (currentUser) currentUser.wallet_balance = data.wallet_balance;
      }

      tempCustomerPayload = null;
      switchTab('payment-success');
    } else {
      alert(data.message);
    }
  } catch (err) {
    alert('Failed to save customer. Please try again.');
  } finally {
    customerSubmitBusy = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerText = 'Confirm & Submit';
    }
  }
}

function onEditCustomerStatusChange() {
  const status = document.getElementById('edit-cust-status')?.value;
  const addNewBtn = document.getElementById('edit-cust-add-new-btn');
  if (addNewBtn) {
    addNewBtn.classList.toggle('hidden', status !== 'Joined');
  }
}

function addNewCustomerFromEdit() {
  closeModal('modal-edit-customer');
  openAddCustomerModal();
}

function openEditCustomerModal(id, name, status, comments) {
  document.getElementById('edit-cust-id').value = id;
  document.getElementById('edit-cust-name').value = name;
  document.getElementById('edit-cust-status').value = status;
  document.getElementById('edit-cust-comments').value = comments;
  onEditCustomerStatusChange();
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
    if (data.wallet_balance !== undefined) {
      updateSidebarWallet(data.wallet_balance);
      if (currentUser) currentUser.wallet_balance = data.wallet_balance;
    }
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
// USER WALLET & TRANSACTION HISTORY
// --------------------------------------------------------
function formatWalletTxType(txType) {
  switch (txType) {
    case 'smart_book_sale': return 'Smart Book / PDF Sale';
    case 'membership_sale': return 'Membership Sale';
    case 'manual_credit': return 'Admin Wallet Credit';
    case 'payout': return 'Manual Payment (Payout)';
    default: return txType || 'Transaction';
  }
}

function formatWalletTxHtml(tx) {
  const isPayout = tx.tx_type === 'payout';
  const sign = isPayout ? '-' : '+';
  const amtCls = isPayout ? 'wallet-tx-amount-debit' : 'wallet-tx-amount-credit';
  const statusCls = `badge-${escapeHtml(tx.payment_status || 'Credited')}`;
  const methodInfo = tx.payment_method ? `<span><i class="fa-solid fa-building-columns"></i> ${escapeHtml(tx.payment_method)}</span>` : '';
  const refInfo = tx.payment_ref ? `<span>Ref: ${escapeHtml(tx.payment_ref)}</span>` : '';
  return `
    <div class="wallet-tx-card">
      <div class="wallet-tx-top">
        <div>
          <strong>${escapeHtml(formatWalletTxType(tx.tx_type))}</strong>
          <div class="text-sm text-gray">${escapeHtml(tx.description || '')}</div>
        </div>
        <span class="${amtCls}">${sign}₹${Number(tx.amount || 0).toLocaleString()}</span>
      </div>
      <div class="wallet-tx-meta">
        <span><i class="fa-regular fa-calendar"></i> ${escapeHtml(tx.created_at)}</span>
        ${methodInfo}
        ${refInfo}
        <span class="badge-status ${statusCls}">${escapeHtml(tx.payment_status || 'Credited')}</span>
      </div>
    </div>
  `;
}

async function loadWalletPage() {
  const listEl = document.getElementById('wallet-transactions-list');
  listEl.innerHTML = '<div class="text-center text-gray p-3"><i class="fa-solid fa-spinner fa-spin"></i> Loading wallet history...</div>';
  try {
    const res = await fetch('/api/wallet', { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) {
      listEl.innerHTML = `<div class="text-center text-gray p-3">${escapeHtml(data.message || 'Unable to load wallet.')}</div>`;
      return;
    }
    document.getElementById('wallet-page-balance').innerText = `₹${Number(data.wallet_balance || 0).toLocaleString()}`;
    document.getElementById('wallet-page-paid').innerText = `₹${Number(data.paid_earnings || 0).toLocaleString()}`;
    updateSidebarWallet(data.wallet_balance);
    if (currentUser) currentUser.wallet_balance = data.wallet_balance;

    if (!data.transactions || data.transactions.length === 0) {
      listEl.innerHTML = '<div class="empty-state-box"><i class="fa-solid fa-wallet"></i><p>No wallet transactions yet.</p></div>';
      return;
    }
    listEl.innerHTML = data.transactions.map(formatWalletTxHtml).join('');
  } catch (err) {
    listEl.innerHTML = '<div class="text-center text-gray p-3">Unable to load wallet history.</div>';
  }
}

// --------------------------------------------------------
// ADMIN EMPLOYEE WALLETS, MANUAL CREDIT & MANUAL PAYOUTS
// --------------------------------------------------------
function openAdminWalletsPage() {
  if (!isDesignatedAdmin()) return;
  switchTab('admin-wallets');
}

function showAdminWalletsBanner(msg, ok = true) {
  const el = document.getElementById('admin-wallets-banner');
  if (!el) return;
  el.innerHTML = `<div class="team-msg ${ok ? 'team-msg-ok' : 'team-msg-warn'}">${escapeHtml(msg)}</div>`;
}

async function loadAdminWallets() {
  if (!isDesignatedAdmin()) return;
  const listEl = document.getElementById('admin-wallets-list');
  listEl.innerHTML = '<div class="text-center text-gray p-3"><i class="fa-solid fa-spinner fa-spin"></i> Loading employee wallets...</div>';
  try {
    const res = await fetch('/api/admin/wallets', { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) {
      listEl.innerHTML = `<div class="team-msg team-msg-warn">${escapeHtml(data.message || 'Access denied.')}</div>`;
      return;
    }
    adminWalletsList = data.employees || [];
    if (!adminWalletsList.length) {
      listEl.innerHTML = '<div class="empty-state-box"><i class="fa-solid fa-users"></i><p>No employees found yet.</p></div>';
      return;
    }
    listEl.innerHTML = '';
    adminWalletsList.forEach(emp => {
      const card = document.createElement('div');
      card.className = 'wallet-emp-card';
      card.innerHTML = `
        <div class="wallet-emp-head">
          <div>
            <strong>${escapeHtml(emp.name)} (${escapeHtml(emp.member_id)})</strong>
            <span class="text-sm text-gray">${escapeHtml(emp.email)}</span>
          </div>
          <span class="admin-mat-badge">${emp.tx_count} txns</span>
        </div>
        <div class="wallet-emp-stats">
          <span>Wallet Balance: <strong>₹${Number(emp.wallet_balance || 0).toLocaleString()}</strong></span>
          <span>Total Paid: <strong>₹${Number(emp.paid_earnings || 0).toLocaleString()}</strong></span>
        </div>
        <div class="wallet-emp-actions">
          <button type="button" class="btn btn-outline btn-sm" onclick="openAdminWalletHistoryModal(${Number(emp.id)})">
            <i class="fa-solid fa-clock-rotate-left"></i> View History
          </button>
          <button type="button" class="btn btn-primary btn-sm" onclick="openAdminCreditModal(${Number(emp.id)})">
            <i class="fa-solid fa-plus"></i> Add Credit
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="openAdminPayoutModal(${Number(emp.id)})">
            <i class="fa-solid fa-money-bill-transfer"></i> Record Payment
          </button>
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    listEl.innerHTML = '<div class="team-msg team-msg-warn">Unable to load employee wallets.</div>';
  }
}

function openAdminCreditModal(userId) {
  const emp = adminWalletsList.find(e => e.id === userId);
  if (!emp) return;
  document.getElementById('adm-credit-user-id').value = emp.id;
  document.getElementById('adm-credit-target').innerHTML = `<strong>${escapeHtml(emp.name)} (${escapeHtml(emp.member_id)})</strong><span>Current Wallet Balance: ₹${Number(emp.wallet_balance || 0).toLocaleString()}</span>`;
  document.getElementById('adm-credit-amount').value = '';
  document.getElementById('adm-credit-desc').value = '';
  document.getElementById('adm-credit-error').innerHTML = '';
  openModal('modal-admin-wallet-credit');
}

async function submitAdminWalletCredit() {
  if (walletActionBusy || !isDesignatedAdmin()) return;
  const userId = document.getElementById('adm-credit-user-id').value;
  const amount = document.getElementById('adm-credit-amount').value;
  const description = document.getElementById('adm-credit-desc').value.trim();
  const errEl = document.getElementById('adm-credit-error');
  errEl.innerHTML = '';

  walletActionBusy = true;
  try {
    const res = await fetch(`/api/admin/wallets/${userId}/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, description })
    });
    const data = await res.json();
    if (data.success) {
      closeModal('modal-admin-wallet-credit');
      showAdminWalletsBanner(data.message, true);
      await loadAdminWallets();
    } else {
      errEl.innerHTML = `<div class="team-msg team-msg-warn">${escapeHtml(data.message || 'Unable to add credit.')}</div>`;
    }
  } catch (err) {
    errEl.innerHTML = '<div class="team-msg team-msg-warn">Network error. Please try again.</div>';
  } finally {
    walletActionBusy = false;
  }
}

function openAdminPayoutModal(userId) {
  const emp = adminWalletsList.find(e => e.id === userId);
  if (!emp) return;
  document.getElementById('adm-payout-user-id').value = emp.id;
  document.getElementById('adm-payout-target').innerHTML = `<strong>${escapeHtml(emp.name)} (${escapeHtml(emp.member_id)})</strong><span>Available Wallet Balance: ₹${Number(emp.wallet_balance || 0).toLocaleString()}</span>`;
  document.getElementById('adm-payout-amount').value = '';
  document.getElementById('adm-payout-method').value = 'UPI';
  document.getElementById('adm-payout-status').value = 'Paid';
  document.getElementById('adm-payout-ref').value = '';
  document.getElementById('adm-payout-desc').value = '';
  document.getElementById('adm-payout-error').innerHTML = '';
  openModal('modal-admin-wallet-payout');
}

async function submitAdminWalletPayout() {
  if (walletActionBusy || !isDesignatedAdmin()) return;
  const userId = document.getElementById('adm-payout-user-id').value;
  const payload = {
    amount: document.getElementById('adm-payout-amount').value,
    payment_method: document.getElementById('adm-payout-method').value,
    payment_status: document.getElementById('adm-payout-status').value,
    payment_ref: document.getElementById('adm-payout-ref').value.trim(),
    description: document.getElementById('adm-payout-desc').value.trim()
  };
  const errEl = document.getElementById('adm-payout-error');
  errEl.innerHTML = '';

  walletActionBusy = true;
  try {
    const res = await fetch(`/api/admin/wallets/${userId}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeModal('modal-admin-wallet-payout');
      showAdminWalletsBanner(data.message, true);
      await loadAdminWallets();
    } else {
      errEl.innerHTML = `<div class="team-msg team-msg-warn">${escapeHtml(data.message || 'Unable to record payment.')}</div>`;
    }
  } catch (err) {
    errEl.innerHTML = '<div class="team-msg team-msg-warn">Network error. Please try again.</div>';
  } finally {
    walletActionBusy = false;
  }
}

async function openAdminWalletHistoryModal(userId) {
  if (!isDesignatedAdmin()) return;
  const listEl = document.getElementById('adm-history-list');
  const targetEl = document.getElementById('adm-history-target');
  targetEl.innerHTML = '<strong>Loading...</strong>';
  listEl.innerHTML = '';
  openModal('modal-admin-wallet-history');

  try {
    const res = await fetch(`/api/admin/wallets/${userId}/transactions`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) {
      targetEl.innerHTML = `<strong>Error</strong><span>${escapeHtml(data.message || 'Unable to load history.')}</span>`;
      return;
    }
    const emp = data.employee;
    targetEl.innerHTML = `<strong>${escapeHtml(emp.name)} (${escapeHtml(emp.member_id)})</strong><span>Wallet Balance: ₹${Number(emp.wallet_balance || 0).toLocaleString()} &middot; Total Paid: ₹${Number(emp.paid_earnings || 0).toLocaleString()}</span>`;
    if (!data.transactions || !data.transactions.length) {
      listEl.innerHTML = '<div class="text-sm text-gray p-3">No wallet transactions recorded yet.</div>';
      return;
    }
    listEl.innerHTML = data.transactions.map(tx => {
      const markBtn = (tx.tx_type === 'payout' && tx.payment_status === 'Pending')
        ? `<div class="mt-2"><button type="button" class="btn btn-primary btn-sm" onclick="markAdminPayoutPaid(${Number(tx.id)}, ${Number(emp.id)})">Mark Paid</button></div>`
        : '';
      return `<div>${formatWalletTxHtml(tx)}${markBtn}</div>`;
    }).join('');
  } catch (err) {
    targetEl.innerHTML = '<strong>Error</strong><span>Unable to load history.</span>';
  }
}

async function markAdminPayoutPaid(txId, userId) {
  const ref = prompt('Enter UPI / Bank Transfer reference ID (UTR):');
  if (ref === null) return;
  try {
    const res = await fetch(`/api/admin/wallets/transactions/${txId}/mark-paid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_ref: ref.trim() })
    });
    const data = await res.json();
    if (data.success) {
      await openAdminWalletHistoryModal(userId);
      await loadAdminWallets();
    } else {
      alert(data.message || 'Unable to mark payout as Paid.');
    }
  } catch (err) {
    alert('Network error. Please try again.');
  }
}

// --------------------------------------------------------
// USER-SIDE TRAINING & RESOURCES (DYNAMICALLY INTEGRATED WITH ADMIN CRUD)
// --------------------------------------------------------
let currentTrainingLanguage = 'all';

function onLanguageChanged() {
  currentTrainingLanguage = document.getElementById('training-language-select').value;
  updateTrainingHubCounts();
}

async function updateTrainingHubCounts() {
  const lang = document.getElementById('training-language-select')?.value || currentTrainingLanguage;
  try {
    const res = await fetch(`/api/training/resources?language=${encodeURIComponent(lang)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success || !data.counts) return;

    const vCount = data.counts.video || 0;
    const sCount = data.counts.sales_script || 0;
    const pCount = data.counts.poster || 0;
    const bCount = data.counts.smart_book || 0;

    const elV = document.getElementById('hub-desc-video');
    const elS = document.getElementById('hub-desc-sales_script');
    const elP = document.getElementById('hub-desc-poster');
    const elB = document.getElementById('hub-desc-smart_book');

    if (elV) elV.innerText = `${vCount} published tutorial video${vCount === 1 ? '' : 's'}`;
    if (elS) elS.innerText = `${sCount} published sales script${sCount === 1 ? '' : 's'}`;
    if (elP) elP.innerText = `${pCount} published marketing poster${pCount === 1 ? '' : 's'}`;
    if (elB) elB.innerText = `${bCount} published sample handbook${bCount === 1 ? '' : 's'}`;
  } catch (err) { /* ignore */ }
}

function returnToTrainingHub() {
  switchTab('training');
  document.getElementById('training-language-select').value = currentTrainingLanguage;
}

function formatLangBadge(lang) {
  return lang === 'all' ? 'All Languages' : lang;
}

async function navigateToTrainingSection(category) {
  currentTrainingLanguage = document.getElementById('training-language-select').value;
  const langLabel = formatLangBadge(currentTrainingLanguage);

  if (category === 'video') {
    switchTab('training-videos');
    document.getElementById('badge-lang-videos').innerText = langLabel;
    document.getElementById('videos-page-title').innerText = `Training Videos (${langLabel})`;
    await loadTrainingVideosPage(currentTrainingLanguage);
  }
  else if (category === 'sales_script') {
    switchTab('training-scripts');
    document.getElementById('badge-lang-scripts').innerText = langLabel;
    document.getElementById('scripts-page-title').innerText = `Sales Scripts (${langLabel})`;
    await loadSalesScriptsPage(currentTrainingLanguage);
  }
  else if (category === 'faq') {
    switchTab('training-faq');
    const faqLang = currentTrainingLanguage === 'all' ? 'English' : currentTrainingLanguage;
    document.getElementById('badge-lang-faq').innerText = faqLang;
    document.getElementById('faq-page-title').innerText = `FAQs (${faqLang})`;
    await loadFaqPage(faqLang);
  }
  else if (category === 'poster') {
    switchTab('training-posters');
    document.getElementById('badge-lang-posters').innerText = langLabel;
    document.getElementById('posters-page-title').innerText = `Marketing Posters (${langLabel})`;
    await loadPostersPage(currentTrainingLanguage);
  }
  else if (category === 'smart_book') {
    switchTab('training-smartbook');
    document.getElementById('badge-lang-smartbook').innerText = langLabel;
    document.getElementById('smartbook-page-title').innerText = `Sample Smart Books (${langLabel})`;
    await loadSmartBooksPage(currentTrainingLanguage);
  }
}

async function loadTrainingVideosPage(lang) {
  const container = document.getElementById('videos-list-container');
  container.innerHTML = '<div class="text-center p-3 text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Loading videos...</div>';

  try {
    const res = await fetch(`/api/training/resources?category=video&language=${encodeURIComponent(lang)}`, { cache: 'no-store' });
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><i class="fa-solid fa-film"></i><p>No published training videos available for ${escapeHtml(formatLangBadge(lang))}.</p></div>`;
      return;
    }

    data.items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'script-card-item video-card-item';
      const safeLink = /^https?:\/\//i.test(item.content || '') ? item.content : '';
      const videoPlayerHtml = item.has_file
        ? `<video class="training-video-player" controls preload="metadata" playsinline src="${escapeHtml(item.view_url)}"></video>`
        : '';
      const descLine = item.description ? `<div class="text-sm text-gray">${escapeHtml(item.description)}</div>` : '';
      const langBadge = `<span class="admin-mat-badge">${escapeHtml(item.language)}</span>`;
      const linkBtn = safeLink
        ? `<a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm"><i class="fa-solid fa-play"></i> Watch</a>`
        : (item.has_file ? `<a href="${escapeHtml(item.view_url)}" target="_blank" class="btn btn-primary btn-sm"><i class="fa-solid fa-play"></i> Open Video</a>` : '');
      const dlBtn = item.has_file
        ? `<a href="${escapeHtml(item.download_url)}" class="btn btn-outline btn-sm"><i class="fa-solid fa-download"></i> Download</a>`
        : '';

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <div style="flex:1;">
            <span class="script-card-title">${escapeHtml(item.title)}</span>
            ${descLine}
            <div class="admin-mat-badges">${langBadge}</div>
          </div>
          <div class="script-actions-row">
            ${linkBtn}
            ${dlBtn}
          </div>
        </div>
        ${videoPlayerHtml}
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
    const res = await fetch(`/api/training/resources?category=sales_script&language=${encodeURIComponent(lang)}`, { cache: 'no-store' });
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><i class="fa-solid fa-file-circle-xmark"></i><p>No published sales scripts available for ${escapeHtml(formatLangBadge(lang))}.</p></div>`;
      return;
    }

    data.items.forEach((item) => {
      const normalizedContent = normalizeToSingleBullets(item.content);
      currentLoadedScriptsMap[item.id] = {
        id: item.id,
        title: item.title,
        content: normalizedContent,
        language: item.language
      };

      const hasText = Boolean(normalizedContent);
      const viewBtn = hasText
        ? `<button class="btn btn-outline btn-sm" onclick="handleScriptView(${Number(item.id)})"><i class="fa-regular fa-eye"></i> View</button>`
        : (item.has_file && item.file_ext === 'pdf'
          ? `<a href="${escapeHtml(item.view_url)}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-regular fa-eye"></i> View</a>`
          : '');
      const copyBtn = hasText
        ? `<button class="btn btn-primary btn-sm" onclick="handleScriptCopy(${Number(item.id)})"><i class="fa-regular fa-copy"></i> Copy</button>`
        : '';
      const dlBtn = item.has_file
        ? `<a href="${escapeHtml(item.download_url)}" class="btn btn-outline btn-sm"><i class="fa-solid fa-download"></i> Download</a>`
        : '';

      const card = document.createElement('div');
      card.className = 'script-card-item';
      card.innerHTML = `
        <div style="flex:1;">
          <div class="script-card-title">${escapeHtml(item.title)}</div>
          ${item.description ? `<div class="text-sm text-gray">${escapeHtml(item.description)}</div>` : ''}
          <div class="admin-mat-badges"><span class="admin-mat-badge">${escapeHtml(item.language)}</span></div>
        </div>
        <div class="script-actions-row">
          ${viewBtn}
          ${copyBtn}
          ${dlBtn}
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

async function loadFaqPage(lang) {
  const container = document.getElementById('faq-list-container');
  container.innerHTML = '<div class="text-center p-3 text-gray"><i class="fa-solid fa-spinner fa-spin"></i> Loading FAQs...</div>';

  try {
    const res = await fetch(`/api/training/resources?category=faq&language=${encodeURIComponent(lang)}`, { cache: 'no-store' });
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
          <span>Q${idx + 1}: ${escapeHtml(item.title)}</span>
          <i class="fa-solid fa-chevron-down"></i>
        </div>
        <div class="faq-a-text hidden">${escapeHtml(item.content)}</div>
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
    const res = await fetch(`/api/training/resources?category=poster&language=${encodeURIComponent(lang)}`, { cache: 'no-store' });
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state-box" style="grid-column: span 2;"><i class="fa-solid fa-images"></i><p>No published posters available for ${escapeHtml(formatLangBadge(lang))}.</p></div>`;
      return;
    }

    data.items.forEach((item) => {
      const imgSrc = item.has_file ? item.view_url : item.file_url;
      const dlHref = item.has_file ? item.download_url : item.file_url;
      const card = document.createElement('div');
      card.className = 'poster-preview-card';
      card.innerHTML = `
        <img src="${escapeHtml(imgSrc)}" class="poster-img-element" alt="${escapeHtml(item.title)}">
        <div style="padding: 8px;">
          <strong class="text-sm" style="display:block; margin-bottom: 4px;">${escapeHtml(item.title)}</strong>
          ${item.description ? `<div class="text-sm text-gray" style="margin-bottom:6px;">${escapeHtml(item.description)}</div>` : ''}
          <a href="${escapeHtml(dlHref)}" class="btn btn-outline btn-sm w-100">
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
    const res = await fetch(`/api/training/resources?category=smart_book&language=${encodeURIComponent(lang)}`, { cache: 'no-store' });
    const data = await res.json();
    container.innerHTML = '';

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="empty-state-box"><i class="fa-solid fa-book-bookmark"></i><p>No published sample materials available for ${escapeHtml(formatLangBadge(lang))}.</p></div>`;
      return;
    }

    data.items.forEach((item) => {
      const iconCls = reportFileIconClass(item.file_type);
      const canInline = item.has_file && (item.file_type === 'pdf' || item.file_type === 'image');
      const viewBtn = canInline
        ? `<a href="${escapeHtml(item.view_url)}" target="_blank" class="btn btn-secondary btn-sm"><i class="fa-regular fa-eye"></i> View</a>`
        : '';
      const dlBtn = item.has_file
        ? `<a href="${escapeHtml(item.download_url)}" class="btn btn-outline btn-sm"><i class="fa-solid fa-download"></i> Download${item.file_ext ? ' ' + escapeHtml(item.file_ext.toUpperCase()) : ''}</a>`
        : '';

      const card = document.createElement('div');
      card.className = 'script-card-item';
      card.innerHTML = `
        <div class="file-name-meta" style="flex: 1;">
          <i class="${iconCls}"></i>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <div class="text-sm text-gray">${escapeHtml(item.description || item.original_filename || 'Sample Smart Book material')}</div>
            <div class="admin-mat-badges"><span class="admin-mat-badge">${escapeHtml(item.language)}</span></div>
          </div>
        </div>
        <div class="script-actions-row">
          ${viewBtn}
          ${dlBtn}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state-box"><p class="text-danger">Failed to load Smart Books. Please try again.</p></div>`;
  }
}

// --------------------------------------------------------
// ADMIN TRAINING MATERIAL MANAGEMENT (4 SECTIONS + FULL CRUD)
// --------------------------------------------------------
function openAdminMaterialsPage() {
  if (!isDesignatedAdmin()) return;
  switchTab('admin-materials');
}

function openAdminUploadModal() {
  openAdminMaterialModal('video');
}

function showAdminMaterialStatusBanner(msg, ok = true) {
  const banner = document.getElementById('admin-mat-status-banner');
  if (!banner) return;
  banner.innerHTML = `<div class="team-msg ${ok ? 'team-msg-ok' : 'team-msg-warn'}"><i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> ${escapeHtml(msg)}</div>`;
}

function populateCategoryDropdownSingle(category) {
  const catSelect = document.getElementById('adm-mat-cat');
  const meta = MATERIAL_CATEGORY_META[category] || MATERIAL_CATEGORY_META.video;
  if (!catSelect) return;
  catSelect.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = category;
  opt.textContent = meta.label;
  catSelect.appendChild(opt);
  catSelect.value = category;
}

function onAdminMaterialCategoryChange() {
  const cat = document.getElementById('adm-mat-cat').value;
  const meta = MATERIAL_CATEGORY_META[cat] || MATERIAL_CATEGORY_META.video;
  const contentGroup = document.getElementById('adm-mat-content-group');
  const contentLabel = document.getElementById('adm-mat-content-label');
  const contentInput = document.getElementById('adm-mat-content');
  const fileLabel = document.getElementById('adm-mat-file-label');
  const fileInput = document.getElementById('adm-mat-file');
  const fileHint = document.getElementById('adm-mat-file-hint');

  if (contentGroup) contentGroup.classList.toggle('hidden', !meta.showContent);
  if (contentLabel) contentLabel.innerText = meta.contentLabel;
  if (contentInput) contentInput.placeholder = meta.contentPlaceholder;
  if (fileLabel) fileLabel.innerText = meta.fileLabel;
  if (fileInput) fileInput.setAttribute('accept', meta.accept);
  if (fileHint) fileHint.innerText = meta.hint;
}

function openAdminMaterialModal(category = 'video') {
  if (!isDesignatedAdmin()) return;
  document.getElementById('admin-material-form').reset();
  document.getElementById('adm-mat-id').value = '';
  populateCategoryDropdownSingle(category);
  document.getElementById('adm-mat-lang').value = 'English';
  document.getElementById('adm-mat-active').checked = true;
  document.getElementById('adm-mat-modal-title').innerText = `Add ${MATERIAL_CATEGORY_META[category]?.label || 'Training Material'}`;
  document.getElementById('adm-mat-submit-btn').innerText = 'Save Material';
  document.getElementById('adm-mat-error').innerHTML = '';
  const curFileEl = document.getElementById('adm-mat-current-file');
  curFileEl.innerText = '';
  curFileEl.classList.add('hidden');

  onAdminMaterialCategoryChange();
  openModal('modal-admin-upload');
}

function openEditMaterialModal(materialId) {
  if (!isDesignatedAdmin()) return;
  const item = adminMaterialsMap[materialId];
  if (!item) {
    alert('Material not found. Please refresh.');
    return;
  }
  document.getElementById('admin-material-form').reset();
  document.getElementById('adm-mat-id').value = item.id;
  populateCategoryDropdownSingle(item.category);
  document.getElementById('adm-mat-lang').value = item.language;
  document.getElementById('adm-mat-title').value = item.title || '';
  document.getElementById('adm-mat-desc').value = item.description || '';
  document.getElementById('adm-mat-content').value = item.content || '';
  document.getElementById('adm-mat-active').checked = item.is_active === 1;
  document.getElementById('adm-mat-modal-title').innerText = `Edit ${MATERIAL_CATEGORY_META[item.category]?.label || 'Material'}`;
  document.getElementById('adm-mat-submit-btn').innerText = 'Update Material';
  document.getElementById('adm-mat-error').innerHTML = '';

  const curFileEl = document.getElementById('adm-mat-current-file');
  if (item.has_file) {
    curFileEl.innerText = `Current file: ${item.original_filename || 'Attached file'} (${formatFileSize(item.size_bytes)}). Select a new file only to replace it.`;
    curFileEl.classList.remove('hidden');
  } else {
    curFileEl.innerText = '';
    curFileEl.classList.add('hidden');
  }

  onAdminMaterialCategoryChange();
  openModal('modal-admin-upload');
}

async function loadAdminMaterials() {
  if (!isDesignatedAdmin()) return;
  const langFilter = document.getElementById('admin-mat-lang-filter')?.value || 'all';
  const categories = ['video', 'sales_script', 'poster', 'smart_book'];
  categories.forEach(cat => {
    const box = document.getElementById(`admin-mat-list-${cat}`);
    if (box) box.innerHTML = '<div class="text-sm text-gray">Loading...</div>';
  });

  try {
    let url = '/api/admin/materials';
    if (langFilter && langFilter !== 'all') url += `?language=${encodeURIComponent(langFilter)}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();

    if (!data.success) {
      categories.forEach(cat => {
        const box = document.getElementById(`admin-mat-list-${cat}`);
        if (box) box.innerHTML = `<div class="team-msg team-msg-warn">${escapeHtml(data.message || 'Access denied.')}</div>`;
      });
      return;
    }

    Object.keys(adminMaterialsMap).forEach(k => delete adminMaterialsMap[k]);
    const grouped = { video: [], sales_script: [], poster: [], smart_book: [] };
    (data.items || []).forEach(item => {
      adminMaterialsMap[item.id] = item;
      if (grouped[item.category]) grouped[item.category].push(item);
    });

    categories.forEach(cat => {
      const box = document.getElementById(`admin-mat-list-${cat}`);
      if (!box) return;
      const list = grouped[cat];
      if (!list.length) {
        box.innerHTML = '<div class="text-sm text-gray">No materials uploaded in this section yet.</div>';
        return;
      }

      box.innerHTML = '';
      list.forEach(item => {
        const card = document.createElement('div');
        card.className = 'admin-mat-card';
        const isPub = item.is_active === 1;
        const fileInfo = item.has_file
          ? `<span class="admin-mat-badge">${escapeHtml(item.original_filename)} (${formatFileSize(item.size_bytes)})</span>`
          : (item.category === 'video' && item.content ? `<span class="admin-mat-badge">Video Link</span>` : '');
        const viewHref = item.has_file ? item.view_url : (item.category === 'video' && item.content ? item.content : '');
        const previewBtn = viewHref
          ? `<a href="${escapeHtml(viewHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm"><i class="fa-regular fa-eye"></i> Preview</a>`
          : '';

        card.innerHTML = `
          <div class="admin-mat-card-info">
            <strong>${escapeHtml(item.title)}</strong>
            ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
            <div class="admin-mat-badges">
              <span class="admin-mat-badge">${escapeHtml(item.language)}</span>
              <span class="admin-mat-badge ${isPub ? 'admin-mat-badge-pub' : 'admin-mat-badge-unpub'}">${isPub ? 'Published' : 'Unpublished'}</span>
              ${fileInfo}
            </div>
          </div>
          <div class="admin-mat-actions">
            ${previewBtn}
            <button type="button" class="btn btn-outline btn-sm" onclick="toggleMaterialPublish(${Number(item.id)})">
              ${isPub ? 'Unpublish' : 'Publish'}
            </button>
            <button type="button" class="btn btn-primary btn-sm" onclick="openEditMaterialModal(${Number(item.id)})">
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button type="button" class="btn btn-danger btn-sm" onclick="deleteAdminMaterial(${Number(item.id)})">
              <i class="fa-solid fa-trash"></i> Delete
            </button>
          </div>
        `;
        box.appendChild(card);
      });
    });
  } catch (err) {
    categories.forEach(cat => {
      const box = document.getElementById(`admin-mat-list-${cat}`);
      if (box) box.innerHTML = '<div class="team-msg team-msg-warn">Failed to load materials. Please try again.</div>';
    });
  }
}

async function submitAdminMaterial(e) {
  e.preventDefault();
  if (materialSubmitBusy || !isDesignatedAdmin()) return;

  const editId = document.getElementById('adm-mat-id').value.trim();
  const cat = document.getElementById('adm-mat-cat').value;
  const lang = document.getElementById('adm-mat-lang').value;
  const title = document.getElementById('adm-mat-title').value.trim();
  const desc = document.getElementById('adm-mat-desc').value.trim();
  const content = document.getElementById('adm-mat-content').value.trim();
  const isActive = document.getElementById('adm-mat-active').checked ? '1' : '0';
  const fileInput = document.getElementById('adm-mat-file');
  const errBox = document.getElementById('adm-mat-error');
  const submitBtn = document.getElementById('adm-mat-submit-btn');

  errBox.innerHTML = '';

  const formData = new FormData();
  formData.append('category', cat);
  formData.append('language', lang);
  formData.append('title', title);
  formData.append('description', desc);
  formData.append('content', content);
  formData.append('is_active', isActive);
  if (fileInput.files.length > 0) {
    formData.append('file', fileInput.files[0]);
  }

  materialSubmitBusy = true;
  const prevBtnText = submitBtn.innerText;
  submitBtn.disabled = true;
  submitBtn.innerText = 'Saving...';

  try {
    const endpoint = editId ? `/api/admin/materials/${editId}` : '/api/admin/materials';
    const method = editId ? 'PUT' : 'POST';
    const res = await fetch(endpoint, { method, body: formData });
    let data = null;
    try { data = await res.json(); } catch (err2) { data = null; }

    if (data && data.success) {
      closeModal('modal-admin-upload');
      document.getElementById('admin-material-form').reset();
      showAdminMaterialStatusBanner(data.message || 'Training material saved successfully.', true);
      await loadAdminMaterials();
      updateTrainingHubCounts();
    } else {
      errBox.innerHTML = `<div class="team-msg team-msg-warn">${escapeHtml((data && data.message) || `Error saving material (${res.status}).`)}</div>`;
    }
  } catch (err) {
    errBox.innerHTML = '<div class="team-msg team-msg-warn">Network error while saving material. Please try again.</div>';
  } finally {
    materialSubmitBusy = false;
    submitBtn.disabled = false;
    submitBtn.innerText = prevBtnText;
  }
}

async function toggleMaterialPublish(materialId) {
  if (!isDesignatedAdmin()) return;
  try {
    const res = await fetch(`/api/admin/materials/${materialId}/toggle-publish`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showAdminMaterialStatusBanner(data.message || 'Publish status updated.', true);
      await loadAdminMaterials();
      updateTrainingHubCounts();
    } else {
      showAdminMaterialStatusBanner(data.message || 'Unable to change publish status.', false);
    }
  } catch (err) {
    showAdminMaterialStatusBanner('Network error while updating publish status.', false);
  }
}

async function deleteAdminMaterial(materialId) {
  if (!isDesignatedAdmin()) return;
  const item = adminMaterialsMap[materialId];
  const label = item ? `"${item.title}"` : 'this training material';
  if (!confirm(`Delete ${label}? It will be permanently removed from both Admin and User views.`)) return;

  try {
    const res = await fetch(`/api/admin/materials/${materialId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showAdminMaterialStatusBanner(data.message || 'Material deleted.', true);
      await loadAdminMaterials();
      updateTrainingHubCounts();
    } else {
      showAdminMaterialStatusBanner(data.message || 'Unable to delete material.', false);
    }
  } catch (err) {
    showAdminMaterialStatusBanner('Network error while deleting material.', false);
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
    case 'video': return 'fa-solid fa-file-video file-icon-other';
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
    const res = await fetch(url, { cache: 'no-store' });
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
  if (!isDesignatedAdmin()) return;
  const res = await fetch('/api/admin/requests', { cache: 'no-store' });
  const data = await res.json();
  if (!data.success) return;

  document.getElementById('admin-pending-count').innerText = `Pending: ${data.summary.pending}`;
  document.getElementById('admin-processed-count').innerText = `Processed: ${data.summary.processed}`;

  const tbody = document.getElementById('admin-requests-tbody');
  tbody.innerHTML = '';

  data.requests.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.request_date)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.code)}</td>
      <td><a href="${escapeHtml(r.youtube_url || '#')}" target="_blank">View Channel</a></td>
      <td>${escapeHtml(r.keyword_1 || '-')}</td>
      <td>${escapeHtml(r.keyword_2 || '-')}</td>
      <td>${escapeHtml(r.keyword_3 || '-')}</td>
      <td>
        <button class="btn btn-sm ${r.uploaded_all_files ? 'btn-primary' : 'btn-secondary'}" onclick="toggleAdminOrder(${Number(r.order_id)})">
          ${r.uploaded_all_files ? 'Yes (Completed)' : 'No (Pending)'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function toggleAdminOrder(orderId) {
  if (!isDesignatedAdmin()) return;
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
  if (!isDesignatedAdmin()) return;
  switchTab('admin-team');
}

function formatDateDMY(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (isoDate || '-');
}

async function loadAdminTeam() {
  if (!isDesignatedAdmin()) return;
  const tbody = document.getElementById('team-members-tbody');
  try {
    const res = await fetch('/api/admin/team-members', { cache: 'no-store' });
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
  if (!isDesignatedAdmin()) return;
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
    const res = await fetch(url, { cache: 'no-store' });
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
  if (teamUploadBusy || !activeTeamTarget || !isDesignatedAdmin()) return;
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
