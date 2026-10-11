// =====================
// PM2 Manager Frontend
// =====================

const API = '/api';
let token = localStorage.getItem('pm2_token');
let currentUser = JSON.parse(localStorage.getItem('pm2_user') || 'null');
let ws = null;
let wsReconnectTimer = null;
let currentPage = 'dashboard';
let processesData = [];
let systemData = {};
// activeLogProcessId and logLines declared at top

// ========================
// INIT
// ========================
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    verifyAndEnter();
  } else {
    showLogin();
  }
  setupLoginForm();
  setupNavigation();
  setupTopbarTime();
  setupMobileMenu();
  setupSidebarToggle();
  setupProcessButtons();
  setupDeployForm();
  setupChangePassForm();
  setupLogControls();
  setupModal();
  setupRuntimeSelector();
  setupTerminal();
  setupFileManager();
  setupSqliteManager();
});

// ========================
// AUTH
// ========================
function setupLoginForm() {
  const form = document.getElementById('loginForm');
  const toggleBtn = document.getElementById('togglePass');
  const passInput = document.getElementById('loginPassword');

  toggleBtn.addEventListener('click', () => {
    if (passInput.type === 'password') {
      passInput.type = 'text';
      toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    } else {
      passInput.type = 'password';
      toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const loginBtn = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');
    errEl.style.display = 'none';
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login gagal!');

      token = data.token;
      currentUser = data.user;
      localStorage.setItem('pm2_token', token);
      localStorage.setItem('pm2_user', JSON.stringify(currentUser));
      enterApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    }
  });
}

async function verifyAndEnter() {
  try {
    const res = await fetch(`${API}/auth/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.valid) {
      currentUser = data.user;
      enterApp();
    } else {
      logout();
    }
  } catch {
    logout();
  }
}

function enterApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  document.getElementById('userLabel').textContent = currentUser?.username || 'admin';
  connectWS();
  navigateTo('dashboard');
}

function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function logout() {
  localStorage.removeItem('pm2_token');
  localStorage.removeItem('pm2_user');
  token = null;
  currentUser = null;
  if (ws) ws.close();
  showLogin();
}

document.getElementById('logoutBtn').addEventListener('click', logout);

// ========================
// WEBSOCKET
// ========================
function connectWS() {
  if (ws) ws.close();
  clearTimeout(wsReconnectTimer);

  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}?token=${token}`;
  ws = new WebSocket(wsUrl);
  setWsStatus('connecting');

  ws.addEventListener('open', () => {
    setWsStatus('connected');
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      handleWsMessage(msg);
    } catch {}
  });

  ws.addEventListener('close', () => {
    setWsStatus('error');
    wsReconnectTimer = setTimeout(connectWS, 4000);
  });

  ws.addEventListener('error', () => {
    setWsStatus('error');
  });
}

function setWsStatus(state) {
  const dot = document.getElementById('wsStatus').querySelector('.ws-dot');
  const label = document.getElementById('wsStatus').querySelector('.ws-label');
  dot.className = 'ws-dot';
  if (state === 'connected') {
    dot.classList.add('connected');
    label.textContent = 'Connected';
  } else if (state === 'connecting') {
    dot.classList.add('connecting');
    label.textContent = 'Connecting...';
  } else {
    dot.classList.add('error');
    label.textContent = 'Disconnected';
  }
}

function handleWsMessage(msg) {
  if (msg.type === 'stats_update') {
    processesData = msg.processes || [];
    systemData = msg.system || {};
    updateDashboard();
    updateProcessTable();
    updateLogSelect();
  }
  if (msg.type === 'process_event') {
    fetchProcessList();
  }
  if (msg.type === 'log_out' || msg.type === 'log_err') {
    if (String(msg.pm_id) === String(activeLogProcessId) || msg.processName === activeLogProcessId) {
      appendLog(msg.data, msg.type === 'log_err' ? 'err' : 'out');
    }
  }
  // PTY output
  if (msg.type === 'pty_output' || msg.type === 'pty_exit') {
    handlePtyOutput(msg);
  }
}

// ========================
// NAVIGATION
// ========================
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (page) navigateTo(page);
      // Close mobile sidebar
      document.getElementById('sidebar').classList.remove('mobile-open');
    });
  });
}

function navigateTo(page) {
  currentPage = page;
  const titles = { dashboard: 'Dashboard', processes: 'Processes', files: 'File Manager', sqlite: 'SQLite Manager', logs: 'Logs', deploy: 'Deploy', terminal: 'Terminal', settings: 'Settings' };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  if (page === 'logs') {
    updateLogSelect();
    if (!activeLogProcessId && processesData.length > 0) {
      loadLogsFor(processesData[0].id);
    }
  }
  if (page === 'files') {
    loadFileManager(fmCurrentDir);
  }
  if (page === 'sqlite') {
    if (!sqliteCurrentDb) scanSqliteDatabases();
  }
  if (page === 'terminal') {
    // Auto-connect xterm saat halaman dibuka
    setTimeout(() => initXterm(), 100);
  }
}

// ========================
// SIDEBAR + MOBILE
// ========================
function setupSidebarToggle() {
  const sidebar = document.getElementById('sidebar');

  // Tombol ☰ = toggle collapse/expand di desktop
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.toggle('collapsed');
    }
  });

  // Klik logo ⚡ saat collapsed = expand lagi
  document.querySelector('.sidebar-logo').addEventListener('click', () => {
    if (window.innerWidth > 768 && sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
    }
  });
}

function setupMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  function openMobileSidebar() {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Hamburger button — toggle open/close
  document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    if (sidebar.classList.contains('mobile-open')) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  });

  // Klik overlay gelap = tutup
  overlay.addEventListener('click', closeMobileSidebar);

  // Klik nav item di mobile = tutup sidebar
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeMobileSidebar();
    });
  });

  // Resize dari mobile ke desktop = reset state mobile
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeMobileSidebar();
    }
  });
}

// ========================
// CLOCK
// ========================
function setupTopbarTime() {
  const el = document.getElementById('topbarTime');
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  tick();
  setInterval(tick, 1000);
}

// ========================
// FETCH PROCESS LIST (fallback)
// ========================
async function fetchProcessList() {
  try {
    const res = await authFetch(`${API}/pm2/list`);
    const data = await res.json();
    if (data.success) {
      processesData = data.processes;
      updateDashboard();
      updateProcessTable();
      updateLogSelect();
    }
  } catch {}
}

// ========================
// DASHBOARD
// ========================
function updateDashboard() {
  const sys = systemData;
  if (!sys || !sys.cpu && sys.cpu !== 0) return;

  // Stats
  setEl('sysCpu', (sys.cpu || 0) + '%');
  setEl('sysMem', (sys.memory?.percent || 0) + '%');
  setBar('sysCpuBar', sys.cpu || 0);
  setBar('sysMemBar', sys.memory?.percent || 0);
  setEl('sysMemDetail', `${sys.memory?.usedFormatted || '-'} / ${sys.memory?.totalFormatted || '-'}`);

  const online = processesData.filter(p => p.status === 'online').length;
  const stopped = processesData.filter(p => p.status !== 'online').length;
  setEl('countOnline', online);
  setEl('countStopped', stopped);
  document.getElementById('processCount').textContent = processesData.length;

  // System info
  setEl('siHostname', sys.hostname || '-');
  setEl('siPlatform', sys.platform || '-');
  setEl('siCpuModel', (sys.cpuModel || '-').substring(0, 40));
  setEl('siCpuCount', sys.cpuCount || '-');
  setEl('siTotalMem', sys.memory?.totalFormatted || '-');
  setEl('siUptime', formatUptime(sys.uptime * 1000));

  // Dashboard process table
  renderProcessTable('dashProcessList', processesData, true);
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(100, pct) + '%';
}

// ========================
// PROCESS TABLE
// ========================
function updateProcessTable() {
  renderProcessTable('fullProcessList', processesData, false);
}

