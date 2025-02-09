const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const util = require('util');
const exec = require('child_process').exec;
const execPromise = util.promisify(exec);

// For Node 18+, the global fetch API is available.
// Otherwise, uncomment the following line after installing node-fetch:
// const fetch = require('node-fetch');

const config = require('./config/config');
const { cleanupOldFiles } = require('./utils/cleanup');

// Import the necessary classes from @bubblewrap/core.
const { TwaManifest, TwaGenerator, GradleWrapper, AndroidSdkTools, JdkHelper, Config } = require('@bubblewrap/core');

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

// Use express.json() to parse JSON bodies.
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
// JOB PROCESSING FUNCTION USING GradleWrapper from Bubblewrap Core
// ─────────────────────────────────────────────────────────────────────────────

async function processConversionJob(job) {
  const timestamp = Date.now();
  const urlHash = Buffer.from(job.url).toString('base64').replace(/[\/\+]/g, '_');

  console.log(`[Job ${job.jobId}] Starting conversion job at timestamp ${timestamp}.`);

  // Ensure a dedicated "temp" folder exists.
  const tempFolder = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder, { recursive: true });
    console.log(`[Job ${job.jobId}] Created temp folder at ${tempFolder}.`);
  }
  
  // Compute the project directory.
  const projectDir = path.join(tempFolder, `pwa_${timestamp}_${urlHash}`);
  console.log(`[Job ${job.jobId}] Project directory: ${projectDir}.`);
  
  // Cleanup might delete the directory; ensure it exists.
  await cleanupOldFiles(projectDir);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
    console.log(`[Job ${job.jobId}] Re-created project directory at ${projectDir} after cleanup.`);
  }

  // Download the manifest from manifestUrl.
  console.log(`[Job ${job.jobId}] Downloading manifest from ${job.manifestUrl.toString()}...`);
  const response = await fetch(job.manifestUrl.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: HTTP ${response.status}`);
  }
  const manifest = await response.json();
  console.log(`[Job ${job.jobId}] Manifest downloaded.`);

  // Save the manifest to a file.
  const manifestPath = path.join(projectDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[Job ${job.jobId}] Manifest saved to ${manifestPath}.`);

  // Create a TWA manifest using the downloaded manifest.
  console.log(`[Job ${job.jobId}] Creating TWA manifest from downloaded manifest...`);
  const twaManifest = TwaManifest.fromWebManifestJson(job.manifestUrl, manifest);
  console.log(`[Job ${job.jobId}] TWA manifest created.`);

  // Initialize the TWA generator and create the TWA project.
  console.log(`[Job ${job.jobId}] Initializing TWA generator...`);
  const generator = new TwaGenerator();
  const log = { log: (msg) => console.log(msg) };
  await generator.createTwaProject(projectDir, twaManifest, log);
  console.log(`[Job ${job.jobId}] TWA project created.`);

  // Write the TWA manifest file (twa-manifest.json) to the project directory.
  const twaManifestPath = path.join(projectDir, 'twa-manifest.json');
  fs.writeFileSync(twaManifestPath, JSON.stringify(twaManifest.toJson(), null, 2));
  console.log(`[Job ${job.jobId}] TWA manifest saved to ${twaManifestPath}.`);

  // Ensure process.env.JAVA_HOME is set. Use config.jdkPath as fallback.
  if (!process.env.JDK_HOME) {
    process.env.JDK_HOME = config.jdkPath;  // For example, '/Library/Java/JavaVirtualMachines/zulu-17.jdk'
    console.log(`[Job ${job.jobId}] Set process.env.JDK_HOME to ${process.env.JDK_HOME}`);
  }
  
  // Create a Config instance using the Config class from @bubblewrap/core.
  const configInstance = new Config(
    process.env.JDK_HOME,
    process.env.ANDROID_HOME || config.androidHome
  );
  
  // Initialize JdkHelper with the process object and the config instance.
  console.log(configInstance);

  // Initialize JdkHelper, AndroidSdkTools, and GradleWrapper.
  console.log(`[Job ${job.jobId}] Initializing JdkHelper...`);
  const jdkHelper = new JdkHelper(process, configInstance);
  console.log(`[Job ${job.jobId}] Creating AndroidSdkTools...`);
  const androidSdkTools = await AndroidSdkTools.create(process, configInstance, jdkHelper, log);
  console.log(`[Job ${job.jobId}] Initializing GradleWrapper...`);
  const gradle = new GradleWrapper(process, androidSdkTools, projectDir);
  
  // Execute Gradle tasks.
  console.log(`[Job ${job.jobId}] Executing Gradle task 'assembleRelease' for APK...`);
  await gradle.assembleRelease();
  console.log(`[Job ${job.jobId}] APK build completed.`);
  
  console.log(`[Job ${job.jobId}] Executing Gradle task 'bundleRelease' for AAB...`);
  await gradle.bundleRelease();
  console.log(`[Job ${job.jobId}] AAB build completed.`);

// Define the output directory (ensure it exists)
const outputDir = path.join(__dirname, '..', config.outputDir);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`[Job ${job.jobId}] Created output directory at ${outputDir}.`);
}

// Define the expected file paths for the APK and AAB.
// These are the file names as assumed by your current configuration.
const apkFilePath = path.join(projectDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
const aabFilePath = path.join(projectDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
const outputApkPath = path.join(outputDir, `${urlHash}_${timestamp}.apk`);
const outputAabPath = path.join(outputDir, `${urlHash}_${timestamp}.aab`);

// List files in the project directory to help diagnose if the files exist.
const filesInProject = fs.readdirSync(projectDir);
console.log(`[Job ${job.jobId}] Files in project directory:`, filesInProject);

// Verify that the APK file exists before attempting to copy.
if (!fs.existsSync(apkFilePath)) {
  throw new Error(`APK file not found at expected location: ${apkFilePath}`);
}
console.log(`[Job ${job.jobId}] Found APK file at ${apkFilePath}.`);

// Verify that the AAB file exists before attempting to copy.
if (!fs.existsSync(aabFilePath)) {
  throw new Error(`AAB file not found at expected location: ${aabFilePath}`);
}
console.log(`[Job ${job.jobId}] Found AAB file at ${aabFilePath}.`);

// Copy the APK file.
console.log(`[Job ${job.jobId}] Copying APK from ${apkFilePath} to ${outputApkPath}...`);
fs.copyFileSync(apkFilePath, outputApkPath);
console.log(`[Job ${job.jobId}] APK copied successfully.`);

// Copy the AAB file.
console.log(`[Job ${job.jobId}] Copying AAB from ${aabFilePath} to ${outputAabPath}...`);
fs.copyFileSync(aabFilePath, outputAabPath);
console.log(`[Job ${job.jobId}] AAB copied successfully.`);

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

// The /convert endpoint expects a JSON payload with "url" and "manifestUrl".
app.post('/convert', async (req, res) => {
  try {
    console.log("Request body:", req.body);
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
        details: missingParams,
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
