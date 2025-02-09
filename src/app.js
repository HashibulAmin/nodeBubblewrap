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

// Import the necessary classes from @bubblewrap/core, including signing tools.
const { 
  TwaManifest, 
  TwaGenerator, 
  GradleWrapper, 
  AndroidSdkTools, 
  JdkHelper, 
  Config, 
  JarSigner, 
  KeyTool, 
  ConsoleLog 
} = require('@bubblewrap/core');

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
// JOB PROCESSING FUNCTION
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

  // Use the existing project directory if available; otherwise, create a new one.
  let projectDir;
  if (job.projectDir && fs.existsSync(job.projectDir)) {
    projectDir = job.projectDir;
    console.log(`[Job ${job.jobId}] Using existing project directory: ${projectDir}`);
  } else {
    projectDir = path.join(tempFolder, `pwa_${timestamp}_${urlHash}`);
    console.log(`[Job ${job.jobId}] Project directory: ${projectDir}`);
    await cleanupOldFiles(projectDir);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
      console.log(`[Job ${job.jobId}] Created project directory at ${projectDir}.`);
    }

    // Download the manifest.
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
    const logObj = { log: (msg) => console.log(msg) };
    await generator.createTwaProject(projectDir, twaManifest, logObj);
    console.log(`[Job ${job.jobId}] TWA project created.`);

    // Write the TWA manifest file to the project directory.
    const twaManifestPath = path.join(projectDir, 'twa-manifest.json');
    fs.writeFileSync(twaManifestPath, JSON.stringify(twaManifest.toJson(), null, 2));
    console.log(`[Job ${job.jobId}] TWA manifest saved to ${twaManifestPath}.`);
  }

  // ──────────────────────────────────────────────────────────────
  // Build the project using Gradle.
  // ──────────────────────────────────────────────────────────────

  if (!process.env.JDK_HOME) {
    process.env.JDK_HOME = config.jdkPath;  // e.g., '/Library/Java/JavaVirtualMachines/zulu-17.jdk'
    console.log(`[Job ${job.jobId}] Set process.env.JDK_HOME to ${process.env.JDK_HOME}`);
  }
  
  const configInstance = new Config(
    process.env.JDK_HOME,
    process.env.ANDROID_HOME || config.androidHome
  );
  
  console.log(`[Job ${job.jobId}] Initializing JdkHelper...`);
  const jdkHelper = new JdkHelper(process, configInstance);
  console.log(`[Job ${job.jobId}] Creating AndroidSdkTools...`);
  const logObj = { log: (msg) => console.log(msg) };
  const androidSdkTools = await AndroidSdkTools.create(process, configInstance, jdkHelper, logObj);
  console.log(`[Job ${job.jobId}] Initializing GradleWrapper...`);
  const gradle = new GradleWrapper(process, androidSdkTools, projectDir);
  
  // Run Gradle build tasks.
  console.log(`[Job ${job.jobId}] Executing Gradle task 'assembleRelease' for APK...`);
  await gradle.assembleRelease();
  console.log(`[Job ${job.jobId}] APK build completed.`);
  
  console.log(`[Job ${job.jobId}] Executing Gradle task 'bundleRelease' for AAB...`);
  await gradle.bundleRelease();
  console.log(`[Job ${job.jobId}] AAB build completed.`);

  // ──────────────────────────────────────────────────────────────
  // SIGNING THE BUILD ARTIFACTS
  // ──────────────────────────────────────────────────────────────

  // Extract the domain name from the job URL (used as the key alias).
  const urlObj = new URL(job.url);
  const domain = urlObj.hostname;
  console.log(`[Job ${job.jobId}] Extracted domain: ${domain}`);

  // Prepare a directory to hold generated keystores inside projectDir.
  const keystoreDir = path.join(projectDir, 'keystores');
  if (!fs.existsSync(keystoreDir)) {
    fs.mkdirSync(keystoreDir, { recursive: true });
    console.log(`[Job ${job.jobId}] Created keystore directory at ${keystoreDir}.`);
  }
  const keystorePath = path.join(keystoreDir, `${domain}.jks`);

  // Generate a password: domain + random string.
  const randomPart = Math.random().toString(36).substring(2, 8);
  const generatedPassword = domain + randomPart;
  console.log(`[Job ${job.jobId}] Generated signing key password: ${generatedPassword}`);

  // Create a new signing key using KeyTool.
  const keyTool = new KeyTool(jdkHelper, new ConsoleLog('keytool'));
  const keyOptions = {
    path: keystorePath,
    alias: domain,
    password: generatedPassword,
    keypassword: generatedPassword,
    fullName: domain,
    organizationalUnit: "Development",
    organization: "DefaultOrg",
    country: "US"
  };
  console.log(`[Job ${job.jobId}] Creating signing key for ${domain}...`);
  await keyTool.createSigningKey(keyOptions, true);
  console.log(`[Job ${job.jobId}] Signing key created successfully.`);

  // Create a JarSigner instance.
  const jarSigner = new JarSigner(jdkHelper);

  // Sign the APK.
  const unsignedApkPath = path.join(projectDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
  if (!fs.existsSync(unsignedApkPath)) {
    throw new Error(`Unsigned APK file not found at expected location: ${unsignedApkPath}`);
  }
  console.log(`[Job ${job.jobId}] Found unsigned APK file at ${unsignedApkPath}.`);

  const signedApkPathTemp = path.join(projectDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-signed.apk');
  console.log(`[Job ${job.jobId}] Signing APK using JarSigner...`);
  await jarSigner.sign(
    { path: keystorePath, alias: domain },
    generatedPassword,
    generatedPassword,
    unsignedApkPath,
    signedApkPathTemp
  );
  console.log(`[Job ${job.jobId}] APK signed successfully. Signed APK located at ${signedApkPathTemp}.`);

  // Sign the AAB.
  const unsignedAabPath = path.join(projectDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  if (!fs.existsSync(unsignedAabPath)) {
    throw new Error(`Unsigned AAB file not found at expected location: ${unsignedAabPath}`);
  }
  console.log(`[Job ${job.jobId}] Found unsigned AAB file at ${unsignedAabPath}.`);

  const signedAabPathTemp = path.join(projectDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release-signed.aab');
  console.log(`[Job ${job.jobId}] Signing AAB using JarSigner...`);
  await jarSigner.sign(
    { path: keystorePath, alias: domain },
    generatedPassword,
    generatedPassword,
    unsignedAabPath,
    signedAabPathTemp
  );
  console.log(`[Job ${job.jobId}] AAB signed successfully. Signed AAB located at ${signedAabPathTemp}.`);

  // ──────────────────────────────────────────────────────────────
  // COPY OUTPUT FILES
  // ──────────────────────────────────────────────────────────────

  const outputDir = path.join(__dirname, '..', config.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`[Job ${job.jobId}] Created output directory at ${outputDir}.`);
  }
  const outputApkPath = path.join(outputDir, `${urlHash}_${timestamp}.apk`);
  const outputAabPath = path.join(outputDir, `${urlHash}_${timestamp}.aab`);

  console.log(`[Job ${job.jobId}] Copying signed APK from ${signedApkPathTemp} to ${outputApkPath}...`);
  fs.copyFileSync(signedApkPathTemp, outputApkPath);
  console.log(`[Job ${job.jobId}] Signed APK copied successfully.`);

  console.log(`[Job ${job.jobId}] Copying signed AAB from ${signedAabPathTemp} to ${outputAabPath}...`);
  fs.copyFileSync(signedAabPathTemp, outputAabPath);
  console.log(`[Job ${job.jobId}] Signed AAB copied successfully.`);

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
    // Optionally, if you already have a project for the given URL and manifest, 
    // you can include a "projectDir" property in the job object.
    jobQueue.push({
      jobId,
      url,
      manifestUrl: manifestURLObject,
      // projectDir: "path/to/existing/project"  // Uncomment and set if available.
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
