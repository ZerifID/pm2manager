const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');

// Setup multer for upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const targetDir = req.query.dir || req.body.dir || '/data';
    const safeDir = path.resolve(targetDir);
    if (!fs.existsSync(safeDir)) {
      fs.mkdirSync(safeDir, { recursive: true });
    }
    cb(null, safeDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

// Helper to check if file is text/binary
function isTextFile(filename) {
  const textExts = [
    '.txt', '.js', '.json', '.html', '.css', '.env', '.md', '.py', '.sh', '.bash',
    '.yml', '.yaml', '.xml', '.ts', '.jsx', '.tsx', '.conf', '.cfg', '.ini', '.sql',
    '.log', '.htaccess', '.service', '.toml', '.csv', '.lock', '.gitignore', '.vue',
    '.svelte', '.php', '.c', '.cpp', '.h', '.java', '.go', '.rs', '.rb'
  ];
  const ext = path.extname(filename).toLowerCase();
  if (textExts.includes(ext)) return true;
  if (!ext) return true; // extensionless like Dockerfile, .env, etc.
  return false;
}

function isZipFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.zip' || ext === '.tar' || ext === '.gz' || ext === '.tgz';
}

// GET /api/files/list?dir=/data
router.get('/list', (req, res) => {
  try {
    const reqDir = req.query.dir || '/data';
    const currentPath = path.resolve(reqDir);

    if (!fs.existsSync(currentPath)) {
      return res.status(404).json({ error: `Directory not found: ${currentPath}` });
    }

    const stat = fs.statSync(currentPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${currentPath}` });
    }

    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      try {
        const itemStat = fs.statSync(fullPath);
        const isDir = entry.isDirectory();
        const ext = path.extname(entry.name).toLowerCase();

        items.push({
          name: entry.name,
          path: fullPath,
          isDirectory: isDir,
          isSymbolicLink: entry.isSymbolicLink(),
          size: itemStat.size,
          modified: itemStat.mtime,
          isText: !isDir && isTextFile(entry.name),
          isDb: !isDir && (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3'),
          isZip: !isDir && isZipFile(entry.name)
        });
      } catch (e) {
        items.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: 0,
          modified: new Date(),
          error: e.message
        });
      }
    }

    // Sort: directories first, then alphabetically
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    res.json({
      success: true,
      currentPath,
      parentPath: path.dirname(currentPath),
      items
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/files/read?path=/data/app.js
router.get('/read', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Path is required' });
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is a directory' });
    }

    // Limit to 10MB for text editing
    if (stat.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large to edit in browser (> 10MB)' });
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    res.json({ success: true, path: resolvedPath, content, size: stat.size });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/files/write
router.post('/write', (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Path is required' });
    const resolvedPath = path.resolve(filePath);

    fs.writeFileSync(resolvedPath, content ?? '', 'utf8');
    res.json({ success: true, message: 'File berhasil disimpan!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/files/create
router.post('/create', (req, res) => {
  try {
    const { dir, name, type } = req.body; // type: 'file' | 'folder'
    if (!dir || !name) return res.status(400).json({ error: 'Directory & Name are required' });
    const targetPath = path.join(path.resolve(dir), name);

    if (fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'File/folder sudah ada!' });
    }

    if (type === 'folder') {
      fs.mkdirSync(targetPath, { recursive: true });
    } else {
      fs.writeFileSync(targetPath, '', 'utf8');
    }

    res.json({ success: true, message: `${type === 'folder' ? 'Folder' : 'File'} "${name}" berhasil dibuat!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/files/rename
router.post('/rename', (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) return res.status(400).json({ error: 'Old path & New name are required' });
    const resolvedOld = path.resolve(oldPath);
    const resolvedNew = path.join(path.dirname(resolvedOld), newName);

    if (!fs.existsSync(resolvedOld)) {
      return res.status(404).json({ error: 'File/folder asal tidak ditemukan' });
    }
    if (fs.existsSync(resolvedNew)) {
      return res.status(400).json({ error: 'Nama tujuan sudah ada!' });
    }

    fs.renameSync(resolvedOld, resolvedNew);
    res.json({ success: true, message: 'Berhasil di-rename!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/files/delete
router.post('/delete', (req, res) => {
  try {
    const { paths } = req.body; // can accept multiple paths
    const targetPaths = Array.isArray(paths) ? paths : (req.body.path ? [req.body.path] : []);
    if (targetPaths.length === 0) return res.status(400).json({ error: 'Path(s) are required' });

    for (const targetPath of targetPaths) {
      const resolvedPath = path.resolve(targetPath);
      if (fs.existsSync(resolvedPath)) {
        const stat = fs.statSync(resolvedPath);
        if (stat.isDirectory()) {
          fs.rmSync(resolvedPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(resolvedPath);
        }
      }
    }

    res.json({ success: true, message: `${targetPaths.length} item berhasil dihapus!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/files/zip (archive multiple files/folders into a zip)
router.post('/zip', (req, res) => {
  const { currentDir, items, zipName } = req.body;
  if (!currentDir || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'currentDir dan items (array) wajib dikirim' });
  }

  const resolvedDir = path.resolve(currentDir);
  if (!fs.existsSync(resolvedDir)) {
    return res.status(404).json({ error: 'Direktori tidak ditemukan' });
  }

  const finalZipName = zipName && zipName.trim() ? (zipName.endsWith('.zip') ? zipName.trim() : `${zipName.trim()}.zip`) : `archive-${Date.now()}.zip`;
  const zipPath = path.join(resolvedDir, finalZipName);

  // Quote item names for zip command
  const quotedItems = items.map(name => `"${name.replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `zip -r "${finalZipName.replace(/"/g, '\\"')}" ${quotedItems}`;

  exec(cmd, { cwd: resolvedDir, timeout: 60000 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: `Gagal membuat zip: ${stderr || error.message}` });
    }
    res.json({ success: true, message: `Berhasil membuat archive "${finalZipName}"!`, zipName: finalZipName });
  });
});

// POST /api/files/unzip (extract zip/tar archive)
router.post('/unzip', (req, res) => {
  const { archivePath, targetDir } = req.body;
  if (!archivePath) {
    return res.status(400).json({ error: 'archivePath wajib dikirim' });
  }

  const resolvedArchive = path.resolve(archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    return res.status(404).json({ error: 'File archive tidak ditemukan' });
  }

  const destDir = targetDir ? path.resolve(targetDir) : path.dirname(resolvedArchive);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const ext = path.extname(resolvedArchive).toLowerCase();
  let cmd = '';

  if (ext === '.zip') {
    cmd = `unzip -o "${resolvedArchive.replace(/"/g, '\\"')}" -d "${destDir.replace(/"/g, '\\"')}"`;
  } else if (ext === '.tar' || ext === '.gz' || ext === '.tgz') {
    cmd = `tar -xf "${resolvedArchive.replace(/"/g, '\\"')}" -C "${destDir.replace(/"/g, '\\"')}"`;
  } else {
    return res.status(400).json({ error: 'Format archive tidak didukung (hanya .zip, .tar, .gz, .tgz)' });
  }

  exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: `Gagal extract archive: ${stderr || error.message}` });
    }
    res.json({ success: true, message: `Archive berhasil di-extract ke "${destDir}"!` });
  });
});

// POST /api/files/upload
router.post('/upload', upload.array('files'), (req, res) => {
  try {
    res.json({
      success: true,
      message: `${req.files ? req.files.length : 0} file berhasil diupload!`,
      files: (req.files || []).map(f => f.originalname)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/files/download?path=/data/...
router.get('/download', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('Path is required');
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).send('File not found');
    }
    res.download(resolvedPath);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