function renderProcessTable(containerId, processes, compact) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!processes.length) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-ghost"></i><p>Belum ada proses</p></div>`;
    return;
  }

  const rows = processes.map(p => `
    <tr>
      <td><span class="proc-id">${p.id}</span></td>
      <td><span class="proc-name">${escHtml(p.name || '-')}</span></td>
      <td>${statusBadge(p.status)}</td>
      <td>${formatBytes(p.memory || 0)}</td>
      <td>${(p.cpu || 0).toFixed(1)}%</td>
      <td>${p.restarts || 0}</td>
      ${!compact ? `<td>${p.pid || '-'}</td><td>${formatUptime(Date.now() - (p.uptime || Date.now()))}</td>` : ''}
      <td>
        <div class="action-btns">
          ${p.status !== 'online' ? `<button class="action-btn start" title="Start" onclick="procAction('start','${p.id}')"><i class="fas fa-play"></i></button>` : ''}
          ${p.status === 'online' ? `<button class="action-btn stop" title="Stop" onclick="procAction('stop','${p.id}')"><i class="fas fa-stop"></i></button>` : ''}
          <button class="action-btn restart" title="Restart" onclick="procAction('restart','${p.id}')"><i class="fas fa-redo"></i></button>
          <button class="action-btn reload" title="Reload" onclick="procAction('reload','${p.id}')"><i class="fas fa-sync"></i></button>
          <button class="action-btn logs" title="Logs" onclick="openLogs('${p.id}')"><i class="fas fa-terminal"></i></button>
          <button class="action-btn" title="Info" onclick="openInfo('${p.id}')"><i class="fas fa-info-circle"></i></button>
          <button class="action-btn delete" title="Delete" onclick="procDelete('${p.id}','${escHtml(p.name)}')"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');

  const headers = compact
    ? `<th>ID</th><th>Name</th><th>Status</th><th>Memory</th><th>CPU</th><th>Restarts</th><th>Actions</th>`
    : `<th>ID</th><th>Name</th><th>Status</th><th>Memory</th><th>CPU</th><th>Restarts</th><th>PID</th><th>Uptime</th><th>Actions</th>`;

  container.innerHTML = `
    <table class="proc-table">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function statusBadge(status) {
  const map = {
    online: 'status-online',
    stopped: 'status-stopped',
    stopping: 'status-stopping',
    errored: 'status-errored',
    launching: 'status-launching',
  };
  const cls = map[status] || 'status-unknown';
  const icon = status === 'online' ? 'fa-circle-check' : status === 'errored' ? 'fa-triangle-exclamation' : 'fa-circle';
  return `<span class="status-badge ${cls}"><i class="fas ${icon}"></i>${status || 'unknown'}</span>`;
}

// ========================
// PROCESS ACTIONS
// ========================
async function procAction(action, id) {
  try {
    const res = await authFetch(`${API}/pm2/${action}/${id}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      toast(data.message || 'Sukses!', 'success');
      setTimeout(fetchProcessList, 800);
    } else {
      toast(data.error || 'Gagal!', 'error');
    }
  } catch (err) {
    toast('Koneksi error: ' + err.message, 'error');
  }
}

function procDelete(id, name) {
  showConfirmModal(
    `Delete Process`,
    `<p>Yakin mau hapus process <strong>${escHtml(name)}</strong> (ID: ${id})?</p><p style="color:var(--danger);margin-top:8px;">⚠️ Action ini tidak bisa di-undo!</p>`,
    async () => {
      await procAction('delete', id);
      closeModal();
    }
  );
}

// ========================
// LOGS
// ========================
// ============================================================================
// ✨ ENHANCED REALTIME LOGS MODULE
// ============================================================================
// activeLogProcessId and logLines declared at top // { text, type: 'out'|'err', ts, el }
let logFilterText = '';

function setupLogControls() {
  const procSelect = document.getElementById('logProcessSelect');
  procSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val) loadLogsFor(val);
  });

  document.getElementById('clearLogBtn')?.addEventListener('click', () => {
    logLines = [];
    renderFilteredLogs();
    toast('Tampilan logs dibersihkan', 'info');
  });

  document.getElementById('flushLogBtn')?.addEventListener('click', async () => {
    if (!activeLogProcessId) return toast('Pilih process dulu!', 'warning');
    try {
      const res = await authFetch(`${API}/pm2/flush/${activeLogProcessId}`, { method: 'POST' });
      const data = await res.json();
      logLines = [];
      renderFilteredLogs();
      toast(data.message || 'Log file PM2 berhasil di-flush!', data.success ? 'success' : 'error');
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  document.getElementById('copyLogBtn')?.addEventListener('click', () => {
    if (logLines.length === 0) return toast('Tidak ada log untuk disalin', 'warning');
    const allText = logLines.map(l => `[${l.ts}] [${l.type.toUpperCase()}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(allText);
    toast(`${logLines.length} baris log disalin ke clipboard!`, 'success');
  });

  // Filters & Search
  const filterInput = document.getElementById('logFilterInput');
  const clearFilterBtn = document.getElementById('logFilterClearBtn');

  filterInput?.addEventListener('input', (e) => {
    logFilterText = e.target.value.toLowerCase().trim();
    if (clearFilterBtn) clearFilterBtn.style.display = logFilterText ? 'block' : 'none';
    renderFilteredLogs();
  });

  clearFilterBtn?.addEventListener('click', () => {
    if (filterInput) {
      filterInput.value = '';
      logFilterText = '';
      clearFilterBtn.style.display = 'none';
      renderFilteredLogs();
    }
  });

  document.getElementById('showOutLog')?.addEventListener('change', renderFilteredLogs);
  document.getElementById('showErrLog')?.addEventListener('change', renderFilteredLogs);
}

function updateLogSelect() {
  const sel = document.getElementById('logProcessSelect');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- Pilih Process --</option>' +
    processesData.map(p => `<option value="${p.id}" ${String(p.id) === String(cur) ? 'selected' : ''}>${escHtml(p.name)} (#${p.id}) [${p.status}]</option>`).join('');
}

async function loadLogsFor(id) {
  activeLogProcessId = id;
  const sel = document.getElementById('logProcessSelect');
  if (sel) sel.value = id;

  const proc = processesData.find(p => String(p.id) === String(id));
  const titleEl = document.getElementById('logTerminalTitle');
  if (titleEl) titleEl.textContent = proc ? `pm2-stream: ${proc.name} (#${proc.id})` : `pm2-stream: #${id}`;

  logLines = [];
  const terminal = document.getElementById('logTerminal');
  terminal.innerHTML = '<div class="log-placeholder"><i class="fas fa-spinner fa-spin"></i><p>Menghubungkan & memuat riwayat logs...</p></div>';

  try {
    const res = await authFetch(`${API}/pm2/logs/${id}?lines=200`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Gagal load logs');

    terminal.innerHTML = '';
    const nowTs = new Date().toLocaleTimeString('id-ID');

    if (data.stdout) {
      data.stdout.split('\n').forEach(line => {
        if (line) logLines.push({ text: line, type: 'out', ts: nowTs });
      });
    }
    if (data.stderr) {
      data.stderr.split('\n').forEach(line => {
        if (line) logLines.push({ text: line, type: 'err', ts: nowTs });
      });
    }

    renderFilteredLogs();
    scrollLogToBottom();
  } catch (err) {
    terminal.innerHTML = `<div class="log-placeholder" style="color:var(--danger)"><i class="fas fa-triangle-exclamation"></i><p>${escHtml(err.message)}</p></div>`;
  }
}

function appendLog(text, type = 'out', scroll = true) {
  const ts = new Date().toLocaleTimeString('id-ID');
  const logItem = { text, type, ts };
  logLines.push(logItem);

  if (logLines.length > 2500) {
    logLines.shift();
  }

  // Check if matches active filters
  const showErr = document.getElementById('showErrLog')?.checked !== false;
  const showOut = document.getElementById('showOutLog')?.checked !== false;
  if (type === 'err' && !showErr) return updateLogCounter();
  if (type === 'out' && !showOut) return updateLogCounter();
  if (logFilterText && !text.toLowerCase().includes(logFilterText)) return updateLogCounter();

  const terminal = document.getElementById('logTerminal');
  const placeholder = terminal.querySelector('.log-placeholder');
  if (placeholder) placeholder.remove();

  const lineEl = createLogElement(logItem);
  terminal.appendChild(lineEl);

  updateLogCounter();

  if (scroll && document.getElementById('autoScrollLog')?.checked !== false) {
    scrollLogToBottom();
  }
}

function createLogElement(log) {
  const line = document.createElement('div');
  line.className = `log-line ${log.type}`;
  
  const tsSpan = document.createElement('span');
  tsSpan.className = 'log-ts';
  tsSpan.textContent = `[${log.ts}]`;

  const contentSpan = document.createElement('span');
  contentSpan.className = 'log-content';
  contentSpan.textContent = log.text;

  line.appendChild(tsSpan);
  line.appendChild(contentSpan);
  return line;
}

function renderFilteredLogs() {
  const terminal = document.getElementById('logTerminal');
  if (!terminal) return;
  terminal.innerHTML = '';

  const showErr = document.getElementById('showErrLog')?.checked !== false;
  const showOut = document.getElementById('showOutLog')?.checked !== false;

  const filtered = logLines.filter(l => {
    if (l.type === 'err' && !showErr) return false;
    if (l.type === 'out' && !showOut) return false;
    if (logFilterText && !l.text.toLowerCase().includes(logFilterText)) return false;
    return true;
  });

  if (filtered.length === 0) {
    terminal.innerHTML = `<div class="log-placeholder"><i class="fas fa-terminal"></i><p>${activeLogProcessId ? 'Tidak ada logs yang cocok dengan filter' : 'Pilih salah satu process di atas untuk mulai melihat streaming log realtime...'}</p></div>`;
  } else {
    const fragment = document.createDocumentFragment();
    for (const item of filtered) {
      fragment.appendChild(createLogElement(item));
    }
    terminal.appendChild(fragment);
  }

  updateLogCounter(filtered.length);
  if (document.getElementById('autoScrollLog')?.checked !== false) {
    scrollLogToBottom();
  }
}

function updateLogCounter(count) {
  const counterEl = document.getElementById('logsLineCount');
  if (counterEl) {
    const num = count !== undefined ? count : logLines.length;
    counterEl.textContent = `${num} baris ditampilkan (${logLines.length} total)`;
  }
}

function scrollLogToBottom() {
  const terminal = document.getElementById('logTerminal');
  if (terminal) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

function openLogs(id) {
  activeLogProcessId = id;
  navigateTo('logs');
  loadLogsFor(id);
}

// ========================
// PROCESS INFO MODAL
// ========================
async function openInfo(id) {
  try {
    const res = await authFetch(`${API}/pm2/info/${id}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    const p = data.process;
    const env = p.pm2_env;

    showModal(`Process Info: ${escHtml(p.name)}`, `
      <table class="detail-table">
        <tr><td>ID</td><td>${p.pm_id}</td></tr>
        <tr><td>Name</td><td>${escHtml(p.name)}</td></tr>
        <tr><td>Status</td><td>${statusBadge(env.status)}</td></tr>
        <tr><td>PID</td><td>${p.pid || '-'}</td></tr>
        <tr><td>Script</td><td>${escHtml(env.pm_exec_path || '-')}</td></tr>
        <tr><td>CWD</td><td>${escHtml(env.pm_cwd || '-')}</td></tr>
        <tr><td>Exec Mode</td><td>${env.exec_mode || '-'}</td></tr>
        <tr><td>Instances</td><td>${env.instances || 1}</td></tr>
        <tr><td>Restarts</td><td>${env.restart_time || 0}</td></tr>
        <tr><td>Uptime</td><td>${formatUptime(Date.now() - (env.pm_uptime || Date.now()))}</td></tr>
        <tr><td>Memory</td><td>${formatBytes(p.monit?.memory || 0)}</td></tr>
        <tr><td>CPU</td><td>${(p.monit?.cpu || 0).toFixed(1)}%</td></tr>
        <tr><td>Node Ver</td><td>${env.node_version || '-'}</td></tr>
        <tr><td>Stdout Log</td><td>${escHtml(env.pm_out_log_path || '-')}</td></tr>
        <tr><td>Stderr Log</td><td>${escHtml(env.pm_err_log_path || '-')}</td></tr>
        <tr><td>Created At</td><td>${env.created_at ? new Date(env.created_at).toLocaleString('id-ID') : '-'}</td></tr>
      </table>
    `);
  } catch (err) {
    toast('Gagal load info: ' + err.message, 'error');
  }
}

// ========================
// DEPLOY FORM
// ========================
function setupProcessButtons() {
  document.getElementById('startProcessBtn')?.addEventListener('click', () => navigateTo('deploy'));
  document.getElementById('dashStartBtn')?.addEventListener('click', () => navigateTo('deploy'));
  document.getElementById('saveBtn')?.addEventListener('click', async () => {
    const res = await authFetch(`${API}/pm2/save`, { method: 'POST' });
    const data = await res.json();
    toast(data.message || 'Saved!', data.success ? 'success' : 'error');
  });
  document.getElementById('refreshBtn')?.addEventListener('click', () => {
    fetchProcessList();
    toast('Refreshed!', 'info');
  });
}

function setupDeployForm() {
  document.getElementById('deployForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultEl = document.getElementById('deployResult');
    resultEl.style.display = 'none';

    const runtime = document.getElementById('depRuntime').value;
    const name = document.getElementById('depName').value.trim();
    const cwd = document.getElementById('depCwd').value.trim();
    const instances = parseInt(document.getElementById('depInstances').value) || 1;
    const max_memory_restart = document.getElementById('depMaxMem').value.trim() || '500M';
    const watch = document.getElementById('depWatch').checked;

    let script = '';
    let interpreter = '';

    if (runtime === 'node') {
      script = document.getElementById('depScript').value.trim();
      if (!script) { toast('Script wajib diisi!', 'error'); return; }
    } else if (runtime === 'python') {
      script = document.getElementById('depPyScript').value.trim();
      const pyPath = document.getElementById('depPyPath').value.trim() || 'python';
      interpreter = pyPath;
      if (!script) { toast('Script Python wajib diisi!', 'error'); return; }
    } else if (runtime === 'custom') {
      interpreter = document.getElementById('depCustomInterp').value.trim();
      script = document.getElementById('depCustomScript').value.trim();
      if (!interpreter || !script) { toast('Interpreter dan Script wajib diisi!', 'error'); return; }
    }

    try {
      const res = await authFetch(`${API}/pm2/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, name: name || undefined, cwd: cwd || undefined, instances, max_memory_restart, watch, interpreter: interpreter || undefined }),
      });
      const data = await res.json();
      resultEl.className = `alert ${data.success ? 'alert-success' : 'alert-danger'}`;
      resultEl.textContent = data.message || data.error;
      resultEl.style.display = 'block';
      if (data.success) {
        setTimeout(fetchProcessList, 1000);
        toast('Process berhasil distart!', 'success');
      }
    } catch (err) {
      resultEl.className = 'alert alert-danger';
      resultEl.textContent = 'Error: ' + err.message;
      resultEl.style.display = 'block';
    }
  });
}

