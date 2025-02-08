const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

const config = require('./config/config');
const iconGenerator = require('./services/iconGenerator');
const manifestProcessor = require('./services/manifestProcessor');
const { cleanupOldFiles } = require('./utils/cleanup');

const execPromise = util.promisify(exec);
const app = express();
app.use(express.json());

/* ─────────────────────────────────────────────────────────────────────────────
   SQLITE DATABASE INITIALIZATION
──────────────────────────────────────────────────────────────────────────────── */

// Path to the SQLite file
const dbPath = path.join(__dirname, '..', 'jobs.sqlite');
// Open (or create) the database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening SQLite database:", err);
  } else {
    console.log("Connected to SQLite database");
    // Create the jobs table if it doesn't exist (includes an 'updated' field)
    db.run(`CREATE TABLE IF NOT EXISTS jobs (
      jobId TEXT PRIMARY KEY,
      status TEXT,
      created INTEGER,
      updated INTEGER,
      files TEXT,
      error TEXT
    )`, (err) => {
      if (err) {
        console.error("Error creating jobs table:", err);
      }
    });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   IN-MEMORY JOB STORE & QUEUE
──────────────────────────────────────────────────────────────────────────────── */

// In-memory job store (jobId -> { status, created, updated, files, error })
const jobs = {};

// In-memory queue for conversion jobs
const jobQueue = [];
let isProcessing = false;

// Helper: Insert a new job into the SQLite DB
function insertJob(jobId, status, created) {
  db.run("INSERT INTO jobs (jobId, status, created, updated) VALUES (?, ?, ?, ?)",
    [jobId, status, created, created],
    (err) => {
      if (err) console.error("Error inserting job:", err);
    }
  );
}

// Helper: Update a job in the SQLite DB (updates the 'updated' field automatically)
function updateJob(jobId, status, files, error) {
  const updated = Date.now();
  db.run(
    "UPDATE jobs SET status = ?, files = ?, error = ?, updated = ? WHERE jobId = ?",
    [status, files ? JSON.stringify(files) : null, error, updated, jobId],
    (err) => {
      if (err) console.error("Error updating job:", err);
    }
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   JOB PROCESSING FUNCTIONS
──────────────────────────────────────────────────────────────────────────────── */

async function processConversionJob(job) {
  const timestamp = Date.now();
  const urlHash = Buffer.from(job.url).toString('base64').replace(/[\/\+]/g, '_');

  console.log(`Job ${job.jobId}: Creating temp folder...`);
  const tempFolder = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder, { recursive: true });
  }
  const projectDir = path.join(tempFolder, `pwa_${timestamp}_${urlHash}`);
  await cleanupOldFiles(projectDir);

  console.log(`Job ${job.jobId}: Generating icons...`);
  const icons = await iconGenerator.generateIcons(job.iconPath, projectDir);

  console.log(`Job ${job.jobId}: Processing manifest...`);
  const manifest = await manifestProcessor.processManifest(job.manifestUrl, icons);
  const manifestPath = path.join(projectDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Job ${job.jobId}: Running bubblewrap init...`);
  await execPromise(`bubblewrap init --manifest ${manifestPath} --directory ${projectDir} --yes`);
  
  console.log(`Job ${job.jobId}: Running bubblewrap build...`);
  await execPromise(`bubblewrap build`, { cwd: projectDir });
  
  console.log(`Job ${job.jobId}: Running bubblewrap build for AAB...`);
  await execPromise(`bubblewrap build --android-app-bundle`, { cwd: projectDir });

  console.log(`Job ${job.jobId}: Moving output files...`);
  const outputDir = path.join(__dirname, '..', config.outputDir);
  const apkPath = path.join(projectDir, 'app-release-signed.apk');
  const aabPath = path.join(projectDir, 'app-release-bundle.aab');
  const outputApkPath = path.join(outputDir, `${urlHash}_${timestamp}.apk`);
  const outputAabPath = path.join(outputDir, `${urlHash}_${timestamp}.aab`);

  fs.copyFileSync(apkPath, outputApkPath);
  fs.copyFileSync(aabPath, outputAabPath);

  console.log(`Job ${job.jobId}: Cleaning up temporary files...`);
  await cleanupOldFiles(projectDir);
  fs.unlinkSync(job.iconPath);

  console.log(`Job ${job.jobId}: Finished processing.`);
  return {
    apk: path.basename(outputApkPath),
    aab: path.basename(outputAabPath)
  };
}


// Worker: Process queued jobs sequentially
async function processQueue() {
  if (isProcessing || jobQueue.length === 0) return;
  isProcessing = true;

  const job = jobQueue.shift();
  try {
    const files = await processConversionJob(job);
    // Update in-memory job status and timestamp
    jobs[job.jobId].status = 'completed';
    jobs[job.jobId].files = files;
    jobs[job.jobId].updated = Date.now();
    // Update the SQLite DB row
    updateJob(job.jobId, 'completed', files, null);
  } catch (error) {
    console.error(`Error processing job ${job.jobId}:`, error);
    jobs[job.jobId].status = 'failed';
    jobs[job.jobId].error = error.message;
    jobs[job.jobId].updated = Date.now();
    updateJob(job.jobId, 'failed', null, error.message);
  }
  isProcessing = false;
  processQueue();
}

/* ─────────────────────────────────────────────────────────────────────────────
   MULTER & DIRECTORIES SETUP
──────────────────────────────────────────────────────────────────────────────── */

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', config.uploadDir);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `icon-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(config.maxFileSize)
  }
});
// Ensure directories exist for uploads and output
[config.outputDir, config.uploadDir].forEach(dir => {
  const fullPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   API ENDPOINTS
──────────────────────────────────────────────────────────────────────────────── */

// POST /convert
// Accepts form-data with fields: url (text), manifestUrl (text), icon (file)
app.post('/convert', upload.single('icon'), async (req, res) => {
  try {
    const { url, manifestUrl } = req.body;
    const missingParams = [];
    if (!url) missingParams.push({ field: "url", expectedType: "string" });
    if (!manifestUrl) missingParams.push({ field: "manifestUrl", expectedType: "string" });
    if (!req.file) missingParams.push({ field: "icon", expectedType: "file" });
    if (missingParams.length > 0) {
      return res.status(400).json({
        error: "Missing or invalid parameters",
        details: missingParams
      });
    }

    // Generate a unique job ID and current timestamp
    const jobId = uuidv4();
    const created = Date.now();
    // Save job metadata in-memory (including the updated time)
    jobs[jobId] = {
      status: 'pending',
      created,
      updated: created,
      files: null,
      error: null
    };
    // Insert job metadata into SQLite DB
    insertJob(jobId, 'pending', created);

    // Add the job to the processing queue
    jobQueue.push({
      jobId,
      url,
      manifestUrl,
      iconPath: req.file.path
    });

    // Start processing the queue (if not already running)
    processQueue();

    // Respond immediately with the job ID
    res.json({
      success: true,
      jobId
    });
  } catch (error) {
    console.error('Error in /convert:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      error: 'Conversion request failed',
      details: error.message
    });
  }
});

// GET /job/:jobId
// Returns the job metadata from the SQLite DB (including status, files, updated time, etc.)
app.get('/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  db.get("SELECT * FROM jobs WHERE jobId = ?", [jobId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Job not found' });
    }
    // Parse the files JSON (if present)
    if (row.files) {
      try {
        row.files = JSON.parse(row.files);
      } catch (e) {
        console.error('Error parsing files JSON:', e);
      }
    }
    res.json(row);
  });
});

// GET /download/:filename
// Serves the specified output file from the output directory
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, '..', config.outputDir, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath);
});

// Start the Express server
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
