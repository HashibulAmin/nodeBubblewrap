const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// For Node 18+, fetch is available globally. If not, uncomment the following line:
// const fetch = require('node-fetch');

const config = require('./config/config');
const { cleanupOldFiles } = require('./utils/cleanup');

// Import the necessary classes from @bubblewrap/core.
// We assume that TwaManifest exposes fromWebManifestJson.
const { TwaManifest, TwaGenerator } = require('@bubblewrap/core');

const app = express();

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests from this IP, please try again later."
});
app.use(limiter);
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// SQLITE DATABASE INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

const dbPath = path.join(__dirname, '..', 'jobs.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening SQLite database:", err);
  } else {
    console.log("Connected to SQLite database");
    db.run(
      `CREATE TABLE IF NOT EXISTS jobs (
         jobId TEXT PRIMARY KEY,
         status TEXT,
         created INTEGER,
         updated INTEGER,
         files TEXT,
         error TEXT
       )`,
      (err) => {
        if (err) {
          console.error("Error creating jobs table:", err);
        }
      }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY JOB STORE & QUEUE
// ─────────────────────────────────────────────────────────────────────────────

const jobs = {};
const jobQueue = [];
let isProcessing = false;

function insertJob(jobId, status, created) {
  db.run(
    "INSERT INTO jobs (jobId, status, created, updated) VALUES (?, ?, ?, ?)",
    [jobId, status, created, created],
    (err) => {
      if (err) console.error("Error inserting job:", err);
    }
  );
}

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

// ─────────────────────────────────────────────────────────────────────────────
// JOB PROCESSING FUNCTION USING Bubblewrap CLI for Build
// ─────────────────────────────────────────────────────────────────────────────

async function processConversionJob(job) {
  const timestamp = Date.now();
  const urlHash = Buffer.from(job.url).toString('base64').replace(/[\/\+]/g, '_');

  console.log(`[Job ${job.jobId}] Starting conversion job at timestamp ${timestamp}.`);

  // Create a dedicated "temp" folder if it doesn't exist.
  const tempFolder = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder, { recursive: true });
    console.log(`[Job ${job.jobId}] Created temp folder at ${tempFolder}.`);
  }
  const projectDir = path.join(tempFolder, `pwa_${timestamp}_${urlHash}`);
  console.log(`[Job ${job.jobId}] Project directory: ${projectDir}.`);
  await cleanupOldFiles(projectDir);
  console.log(`[Job ${job.jobId}] Cleaned up project directory.`);

  // Download the manifest from manifestUrl.
  console.log(`[Job ${job.jobId}] Downloading manifest from URL: ${job.manifestUrl.toString()}...`);
  const response = await fetch(job.manifestUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: HTTP ${response.status}`);
  }
  const manifest = await response.json();
  console.log(`[Job ${job.jobId}] Manifest downloaded.`);

  // Save the manifest to a file (manifest.json).
  const manifestPath = path.join(projectDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[Job ${job.jobId}] Manifest saved to ${manifestPath}.`);

  // Create a TWA manifest from the downloaded manifest.
  console.log(`[Job ${job.jobId}] Creating TWA manifest from downloaded manifest...`);
  const twaManifest = TwaManifest.fromWebManifestJson(job.manifestUrl, manifest);
  console.log(`[Job ${job.jobId}] TWA manifest created.`);

  // Initialize the TWA generator and create the TWA project.
  console.log(`[Job ${job.jobId}] Initializing TWA generator...`);
  const generator = new TwaGenerator();
  const log = { log: (msg) => console.log(msg) };
  await generator.createTwaProject(projectDir, twaManifest, log);
  console.log(`[Job ${job.jobId}] TWA project created.`);

  // Build the project using the Bubblewrap CLI.
  console.log(`[Job ${job.jobId}] Building APK using bubblewrap build...`);
  await execPromise(`bubblewrap build --directory ${projectDir} --yes`);
  console.log(`[Job ${job.jobId}] APK build completed.`);

  console.log(`[Job ${job.jobId}] Building AAB using bubblewrap build --android-app-bundle...`);
  await execPromise(`bubblewrap build --android-app-bundle --directory ${projectDir} --yes`);
  console.log(`[Job ${job.jobId}] AAB build completed.`);

  // Define output paths and copy the generated files.
  const outputDir = path.join(__dirname, '..', config.outputDir);
  const apkPath = path.join(projectDir, 'app-release-signed.apk');
  const aabPath = path.join(projectDir, 'app-release-bundle.aab');
  const outputApkPath = path.join(outputDir, `${urlHash}_${timestamp}.apk`);
  const outputAabPath = path.join(outputDir, `${urlHash}_${timestamp}.aab`);

  console.log(`[Job ${job.jobId}] Copying APK from ${apkPath} to ${outputApkPath}...`);
  fs.copyFileSync(apkPath, outputApkPath);
  console.log(`[Job ${job.jobId}] Copying AAB from ${aabPath} to ${outputAabPath}...`);
  fs.copyFileSync(aabPath, outputAabPath);

  // Clean up temporary files.
  console.log(`[Job ${job.jobId}] Cleaning up temporary files in ${projectDir}...`);
  await cleanupOldFiles(projectDir);

  console.log(`[Job ${job.jobId}] Conversion job completed successfully.`);
  return {
    apk: path.basename(outputApkPath),
    aab: path.basename(outputAabPath)
  };
}

async function processQueue() {
  if (isProcessing || jobQueue.length === 0) return;
  isProcessing = true;
  const job = jobQueue.shift();
  try {
    const files = await processConversionJob(job);
    jobs[job.jobId].status = 'completed';
    jobs[job.jobId].files = files;
    jobs[job.jobId].updated = Date.now();
    updateJob(job.jobId, 'completed', files, null);
  } catch (error) {
    console.error(`Error processing job ${job.jobId}:`, error);
    jobs[job.jobId].status = 'failed';
    jobs[job.jobId].error = "Internal server error.";
    jobs[job.jobId].updated = Date.now();
    updateJob(job.jobId, 'failed', null, "Internal server error.");
  }
  isProcessing = false;
  processQueue();
}

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

app.post('/convert', async (req, res) => {
  try {
    console.log(req.body);

    const { url, manifestUrl } = req.body;
    const missingParams = [];

      if (typeof url !== 'string' || url.trim() === '') {
        missingParams.push({ field: "url", expectedType: "string" });
      }
      if (typeof manifestUrl !== 'string' || manifestUrl.trim() === '') {
        missingParams.push({ field: "manifestUrl", expectedType: "string" });
      }

      if (missingParams.length > 0) {
        return res.status(400).json({
          error: "Missing or invalid parameters",
          details: missingParams
        });
      }
    // Validate URL format.
    try {
      new URL(url);
      new URL(manifestUrl);
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format." });
    }
    // Convert manifestUrl to a URL object.
    const manifestURLObject = new URL(manifestUrl);
    const jobId = uuidv4();
    const created = Date.now();
    jobs[jobId] = {
      status: 'pending',
      created,
      updated: created,
      files: null,
      error: null,
    };
    insertJob(jobId, 'pending', created);
    jobQueue.push({
      jobId,
      url,
      manifestUrl: manifestURLObject,
    });
    processQueue();
    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Error in /convert:', error);
    res.status(500).json({
      error: 'Conversion request failed. Please try again later.',
    });
  }
});

app.get('/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  db.get("SELECT * FROM jobs WHERE jobId = ?", [jobId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Internal server error." });
    }
    if (!row) {
      return res.status(404).json({ error: 'Job not found' });
    }
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

app.get('/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, '..', config.outputDir, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath);
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