// ========================
// TERMINAL XTERM
// ========================
let xtermInstance = null;
let fitAddon = null;
let ptyConnected = false;

function setupTerminal() {
  // Connect otomatis saat halaman terminal dibuka
  document.getElementById('termConnectBtn')?.addEventListener('click', () => {
    initXterm();
  });

  document.getElementById('termKillBtn')?.addEventListener('click', () => {
    if (ws && ptyConnected) {
      ws.send(JSON.stringify({ type: 'pty_kill' }));
      ptyConnected = false;
      if (xtermInstance) xtermInstance.writeln('\r\n\x1b[33m[Terminal disconnected]\x1b[0m');
    }
  });
}

function initXterm() {
  const container = document.getElementById('xtermContainer');
  if (!container) return;

  // Kill PTY lama di server dulu sebelum bikin baru
  if (ws && ws.readyState === WebSocket.OPEN && ptyConnected) {
    ws.send(JSON.stringify({ type: 'pty_kill' }));
  }
  ptyConnected = false;

  // Dispose xterm lama
  if (xtermInstance) {
    xtermInstance.dispose();
    xtermInstance = null;
  }
  container.innerHTML = '';

  // Init xterm
  xtermInstance = new Terminal({
    theme: {
      background: '#0a0d14',
      foreground: '#c9d1d9',
      cursor: '#6366f1',
      selectionBackground: 'rgba(99,102,241,0.3)',
      black: '#0a0d14',
      red: '#f87171',
      green: '#22c55e',
      yellow: '#f59e0b',
      blue: '#6366f1',
      magenta: '#a78bfa',
      cyan: '#22d3ee',
      white: '#e2e8f0',
      brightBlack: '#64748b',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fcd34d',
      brightBlue: '#818cf8',
      brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9',
      brightWhite: '#f8fafc',
    },
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
    fontSize: 14,
    lineHeight: 1.4,
    cursorBlink: true,
    scrollback: 5000,
    allowTransparency: false,
  });

  fitAddon = new FitAddon.FitAddon();
  xtermInstance.loadAddon(fitAddon);
  xtermInstance.open(container);
  fitAddon.fit();

  // Resize observer
  const ro = new ResizeObserver(() => { if (fitAddon) fitAddon.fit(); });
  ro.observe(container);

  xtermInstance.writeln('\x1b[32mConnecting to terminal...\x1b[0m');

  // Pastiin WS connected, lalu kirim pty_start
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    xtermInstance.writeln('\x1b[31mWebSocket tidak terhubung! Refresh halaman dulu.\x1b[0m');
    return;
  }

  const cwd = document.getElementById('termCwdInput')?.value.trim() || '';
  ws.send(JSON.stringify({
    type: 'pty_start',
    cols: xtermInstance.cols,
    rows: xtermInstance.rows,
    cwd,
  }));
  ptyConnected = true;

  // Kirim input dari xterm ke PTY
  xtermInstance.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN && ptyConnected) {
      ws.send(JSON.stringify({ type: 'pty_input', data }));
    }
  });

  // Resize
  xtermInstance.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN && ptyConnected) {
      ws.send(JSON.stringify({ type: 'pty_resize', cols, rows }));
    }
  });
}

// Handle pesan PTY dari server (di handleWsMessage)
function handlePtyOutput(msg) {
  if (msg.type === 'pty_output' && xtermInstance) {
    xtermInstance.write(msg.data);
  }
  if (msg.type === 'pty_exit' && xtermInstance) {
    xtermInstance.writeln(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m`);
    ptyConnected = false;
  }
}
function setupRuntimeSelector() {
  const runtime = document.getElementById('depRuntime');
  if (!runtime) return;
  runtime.addEventListener('change', () => {
    document.getElementById('optNode').style.display = runtime.value === 'node' ? '' : 'none';
    document.getElementById('optPython').style.display = runtime.value === 'python' ? '' : 'none';
    document.getElementById('optCustom').style.display = runtime.value === 'custom' ? '' : 'none';
  });
}

// ========================
// TERMINAL
// ========================
let termCwd = '';
let termHistory = [];
let termHistoryIdx = -1;

function setupTerminal() {
  const input = document.getElementById('termInput');
  const sendBtn = document.getElementById('termSendBtn');
  const clearBtn = document.getElementById('termClearBtn');
  const setCwdBtn = document.getElementById('termSetCwdBtn');

  if (!input) return;

  sendBtn.addEventListener('click', () => runTermCommand());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runTermCommand(); }
    // History up/down
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (termHistoryIdx < termHistory.length - 1) {
        termHistoryIdx++;
        input.value = termHistory[termHistory.length - 1 - termHistoryIdx] || '';
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (termHistoryIdx > 0) {
        termHistoryIdx--;
        input.value = termHistory[termHistory.length - 1 - termHistoryIdx] || '';
      } else {
        termHistoryIdx = -1;
        input.value = '';
      }
    }
  });

  clearBtn.addEventListener('click', () => {
    document.getElementById('termOutput').innerHTML = '<div class="log-placeholder"><i class="fas fa-terminal"></i> Cleared.</div>';
  });

  setCwdBtn.addEventListener('click', () => {
    const val = document.getElementById('termCwdInput').value.trim();
    termCwd = val;
    const prompt = document.getElementById('termPrompt');
    if (prompt) prompt.textContent = val ? `${val}>` : '$';
    toast(`Working directory diset ke: ${val || '(default)'}`, 'info');
  });
}

async function runTermCommand() {
  const input = document.getElementById('termInput');
  const cmd = input.value.trim();
  if (!cmd) return;

  input.value = '';
  termHistory.push(cmd);
  termHistoryIdx = -1;

  const cwdInput = document.getElementById('termCwdInput');
  const prompt = document.getElementById('termPrompt');

  // Handle "cd" secara lokal — update cwd tanpa kirim ke server
  if (/^cd(\s|$)/i.test(cmd)) {
    const targetRaw = cmd.slice(2).trim();
    if (!targetRaw) {
      termCwd = '';
      cwdInput.value = '';
      prompt.textContent = '$';
      termAppendLine(`<span style="color:var(--text3);">Directory direset ke default</span>`);
    } else {
      try {
        const res = await authFetch('/api/terminal/resolve-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: targetRaw, cwd: termCwd }),
        });
        const data = await res.json();
        if (data.resolved) {
          termCwd = data.resolved;
          cwdInput.value = termCwd;
          prompt.textContent = `${termCwd}>`;
          termAppendLine(`<span style="color:var(--text3);">&#x276F; cd ${escHtml(termCwd)}</span>`);
        } else {
          termAppendLine(`<span style="color:var(--danger);">cd: ${escHtml(data.error || 'Path tidak ditemukan')}</span>`);
        }
      } catch (err) {
        termAppendLine(`<span style="color:var(--danger);">cd error: ${escHtml(err.message)}</span>`);
      }
    }
    return;
  }

  const cwd = termCwd || cwdInput?.value.trim() || '';
  termAppendLine(`<span style="color:var(--primary-light);">&#x276F; ${escHtml(cmd)}</span>`);

  try {
    const res = await authFetch('/api/terminal/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, cwd }),
    });
    const data = await res.json();
    if (data.stdout) {
      data.stdout.split('\n').forEach(line => line && termAppendLine(escHtml(line)));
    }
    if (data.stderr) {
      data.stderr.split('\n').forEach(line => line && termAppendLine(`<span style="color:var(--danger);">${escHtml(line)}</span>`));
    }
    if (data.error) {
      termAppendLine(`<span style="color:var(--danger);">Error: ${escHtml(data.error)}</span>`);
    }
    if (!data.stdout && !data.stderr && !data.error) {
      termAppendLine('<span style="color:var(--text3);">&#x2713; Done (no output)</span>');
    }
  } catch (err) {
    termAppendLine(`<span style="color:var(--danger);">Koneksi error: ${escHtml(err.message)}</span>`);
  }
}

