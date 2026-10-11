
// ============================================================================
// FILE MANAGER MODULE
// ============================================================================
let fmCurrentDir = '/data';
let fmFilesData = [];
let fmEditingFilePath = null;

function setupFileManager() {
  document.getElementById('fmRefreshBtn')?.addEventListener('click', () => loadFileManager(fmCurrentDir));
  document.getElementById('fmUpBtn')?.addEventListener('click', () => {
    const parts = fmCurrentDir.split('/').filter(Boolean);
    parts.pop();
    const parentDir = '/' + parts.join('/');
    loadFileManager(parentDir || '/');
  });

  // Search/Filter
  document.getElementById('fmSearchInput')?.addEventListener('input', (e) => {
    renderFileManager(e.target.value.toLowerCase().trim());
  });

  // New File / Folder
  document.getElementById('fmNewFileBtn')?.addEventListener('click', () => {
    const html = `
      <div class="form-group">
        <label>Nama File (misal: app.js, config.json):</label>
        <input type="text" id="modalNewFileName" placeholder="nama_file.txt" class="form-select" style="width:100%;" />
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="modalCreateFileConfirmBtn"><i class="fas fa-check"></i> Buat</button>
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
        <label>Nama Folder:</label>
        <input type="text" id="modalNewFolderName" placeholder="nama_folder" class="form-select" style="width:100%;" />
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
        <button class="btn btn-success" id="modalCreateFolderConfirmBtn"><i class="fas fa-check"></i> Buat Folder</button>
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

  // Upload
  const fileInput = document.getElementById('fmFileInput');
  document.getElementById('fmUploadTriggerBtn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    const formData = new FormData();
    for (let i = 0; i < fileInput.files.length; i++) {
      formData.append('files', fileInput.files[i]);
    }
    try {
      toast('Mengupload file...', 'info');
      const res = await fetch(`${API}/files/upload?dir=${encodeURIComponent(fmCurrentDir)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast(data.message, 'success');
      fileInput.value = '';
      loadFileManager(fmCurrentDir);
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  // Editor controls
  document.getElementById('fmEditorSaveBtn')?.addEventListener('click', saveEditingFile);
  document.getElementById('fmEditorCloseBtn')?.addEventListener('click', closeFileEditor);

  // Keyboard shortcut Ctrl+S inside editor
  document.getElementById('fmEditorTextarea')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveEditingFile();
    }
  });
}

async function loadFileManager(dir = '/data') {
  const wrap = document.getElementById('fmListWrap');
  wrap.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Memuat files...</p></div>';

  try {
    const res = await authFetch(`${API}/files/list?dir=${encodeURIComponent(dir)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    fmCurrentDir = data.currentPath;
    fmFilesData = data.items || [];
    renderBreadcrumbs(fmCurrentDir);
    renderFileManager();
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><i class="fas fa-triangle-exclamation" style="color:var(--danger)"></i><p>${escHtml(err.message)}</p></div>`;
  }
}

function renderBreadcrumbs(dir) {
  const container = document.getElementById('fmBreadcrumbs');
  if (!container) return;

  const parts = dir.split('/').filter(Boolean);
  let html = `<span class="crumb" onclick="loadFileManager('/')"><i class="fas fa-hdd"></i> root</span>`;
  let currentAccum = '';

  for (let i = 0; i < parts.length; i++) {
    currentAccum += '/' + parts[i];
    const pathTarget = currentAccum;
    html += `<span class="sep">/</span><span class="crumb" onclick="loadFileManager('${escHtml(pathTarget)}')">${escHtml(parts[i])}</span>`;
  }
  container.innerHTML = html;
}

function renderFileManager(filter = '') {
  const wrap = document.getElementById('fmListWrap');
  const items = fmFilesData.filter(f => !filter || f.name.toLowerCase().includes(filter));

  if (items.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>${filter ? 'Tidak ada file yang cocok dengan pencarian' : 'Folder ini kosong'}</p></div>`;
    return;
  }

  let html = `
    <table class="process-table fm-table">
      <thead>
        <tr>
          <th>Nama</th>
          <th style="width:110px;">Ukuran</th>
          <th style="width:160px;">Modified</th>
          <th style="width:200px;text-align:right;">Aksi</th>
        </tr>
      </thead>
      <tbody>`;

  for (const item of items) {
    let icon = 'fa-file-alt';
    if (item.isDirectory) icon = 'fa-folder';
    else if (item.isDb) icon = 'fa-database';
    else if (item.isText) icon = 'fa-file-code';

    const safePath = escHtml(item.path);
    const safeName = escHtml(item.name);
    const dateStr = new Date(item.modified).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });

    html += `
      <tr>
        <td>
          <div class="fm-item-name" onclick="${item.isDirectory ? `loadFileManager('${safePath}')` : (item.isDb ? `openSqliteFromFm('${safePath}')` : `openFileEditor('${safePath}')`)}">
            <i class="fas ${icon}"></i>
            <span>${safeName}</span>
          </div>
        </td>
        <td><small style="color:var(--text2);">${item.isDirectory ? '-' : formatBytes(item.size)}</small></td>
        <td><small style="color:var(--text3);">${dateStr}</small></td>
        <td>
          <div class="fm-actions">
            ${item.isDb ? `<button class="btn btn-xs btn-primary" onclick="openSqliteFromFm('${safePath}')" title="Buka di SQLite Manager"><i class="fas fa-database"></i> SQLite</button>` : ''}
            ${(!item.isDirectory && item.isText) ? `<button class="btn btn-xs btn-primary" onclick="openFileEditor('${safePath}')" title="Edit Text"><i class="fas fa-edit"></i> Edit</button>` : ''}
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

async function openFileEditor(filePath) {
  try {
    toast('Membaca file...', 'info');
    const res = await authFetch(`${API}/files/read?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    fmEditingFilePath = data.path;
    const card = document.getElementById('fmEditorCard');
    const title = document.getElementById('fmEditorTitle');
    const badge = document.getElementById('fmEditorPathBadge');
    const textarea = document.getElementById('fmEditorTextarea');

    title.innerHTML = `<i class="fas fa-file-code"></i> Edit File: ${escHtml(filePath.split('/').pop())}`;
    badge.textContent = filePath;
    textarea.value = data.content;

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    toast(e.message, 'error');
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
    saveBtn.innerHTML = '<i class="fas fa-save"></i> Simpan (Ctrl+S)';
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
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
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