function termAppendLine(html) {
  const output = document.getElementById('termOutput');
  const placeholder = output.querySelector('.log-placeholder');
  if (placeholder) placeholder.remove();

  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = html;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}
function setupChangePassForm() {
  document.getElementById('changePassForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultEl = document.getElementById('passResult');
    const oldPass = document.getElementById('oldPass').value;
    const newPass = document.getElementById('newPass').value;
    const confirmPass = document.getElementById('confirmPass').value;

    if (newPass !== confirmPass) {
      resultEl.className = 'alert alert-danger';
      resultEl.textContent = 'Password baru tidak cocok!';
      resultEl.style.display = 'block';
      return;
    }

    try {
      const res = await authFetch(`${API}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: oldPass, newPassword: newPass }),
      });
      const data = await res.json();
      resultEl.className = `alert ${res.ok ? 'alert-success' : 'alert-danger'}`;
      resultEl.textContent = data.message || data.error;
      resultEl.style.display = 'block';
      if (res.ok) {
        document.getElementById('changePassForm').reset();
        toast('Password berhasil diubah!', 'success');
      }
    } catch (err) {
      resultEl.className = 'alert alert-danger';
      resultEl.textContent = 'Error: ' + err.message;
      resultEl.style.display = 'block';
    }
  });
}

// ========================
// MODAL
// ========================
function setupModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });
}

function showModal(title, bodyHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalOverlay').style.display = 'flex';
}

function showConfirmModal(title, bodyHtml, onConfirm) {
  const html = `
    ${bodyHtml}
    <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn btn-danger" id="confirmActionBtn"><i class="fas fa-trash"></i> Ya, Hapus!</button>
    </div>`;
  showModal(title, html);
  setTimeout(() => {
    document.getElementById('confirmActionBtn')?.addEventListener('click', onConfirm);
  }, 50);
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

// ========================
// TOAST
// ========================
function toast(message, type = 'info') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const colors = { success: 'var(--success)', error: 'var(--danger)', warning: 'var(--warning)', info: 'var(--info)' };
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}" style="color:${colors[type]};"></i><span>${escHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ========================
// HELPERS
// ========================
async function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(ms) {
  if (!ms || ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  const d = Math.floor(h / 24);
  return d + 'd ' + (h % 24) + 'h';
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}



// ============================================================================
// ✨ ENHANCED FILE MANAGER MODULE (MULTI-SELECT, ZIP, UNZIP, PRO EDITOR)
// ============================================================================
let fmCurrentDir = '/data';
let fmFilesData = [];
let fmEditingFilePath = null;
let fmViewMode = localStorage.getItem('fm_view_mode') || 'grid'; // 'grid' | 'list'
let fmSelectedItems = new Set(); // holds item names (e.g. 'subfolder', 'test.py')

function setupFileManager() {
  // Refresh
  document.getElementById('fmRefreshBtn')?.addEventListener('click', () => loadFileManager(fmCurrentDir));
  
  // Up button
  document.getElementById('fmUpBtn')?.addEventListener('click', () => {
    const parts = fmCurrentDir.split('/').filter(Boolean);
    parts.pop();
    const parentDir = '/' + parts.join('/');
    loadFileManager(parentDir || '/');
  });

  // Copy path
  document.getElementById('fmCopyPathBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(fmCurrentDir);
    toast('Path direktori disalin: ' + fmCurrentDir, 'info');
  });

  // View Mode Toggles (Grid / List)
  const gridBtn = document.getElementById('fmViewGridBtn');
  const listBtn = document.getElementById('fmViewListBtn');

  function setFmViewMode(mode) {
    fmViewMode = mode;
    localStorage.setItem('fm_view_mode', mode);
    if (mode === 'grid') {
      gridBtn?.classList.add('active');
      listBtn?.classList.remove('active');
    } else {
      listBtn?.classList.add('active');
      gridBtn?.classList.remove('active');
    }
    renderFileManager(document.getElementById('fmSearchInput')?.value.toLowerCase().trim() || '');
  }

  gridBtn?.addEventListener('click', () => setFmViewMode('grid'));
  listBtn?.addEventListener('click', () => setFmViewMode('list'));
  if (fmViewMode === 'grid') {
    gridBtn?.classList.add('active');
    listBtn?.classList.remove('active');
  } else {
    listBtn?.classList.add('active');
    gridBtn?.classList.remove('active');
  }

  // Select All button
  document.getElementById('fmSelectAllBtn')?.addEventListener('click', () => {
    const filter = document.getElementById('fmSearchInput')?.value.toLowerCase().trim() || '';
    const items = fmFilesData.filter(f => !filter || f.name.toLowerCase().includes(filter));
    if (fmSelectedItems.size === items.length && items.length > 0) {
      fmSelectedItems.clear();
    } else {
      items.forEach(i => fmSelectedItems.add(i.name));
    }
    updateBulkSelectionBar();
    renderFileManager(filter);
  });

  // Clear Selection
  document.getElementById('fmClearSelectedBtn')?.addEventListener('click', () => {
    fmSelectedItems.clear();
    updateBulkSelectionBar();
    renderFileManager(document.getElementById('fmSearchInput')?.value.toLowerCase().trim() || '');
  });

  // Zip Selected Items
  document.getElementById('fmZipSelectedBtn')?.addEventListener('click', () => {
    if (fmSelectedItems.size === 0) return toast('Pilih minimal 1 file/folder untuk di-zip!', 'warning');
    const selectedArray = Array.from(fmSelectedItems);
    const defaultZipName = (selectedArray.length === 1 ? selectedArray[0].replace(/\.[^/.]+$/, '') : 'archive') + '.zip';

    const html = `
      <div class="form-group">
        <label><i class="fas fa-file-zipper"></i> Nama File ZIP Hasil Kompresi:</label>
        <input type="text" id="modalZipFileName" value="${escHtml(defaultZipName)}" class="form-select" style="width:100%;" />
        <small style="color:var(--text3);margin-top:6px;display:block;">
          Mengompres <strong>${selectedArray.length} item</strong> (${selectedArray.slice(0, 3).join(', ')}${selectedArray.length > 3 ? '...' : ''})
        </small>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="modalZipConfirmBtn"><i class="fas fa-file-zipper"></i> Mulai Kompres</button>
      </div>`;
    showModal('Kompres ke ZIP', html);

    setTimeout(() => {
      document.getElementById('modalZipConfirmBtn')?.addEventListener('click', async () => {
        const zipName = document.getElementById('modalZipFileName').value.trim();
        if (!zipName) return toast('Nama file zip wajib diisi!', 'warning');
        closeModal();
        toast(`Sedang mengompres ${selectedArray.length} item ke ${zipName}...`, 'info');

        try {
          const res = await authFetch(`${API}/files/zip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentDir: fmCurrentDir, items: selectedArray, zipName })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          toast(data.message, 'success');
          fmSelectedItems.clear();
          updateBulkSelectionBar();
          loadFileManager(fmCurrentDir);
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    }, 50);
  });

  // Delete Selected Items
  document.getElementById('fmDeleteSelectedBtn')?.addEventListener('click', () => {
    if (fmSelectedItems.size === 0) return toast('Pilih minimal 1 item untuk dihapus!', 'warning');
    const selectedArray = Array.from(fmSelectedItems);
    const fullPaths = selectedArray.map(name => `${fmCurrentDir === '/' ? '' : fmCurrentDir}/${name}`);

    showConfirmModal('Hapus Item Terpilih', `<p>Yakin ingin menghapus <strong>${selectedArray.length} item</strong> terpilih secara permanen?<br><small style="color:var(--text3);">${escHtml(selectedArray.slice(0, 4).join(', '))}${selectedArray.length > 4 ? '...' : ''}</small></p>`, async () => {
      try {
        const res = await authFetch(`${API}/files/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: fullPaths })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        closeModal();
        toast(data.message, 'success');
        fmSelectedItems.clear();
        updateBulkSelectionBar();
        loadFileManager(fmCurrentDir);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });

  // Search/Filter with clear button
  const searchInput = document.getElementById('fmSearchInput');
  const searchClear = document.getElementById('fmSearchClearBtn');

  searchInput?.addEventListener('input', (e) => {
    const val = e.target.value;
    if (searchClear) searchClear.style.display = val ? 'block' : 'none';
    renderFileManager(val.toLowerCase().trim());
  });

  searchClear?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      searchClear.style.display = 'none';
      renderFileManager('');
    }
  });

  // New File / Folder
  document.getElementById('fmNewFileBtn')?.addEventListener('click', () => {
    const html = `
      <div class="form-group">
        <label><i class="fas fa-file-code"></i> Nama File (misal: server.js, config.json, .env):</label>
        <input type="text" id="modalNewFileName" placeholder="script.js" class="form-select" style="width:100%;" />
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="modalCreateFileConfirmBtn"><i class="fas fa-plus"></i> Buat File</button>
      </div>`;
    showModal('Buat File Baru', html);
    setTimeout(() => {
      document.getElementById('modalCreateFileConfirmBtn')?.addEventListener('click', async () => {
        const name = document.getElementById('modalNewFileName').value.trim();
        if (!name) return toast('Nama file wajib diisi!', 'warning');
        try {
          const res = await authFetch(`${API}/files/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir: fmCurrentDir, name, type: 'file' })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          closeModal();
          toast(data.message, 'success');
          loadFileManager(fmCurrentDir);
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    }, 50);
  });

  document.getElementById('fmNewFolderBtn')?.addEventListener('click', () => {
    const html = `
      <div class="form-group">
        <label><i class="fas fa-folder-plus"></i> Nama Folder Baru:</label>
        <input type="text" id="modalNewFolderName" placeholder="my_new_folder" class="form-select" style="width:100%;" />
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
        <button class="btn btn-success" id="modalCreateFolderConfirmBtn"><i class="fas fa-folder-plus"></i> Buat Folder</button>
      </div>`;
    showModal('Buat Folder Baru', html);
    setTimeout(() => {
      document.getElementById('modalCreateFolderConfirmBtn')?.addEventListener('click', async () => {
        const name = document.getElementById('modalNewFolderName').value.trim();
        if (!name) return toast('Nama folder wajib diisi!', 'warning');
        try {
          const res = await authFetch(`${API}/files/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir: fmCurrentDir, name, type: 'folder' })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          closeModal();
          toast(data.message, 'success');
          loadFileManager(fmCurrentDir);
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    }, 50);
  });

  // Upload button
  const fileInput = document.getElementById('fmFileInput');
  document.getElementById('fmUploadTriggerBtn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    uploadFiles(fileInput.files);
  });

  // Drag and Drop Upload
  const dropZone = document.getElementById('fmDropZone');
  if (dropZone) {
    let dragCounter = 0;
    dropZone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dropZone.classList.remove('drag-over');
        dragCounter = 0;
      }
    });
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files);
      }
    });
  }

  // Editor controls
  document.getElementById('fmEditorSaveBtn')?.addEventListener('click', saveEditingFile);
  document.getElementById('fmEditorCloseBtn')?.addEventListener('click', closeFileEditor);
  document.getElementById('fmEditorFormatBtn')?.addEventListener('click', formatEditorContent);

  // Tab key indent & Ctrl+S inside editor
  const textarea = document.getElementById('fmEditorTextarea');
  const lineNumbers = document.getElementById('fmEditorLineNumbers');

  textarea?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveEditingFile();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      updateEditorStats();
    }
  });

  textarea?.addEventListener('scroll', () => {
    if (lineNumbers) lineNumbers.scrollTop = textarea.scrollTop;
  });

  textarea?.addEventListener('input', updateEditorStats);
  textarea?.addEventListener('keyup', updateEditorStats);
  textarea?.addEventListener('click', updateEditorStats);
}

function updateBulkSelectionBar() {
  const bar = document.getElementById('fmBulkActions');
  const countEl = document.getElementById('fmSelectedCount');
  if (!bar || !countEl) return;

  if (fmSelectedItems.size > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `${fmSelectedItems.size} item dipilih`;
  } else {
    bar.style.display = 'none';
  }
}

function toggleSelectItem(name, event) {
  event?.stopPropagation();
  if (fmSelectedItems.has(name)) {
    fmSelectedItems.delete(name);
  } else {
    fmSelectedItems.add(name);
  }
  updateBulkSelectionBar();
  renderFileManager(document.getElementById('fmSearchInput')?.value.toLowerCase().trim() || '');
}

async function uploadFiles(files) {
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }
  try {
    toast(`Mengunggah ${files.length} file ke ${fmCurrentDir}...`, 'info');
    const res = await fetch(`${API}/files/upload?dir=${encodeURIComponent(fmCurrentDir)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast(data.message, 'success');
    const fileInput = document.getElementById('fmFileInput');
    if (fileInput) fileInput.value = '';
    loadFileManager(fmCurrentDir);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadFileManager(dir = '/data') {
  const wrap = document.getElementById('fmListWrap');
  wrap.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Memuat direktori...</p></div>';
  fmSelectedItems.clear();
  updateBulkSelectionBar();

  try {
    const res = await authFetch(`${API}/files/list?dir=${encodeURIComponent(dir)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    fmCurrentDir = data.currentPath;
    fmFilesData = data.items || [];
    renderBreadcrumbs(fmCurrentDir);
    updateFmStatsSummary();
    renderFileManager(document.getElementById('fmSearchInput')?.value.toLowerCase().trim() || '');
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><i class="fas fa-triangle-exclamation" style="color:var(--danger)"></i><p>${escHtml(err.message)}</p></div>`;
  }
}

function updateFmStatsSummary() {
  const summaryEl = document.getElementById('fmStatsSummary');
  if (!summaryEl) return;
  const dirs = fmFilesData.filter(f => f.isDirectory).length;
  const files = fmFilesData.filter(f => !f.isDirectory).length;
  const totalBytes = fmFilesData.reduce((acc, f) => acc + (f.size || 0), 0);
  summaryEl.textContent = `${dirs} Folder, ${files} File • Total: ${formatBytes(totalBytes)}`;
}

function renderBreadcrumbs(dir) {
  const container = document.getElementById('fmBreadcrumbs');
  if (!container) return;

  const parts = dir.split('/').filter(Boolean);
  let html = `<span class="crumb ${parts.length === 0 ? 'active' : ''}" onclick="loadFileManager('/')"><i class="fas fa-hdd"></i> root</span>`;
  let currentAccum = '';

  for (let i = 0; i < parts.length; i++) {
    currentAccum += '/' + parts[i];
    const pathTarget = currentAccum;
    const isLast = i === parts.length - 1;
    html += `<span class="sep">/</span><span class="crumb ${isLast ? 'active' : ''}" onclick="loadFileManager('${escHtml(pathTarget)}')">${escHtml(parts[i])}</span>`;
  }
  container.innerHTML = html;
}

function getFileIconClass(item) {
  if (item.isDirectory) return { icon: 'fa-folder', type: 'is-dir' };
  if (item.isDb) return { icon: 'fa-database', type: 'is-db' };
  if (item.isZip) return { icon: 'fa-file-zipper', type: 'is-zip' };
  if (item.isText) return { icon: 'fa-file-code', type: 'is-code' };
  return { icon: 'fa-file-lines', type: 'is-file' };
}

function renderFileManager(filter = '') {
  const wrap = document.getElementById('fmListWrap');
  const items = fmFilesData.filter(f => !filter || f.name.toLowerCase().includes(filter));

  if (items.length === 0) {
    wrap.className = '';
    wrap.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>${filter ? 'Tidak ada file/folder yang sesuai pencarian' : 'Direktori ini kosong'}</p></div>`;
    return;
  }

  if (fmViewMode === 'grid') {
    wrap.className = 'fm-view-grid';
    let html = '';
    for (const item of items) {
      const { icon, type } = getFileIconClass(item);
      const safePath = escHtml(item.path);
      const safeName = escHtml(item.name);
      const isSelected = fmSelectedItems.has(item.name);
      const dateStr = new Date(item.modified).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' });

      html += `
        <div class="fm-grid-card ${type} ${isSelected ? 'selected' : ''}" onclick="${item.isDirectory ? `loadFileManager('${safePath}')` : (item.isDb ? `openSqliteFromFm('${safePath}')` : (item.isZip ? `unzipFmItem('${safePath}', '${safeName}')` : `openFileEditor('${safePath}')`))}">
          <input type="checkbox" class="fm-select-checkbox" ${isSelected ? 'checked' : ''} onclick="toggleSelectItem('${safeName}', event)" />
          
          <div class="fm-card-actions" onclick="event.stopPropagation()">
            ${item.isZip ? `<button class="fm-mini-btn" onclick="unzipFmItem('${safePath}', '${safeName}')" title="Extract ZIP"><i class="fas fa-file-export"></i></button>` : ''}
            ${item.isDb ? `<button class="fm-mini-btn" onclick="openSqliteFromFm('${safePath}')" title="Buka SQLite"><i class="fas fa-database"></i></button>` : ''}
            ${(!item.isDirectory && item.isText) ? `<button class="fm-mini-btn" onclick="openFileEditor('${safePath}')" title="Edit File"><i class="fas fa-edit"></i></button>` : ''}
            ${!item.isDirectory ? `<a href="${API}/files/download?path=${encodeURIComponent(item.path)}" class="fm-mini-btn" title="Download" download><i class="fas fa-download"></i></a>` : ''}
            <button class="fm-mini-btn" onclick="renameFmItem('${safePath}', '${safeName}')" title="Rename"><i class="fas fa-i-cursor"></i></button>
            <button class="fm-mini-btn del" onclick="deleteFmItem('${safePath}', '${safeName}', ${item.isDirectory})" title="Hapus"><i class="fas fa-trash"></i></button>
          </div>

          <div class="fm-card-icon-wrap">
            <i class="fas ${icon}"></i>
          </div>
          <div>
            <div class="fm-card-name" title="${safeName}">${safeName}</div>
            <div class="fm-card-meta">
              <span>${item.isDirectory ? 'Folder' : formatBytes(item.size)}</span>
              <span>${dateStr}</span>
            </div>
          </div>
        </div>`;
    }
    wrap.innerHTML = html;
  } else {
    // List View
    wrap.className = 'fm-view-list';
    let html = `
      <table class="fm-list-table">
        <thead>
          <tr>
            <th style="width:40px;text-align:center;"><i class="fas fa-check-square"></i></th>
            <th>Nama</th>
            <th style="width:120px;">Ukuran</th>
            <th style="width:160px;">Modified</th>
            <th style="width:200px;text-align:right;">Aksi</th>
          </tr>
        </thead>
        <tbody>`;

    for (const item of items) {
      const { icon } = getFileIconClass(item);
      const safePath = escHtml(item.path);
      const safeName = escHtml(item.name);
      const isSelected = fmSelectedItems.has(item.name);
      const dateStr = new Date(item.modified).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });

      html += `
        <tr class="fm-list-row ${isSelected ? 'selected' : ''}" onclick="${item.isDirectory ? `loadFileManager('${safePath}')` : (item.isDb ? `openSqliteFromFm('${safePath}')` : (item.isZip ? `unzipFmItem('${safePath}', '${safeName}')` : `openFileEditor('${safePath}')`))}">
          <td style="text-align:center;" onclick="event.stopPropagation()">
            <input type="checkbox" style="cursor:pointer;" ${isSelected ? 'checked' : ''} onclick="toggleSelectItem('${safeName}', event)" />
          </td>
          <td>
            <div class="fm-item-name-cell">
              <i class="fas ${icon} fm-row-icon"></i>
              <span>${safeName}</span>
            </div>
          </td>
          <td><small style="color:var(--text2);font-family:'JetBrains Mono',monospace;">${item.isDirectory ? 'Folder' : formatBytes(item.size)}</small></td>
          <td><small style="color:var(--text3);">${dateStr}</small></td>
          <td onclick="event.stopPropagation()">
            <div class="action-btns" style="justify-content:flex-end;">
              ${item.isZip ? `<button class="btn btn-xs btn-warning" onclick="unzipFmItem('${safePath}', '${safeName}')" title="Extract ZIP"><i class="fas fa-file-export"></i> Unzip</button>` : ''}
              ${item.isDb ? `<button class="btn btn-xs btn-info" onclick="openSqliteFromFm('${safePath}')" title="Buka SQLite"><i class="fas fa-database"></i></button>` : ''}
              ${(!item.isDirectory && item.isText) ? `<button class="btn btn-xs btn-primary" onclick="openFileEditor('${safePath}')" title="Edit"><i class="fas fa-edit"></i> Edit</button>` : ''}
              ${!item.isDirectory ? `<a href="${API}/files/download?path=${encodeURIComponent(item.path)}" class="btn btn-xs btn-secondary" title="Download" download><i class="fas fa-download"></i></a>` : ''}
              <button class="btn btn-xs btn-secondary" onclick="renameFmItem('${safePath}', '${safeName}')" title="Rename"><i class="fas fa-i-cursor"></i></button>
              <button class="btn btn-xs btn-danger" onclick="deleteFmItem('${safePath}', '${safeName}', ${item.isDirectory})" title="Hapus"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>`;
    }

    html += `</tbody></table>`;
    wrap.innerHTML = html;
  }
}

async function unzipFmItem(archivePath, archiveName) {
  const html = `
    <div class="form-group">
      <label><i class="fas fa-folder-open"></i> Ekstrak ke Direktori Tujuan:</label>
      <input type="text" id="modalUnzipTargetDir" value="${escHtml(fmCurrentDir)}" class="form-select" style="width:100%;" />
      <small style="color:var(--text3);margin-top:6px;display:block;">File archive: <strong>${escHtml(archiveName)}</strong></small>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn btn-warning" id="modalUnzipConfirmBtn"><i class="fas fa-file-export"></i> Mulai Extract</button>
    </div>`;
  showModal('Extract Archive (Unzip)', html);

  setTimeout(() => {
    document.getElementById('modalUnzipConfirmBtn')?.addEventListener('click', async () => {
      const destDir = document.getElementById('modalUnzipTargetDir').value.trim();
      if (!destDir) return toast('Direktori tujuan wajib diisi!', 'warning');
      closeModal();
      toast(`Mengekstrak archive "${archiveName}" ke ${destDir}...`, 'info');

      try {
        const res = await authFetch(`${API}/files/unzip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archivePath, targetDir: destDir })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message, 'success');
        loadFileManager(fmCurrentDir);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }, 50);
}

async function openFileEditor(filePath) {
  try {
    toast('Membuka file...', 'info');
    const res = await authFetch(`${API}/files/read?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    fmEditingFilePath = data.path;
    const card = document.getElementById('fmEditorCard');
    const title = document.getElementById('fmEditorTitle');
    const badge = document.getElementById('fmEditorPathBadge');
    const typeBadge = document.getElementById('fmEditorTypeBadge');
    const sizeBadge = document.getElementById('fmEditorSizeBadge');
    const textarea = document.getElementById('fmEditorTextarea');

    const ext = filePath.split('.').pop().toUpperCase();
    title.textContent = filePath.split('/').pop();
    badge.textContent = filePath;
    typeBadge.textContent = ext.length > 6 ? 'FILE' : ext;
    sizeBadge.textContent = formatBytes(data.size);
    textarea.value = data.content;

    card.style.display = 'block';
    updateEditorStats();
    card.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    toast(e.message, 'error');
  }
}

function updateEditorStats() {
  const textarea = document.getElementById('fmEditorTextarea');
  const lineNumbers = document.getElementById('fmEditorLineNumbers');
  if (!textarea) return;

  const val = textarea.value;
  const lineCount = val.split('\n').length;

  if (lineNumbers) {
    let nums = '';
    for (let i = 1; i <= lineCount; i++) {
      nums += i + '\n';
    }
    lineNumbers.textContent = nums;
  }

  const cursorLines = val.substr(0, textarea.selectionStart).split('\n');
  const lineNum = cursorLines.length;
  const colNum = cursorLines[cursorLines.length - 1].length + 1;

  document.getElementById('fmEditorCursorPos').textContent = `Baris: ${lineNum}, Kolom: ${colNum}`;
  document.getElementById('fmEditorCharCount').textContent = `${val.length} karakter (${lineCount} baris)`;
}

function formatEditorContent() {
  const textarea = document.getElementById('fmEditorTextarea');
  if (!textarea || !textarea.value) return;

  const val = textarea.value.trim();
  try {
    const parsed = JSON.parse(val);
    textarea.value = JSON.stringify(parsed, null, 2);
    updateEditorStats();
    toast('Berhasil memformat JSON!', 'success');
  } catch (e) {
    toast('Format otomatis hanya didukung untuk JSON yang valid', 'warning');
  }
}

async function saveEditingFile() {
  if (!fmEditingFilePath) return;
  const textarea = document.getElementById('fmEditorTextarea');
  const saveBtn = document.getElementById('fmEditorSaveBtn');

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';

  try {
    const res = await authFetch(`${API}/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fmEditingFilePath, content: textarea.value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast(data.message, 'success');
    loadFileManager(fmCurrentDir);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Simpan (Ctrl+S)';
  }
}

function closeFileEditor() {
  document.getElementById('fmEditorCard').style.display = 'none';
  fmEditingFilePath = null;
}

function renameFmItem(oldPath, oldName) {
  const html = `
    <div class="form-group">
      <label>Nama Baru:</label>
      <input type="text" id="modalRenameInput" value="${escHtml(oldName)}" class="form-select" style="width:100%;" />
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" id="modalRenameConfirmBtn"><i class="fas fa-check"></i> Simpan Nama</button>
    </div>`;
  showModal('Rename', html);
  setTimeout(() => {
    document.getElementById('modalRenameConfirmBtn')?.addEventListener('click', async () => {
      const newName = document.getElementById('modalRenameInput').value.trim();
      if (!newName || newName === oldName) return closeModal();
      try {
        const res = await authFetch(`${API}/files/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath, newName })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        closeModal();
        toast(data.message, 'success');
        loadFileManager(fmCurrentDir);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }, 50);
}

function deleteFmItem(targetPath, name, isDir) {
  showConfirmModal('Konfirmasi Hapus', `<p>Yakin ingin menghapus ${isDir ? 'folder' : 'file'} <strong>${escHtml(name)}</strong>?<br><small style="color:var(--text3);">${escHtml(targetPath)}</small></p>`, async () => {
    try {
      const res = await authFetch(`${API}/files/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      closeModal();
      toast(data.message, 'success');
      loadFileManager(fmCurrentDir);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function openSqliteFromFm(dbPath) {
  navigateTo('sqlite');
  selectSqliteDb(dbPath);
}

// ============================================================================
// SQLITE MANAGER MODULE
// ============================================================================
let sqliteCurrentDb = null;
let sqliteCurrentTable = null;
let sqliteCurrentPage = 1;
let sqliteCurrentSort = null;
let sqliteCurrentOrder = 'ASC';
let sqliteTableColumns = [];

function setupSqliteManager() {
  document.getElementById('sqliteScanBtn')?.addEventListener('click', scanSqliteDatabases);
  document.getElementById('sqliteDbSelect')?.addEventListener('change', (e) => {
    if (e.target.value) selectSqliteDb(e.target.value);
  });
  document.getElementById('sqliteOpenCustomBtn')?.addEventListener('click', () => {
    const custom = document.getElementById('sqliteCustomPathInput').value.trim();
    if (!custom) return toast('Masukkan path file database!', 'warning');
    selectSqliteDb(custom);
  });

  // Tab switching
  document.querySelectorAll('.sqlite-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.sqlite-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sqlite-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`sqlite-tab-${tabName}`)?.classList.add('active');
    });
  });

  // Table Data toolbar
  document.getElementById('sqliteRefreshDataBtn')?.addEventListener('click', () => {
    if (sqliteCurrentTable) loadSqliteTableData(sqliteCurrentTable, sqliteCurrentPage);
  });
  document.getElementById('sqliteSearchDataInput')?.addEventListener('input', (e) => {
    if (sqliteCurrentTable) loadSqliteTableData(sqliteCurrentTable, 1, e.target.value);
  });
  document.getElementById('sqliteInsertRowBtn')?.addEventListener('click', openInsertRowModal);

  // SQL Query execution
  document.getElementById('sqliteRunQueryBtn')?.addEventListener('click', runSqliteQuery);
  document.getElementById('sqliteClearQueryBtn')?.addEventListener('click', () => {
    document.getElementById('sqliteQueryInput').value = '';
    document.getElementById('sqliteQueryInfo').textContent = '';
  });
  document.getElementById('sqliteQueryInput')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runSqliteQuery();
    }
  });
}

async function scanSqliteDatabases() {
  const select = document.getElementById('sqliteDbSelect');
  select.innerHTML = '<option value="">Scanning databases...</option>';
  try {
    const res = await authFetch(`${API}/sqlite/find?dir=/data`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    let html = '<option value="">-- Pilih Database (' + (data.databases ? data.databases.length : 0) + ' ditemukan) --</option>';
    for (const db of (data.databases || [])) {
      html += `<option value="${escHtml(db.path)}">${escHtml(db.name)} (${escHtml(db.path)})</option>`;
    }
    select.innerHTML = html;
    if (data.databases && data.databases.length > 0 && !sqliteCurrentDb) {
      select.value = data.databases[0].path;
      selectSqliteDb(data.databases[0].path);
    }
  } catch (e) {
    select.innerHTML = '<option value="">Gagal scan database</option>';
    toast(e.message, 'error');
  }
}

async function selectSqliteDb(dbPath) {
  sqliteCurrentDb = dbPath;
  sqliteCurrentTable = null;
  document.getElementById('sqliteCustomPathInput').value = dbPath;
  document.getElementById('sqliteActiveTableLabel').textContent = `DB: ${dbPath.split('/').pop()}`;

  const tableListEl = document.getElementById('sqliteTableList');
  tableListEl.innerHTML = '<div class="empty-state" style="padding:15px 0;"><i class="fas fa-spinner fa-spin"></i><p>Memuat tabel...</p></div>';

  try {
    const res = await authFetch(`${API}/sqlite/tables?db=${encodeURIComponent(dbPath)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('sqliteTableCount').textContent = data.tables ? data.tables.length : 0;
    if (!data.tables || data.tables.length === 0) {
      tableListEl.innerHTML = '<div class="empty-state" style="padding:15px 0;"><p style="color:var(--text3);">Tidak ada tabel</p></div>';
      return;
    }

    let html = '';
    for (const t of data.tables) {
      const isView = t.type === 'view';
      html += `
        <div class="sqlite-table-item" onclick="selectTable('${escHtml(t.name)}', this)">
          <div class="t-name"><i class="fas ${isView ? 'fa-eye' : 'fa-table'}"></i> <span>${escHtml(t.name)}</span></div>
          <span class="t-count">${t.rowCount} rows</span>
        </div>`;
    }
    tableListEl.innerHTML = html;

    // Auto-select first table
    if (data.tables.length > 0) {
      const firstEl = tableListEl.querySelector('.sqlite-table-item');
      if (firstEl) selectTable(data.tables[0].name, firstEl);
    }
  } catch (e) {
    tableListEl.innerHTML = `<div class="empty-state" style="padding:15px 0;"><p style="color:var(--danger);">${escHtml(e.message)}</p></div>`;
    toast(e.message, 'error');
  }
}

function selectTable(tableName, el) {
  sqliteCurrentTable = tableName;
  sqliteCurrentPage = 1;
  sqliteCurrentSort = null;

  document.querySelectorAll('.sqlite-table-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');

  document.getElementById('sqliteActiveTableLabel').textContent = `${sqliteCurrentDb.split('/').pop()} ➔ ${tableName}`;

  // Pre-fill SQL Query tab with default query
  document.getElementById('sqliteQueryInput').value = `SELECT * FROM "${tableName}" LIMIT 50;`;

  loadSqliteTableData(tableName, 1);
  loadSqliteSchema(tableName);
}

async function loadSqliteTableData(tableName, page = 1, search = '') {
  if (!sqliteCurrentDb || !tableName) return;
  sqliteCurrentPage = page;
  const grid = document.getElementById('sqliteDataGrid');
  const pag = document.getElementById('sqlitePagination');

  grid.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Memuat data...</p></div>';

  let url = `${API}/sqlite/data?db=${encodeURIComponent(sqliteCurrentDb)}&table=${encodeURIComponent(tableName)}&page=${page}&limit=50`;
  if (sqliteCurrentSort) {
    url += `&sort=${encodeURIComponent(sqliteCurrentSort)}&order=${sqliteCurrentOrder}`;
  }
  if (search) {
    url += `&search=${encodeURIComponent(search)}`;
  }

  try {
    const res = await authFetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    sqliteTableColumns = data.columns || [];
    const rows = data.rows || [];

    if (rows.length === 0) {
      grid.innerHTML = '<div class="empty-state"><i class="fas fa-table"></i><p>Tabel kosong atau tidak ada data yang cocok</p></div>';
      pag.innerHTML = '';
      return;
    }

    // Build table
    let html = `<table class="sqlite-grid-table"><thead><tr><th style="width:70px;text-align:center;">Aksi</th>`;
    for (const col of sqliteTableColumns) {
      const isSorted = sqliteCurrentSort === col.name;
      const sortIcon = isSorted ? (sqliteCurrentOrder === 'ASC' ? ' <i class="fas fa-sort-up"></i>' : ' <i class="fas fa-sort-down"></i>') : '';
      html += `<th onclick="sortTableBy('${escHtml(col.name)}')">${escHtml(col.name)} <small style="color:var(--text3);font-weight:normal;">(${escHtml(col.type || 'ANY')})</small>${sortIcon}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const row of rows) {
      const rowid = row._rowid_ !== undefined ? row._rowid_ : null;
      const rowJsonSafe = escHtml(JSON.stringify(row));
      html += `<tr><td style="text-align:center;">
        <div style="display:flex;gap:4px;justify-content:center;">
          <button class="btn btn-xs btn-secondary" onclick='openEditRowModal(${rowJsonSafe}, ${rowid})' title="Edit Baris"><i class="fas fa-edit"></i></button>
          <button class="btn btn-xs btn-danger" onclick='deleteSqliteRow(${rowid}, ${rowJsonSafe})' title="Hapus Baris"><i class="fas fa-trash"></i></button>
        </div>
      </td>`;

      for (const col of sqliteTableColumns) {
        const val = row[col.name];
        if (val === null || val === undefined) {
          html += `<td class="null-val">NULL</td>`;
        } else {
          html += `<td title="${escHtml(String(val))}">${escHtml(String(val))}</td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    grid.innerHTML = html;

    // Pagination
    let pagHtml = `<span>Total: <strong>${data.total}</strong> baris | Hal ${data.page} dari ${data.totalPages || 1}</span><div style="display:flex;gap:6px;">`;
    if (data.page > 1) {
      pagHtml += `<button class="btn btn-xs btn-secondary" onclick="loadSqliteTableData('${escHtml(tableName)}', ${data.page - 1})"><i class="fas fa-chevron-left"></i> Prev</button>`;
    }
    if (data.page < data.totalPages) {
      pagHtml += `<button class="btn btn-xs btn-secondary" onclick="loadSqliteTableData('${escHtml(tableName)}', ${data.page + 1})">Next <i class="fas fa-chevron-right"></i></button>`;
    }
    pagHtml += `</div>`;
    pag.innerHTML = pagHtml;
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><p style="color:var(--danger);">${escHtml(e.message)}</p></div>`;
    pag.innerHTML = '';
  }
}

function sortTableBy(colName) {
  if (sqliteCurrentSort === colName) {
    sqliteCurrentOrder = sqliteCurrentOrder === 'ASC' ? 'DESC' : 'ASC';
  } else {
    sqliteCurrentSort = colName;
    sqliteCurrentOrder = 'ASC';
  }
  loadSqliteTableData(sqliteCurrentTable, 1);
}

function openInsertRowModal() {
  if (!sqliteCurrentDb || !sqliteCurrentTable || sqliteTableColumns.length === 0) return;

  let fieldsHtml = '';
  for (const col of sqliteTableColumns) {
    const isPk = col.pk > 0;
    fieldsHtml += `
      <div class="form-group" style="margin-bottom:12px;">
        <label>${escHtml(col.name)} <small style="color:var(--text3);">(${escHtml(col.type || 'TEXT')}${isPk ? ' - PRIMARY KEY' : ''})</small></label>
        <input type="text" id="insert_col_${escHtml(col.name)}" placeholder="${isPk ? '(Auto/Optional)' : 'value'}" class="form-select" style="width:100%;" />
      </div>`;
  }

  const modalHtml = `
    <form id="sqliteInsertForm" style="max-height:400px;overflow-y:auto;padding-right:8px;">
      ${fieldsHtml}
    </form>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn btn-success" id="confirmInsertRowBtn"><i class="fas fa-plus"></i> Simpan Baris</button>
    </div>`;

  showModal(`Tambah Baris ke: ${sqliteCurrentTable}`, modalHtml);
  setTimeout(() => {
    document.getElementById('confirmInsertRowBtn')?.addEventListener('click', async () => {
      const row = {};
      for (const col of sqliteTableColumns) {
        const val = document.getElementById(`insert_col_${col.name}`).value;
        if (val !== '') {
          row[col.name] = val;
        }
      }
      try {
        const res = await authFetch(`${API}/sqlite/row-insert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ db: sqliteCurrentDb, table: sqliteCurrentTable, row })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        closeModal();
        toast(data.message, 'success');
        loadSqliteTableData(sqliteCurrentTable, sqliteCurrentPage);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }, 50);
}

function openEditRowModal(row, rowid) {
  if (!sqliteCurrentDb || !sqliteCurrentTable || sqliteTableColumns.length === 0) return;

  let fieldsHtml = '';
  for (const col of sqliteTableColumns) {
    const val = row[col.name] !== undefined && row[col.name] !== null ? row[col.name] : '';
    fieldsHtml += `
      <div class="form-group" style="margin-bottom:12px;">
        <label>${escHtml(col.name)} <small style="color:var(--text3);">(${escHtml(col.type || 'TEXT')})</small></label>
        <input type="text" id="edit_col_${escHtml(col.name)}" value="${escHtml(String(val))}" class="form-select" style="width:100%;" />
      </div>`;
  }

  const modalHtml = `
    <form id="sqliteEditForm" style="max-height:400px;overflow-y:auto;padding-right:8px;">
      ${fieldsHtml}
    </form>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
      <button class="btn btn-primary" id="confirmEditRowBtn"><i class="fas fa-save"></i> Update Baris</button>
    </div>`;

  showModal(`Edit Baris: ${sqliteCurrentTable}`, modalHtml);
  setTimeout(() => {
    document.getElementById('confirmEditRowBtn')?.addEventListener('click', async () => {
      const data = {};
      for (const col of sqliteTableColumns) {
        data[col.name] = document.getElementById(`edit_col_${col.name}`).value;
      }

      // Find primary key column if rowid is missing
      const pkCol = sqliteTableColumns.find(c => c.pk > 0);

      try {
        const res = await authFetch(`${API}/sqlite/row-update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            db: sqliteCurrentDb,
            table: sqliteCurrentTable,
            rowid: rowid,
            pkColumn: pkCol ? pkCol.name : undefined,
            pkValue: pkCol ? row[pkCol.name] : undefined,
            data
          })
        });
        const respData = await res.json();
        if (!res.ok) throw new Error(respData.error);
        closeModal();
        toast(respData.message, 'success');
        loadSqliteTableData(sqliteCurrentTable, sqliteCurrentPage);
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }, 50);
}

function deleteSqliteRow(rowid, row) {
  const pkCol = sqliteTableColumns.find(c => c.pk > 0);
  showConfirmModal('Hapus Baris', `<p>Yakin ingin menghapus baris ini dari tabel <strong>${escHtml(sqliteCurrentTable)}</strong>?</p>`, async () => {
    try {
      const res = await authFetch(`${API}/sqlite/row-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db: sqliteCurrentDb,
          table: sqliteCurrentTable,
          rowid: rowid,
          pkColumn: pkCol ? pkCol.name : undefined,
          pkValue: pkCol ? row[pkCol.name] : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      closeModal();
      toast(data.message, 'success');
      loadSqliteTableData(sqliteCurrentTable, sqliteCurrentPage);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

async function runSqliteQuery() {
  if (!sqliteCurrentDb) return toast('Pilih database terlebih dahulu!', 'warning');
  const query = document.getElementById('sqliteQueryInput').value.trim();
  if (!query) return toast('Ketik query SQL yang ingin dijalankan!', 'warning');

  const btn = document.getElementById('sqliteRunQueryBtn');
  const info = document.getElementById('sqliteQueryInfo');
  const resultGrid = document.getElementById('sqliteQueryResultGrid');

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running...';
  info.textContent = '';
  resultGrid.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Menjalankan query...</p></div>';

  try {
    const res = await authFetch(`${API}/sqlite/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db: sqliteCurrentDb, query })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    info.textContent = `Selesai dalam ${data.execTimeMs} ms`;

    if (data.isSelect) {
      const cols = data.columns || [];
      const rows = data.rows || [];
      info.textContent += ` | ${rows.length} baris dikembalikan`;

      if (rows.length === 0) {
        resultGrid.innerHTML = '<div class="empty-state"><p style="color:var(--text3);">Query berhasil, 0 baris dikembalikan.</p></div>';
        return;
      }

      let html = `<table class="sqlite-grid-table"><thead><tr>`;
      for (const col of cols) {
        html += `<th>${escHtml(col)}</th>`;
      }
      html += `</tr></thead><tbody>`;

      for (const row of rows) {
        html += `<tr>`;
        for (const col of cols) {
          const val = row[col];
          if (val === null || val === undefined) {
            html += `<td class="null-val">NULL</td>`;
          } else {
            html += `<td title="${escHtml(String(val))}">${escHtml(String(val))}</td>`;
          }
        }
        html += `</tr>`;
      }
      html += `</tbody></table>`;
      resultGrid.innerHTML = html;
    } else {
      resultGrid.innerHTML = `<div class="empty-state"><i class="fas fa-check-circle" style="color:var(--success);font-size:2rem;margin-bottom:8px;"></i><p>${escHtml(data.message)}</p></div>`;
      // Refresh table list in case DDL (CREATE/DROP) was run
      selectSqliteDb(sqliteCurrentDb);
    }
  } catch (e) {
    info.textContent = 'Error';
    resultGrid.innerHTML = `<div class="empty-state"><i class="fas fa-circle-xmark" style="color:var(--danger);font-size:2rem;margin-bottom:8px;"></i><p style="color:var(--danger);">${escHtml(e.message)}</p></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-play"></i> Run Query (Ctrl+Enter)';
  }
}

async function loadSqliteSchema(tableName) {
  if (!sqliteCurrentDb || !tableName) return;
  const wrap = document.getElementById('sqliteSchemaWrap');
  wrap.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Memuat skema...</p></div>';

  try {
    const res = await authFetch(`${API}/sqlite/schema?db=${encodeURIComponent(sqliteCurrentDb)}&table=${encodeURIComponent(tableName)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    let html = `
      <div style="margin-bottom:20px;">
        <h4 style="margin-bottom:8px;color:var(--text);font-size:0.95rem;"><i class="fas fa-columns"></i> Kolom</h4>
        <table class="process-table">
          <thead>
            <tr>
              <th>CID</th>
              <th>Nama Kolom</th>
              <th>Tipe Data</th>
              <th>Not Null</th>
              <th>Default Value</th>
              <th>Primary Key</th>
            </tr>
          </thead>
          <tbody>`;

    for (const c of (data.columns || [])) {
      html += `
        <tr>
          <td><small style="color:var(--text3);">${c.cid}</small></td>
          <td><strong>${escHtml(c.name)}</strong></td>
          <td><span class="badge" style="background:var(--bg3);">${escHtml(c.type || 'ANY')}</span></td>
          <td>${c.notnull ? '<span style="color:var(--danger);font-weight:600;">YES</span>' : '<span style="color:var(--text3);">NO</span>'}</td>
          <td><small style="color:var(--text2);">${c.dflt_value !== null ? escHtml(String(c.dflt_value)) : 'NULL'}</small></td>
          <td>${c.pk ? '<span class="badge" style="background:var(--primary);">PK (' + c.pk + ')</span>' : '-'}</td>
        </tr>`;
    }
    html += `</tbody></table></div>`;

    if (data.createSql) {
      html += `
        <div style="margin-top:20px;">
          <h4 style="margin-bottom:8px;color:var(--text);font-size:0.95rem;"><i class="fas fa-code"></i> CREATE Statement</h4>
          <pre style="background:#0a0d14;padding:14px;border-radius:8px;border:1px solid var(--border);color:#a5f3fc;font-family:'JetBrains Mono',monospace;font-size:0.85rem;overflow-x:auto;">${escHtml(data.createSql)}</pre>
        </div>`;
    }

    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p style="color:var(--danger);">${escHtml(e.message)}</p></div>`;
  }
}
