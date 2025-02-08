const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Import fs module
const { exec } = require('child_process');
const util = require('util');
const config = require('./config/config');
const iconGenerator = require('./services/iconGenerator');
const manifestProcessor = require('./services/manifestProcessor');
const { cleanupOldFiles } = require('./utils/cleanup');

const execPromise = util.promisify(exec);
const app = express();
app.use(express.json());

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

// Ensure directories exist
[config.outputDir, config.uploadDir].forEach(dir => {
    const fullPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
});

app.post('/convert', upload.single('icon'), async (req, res) => {
    try {
        const { url, manifestUrl } = req.body;

        // Collect missing fields
        const missingParams = [];
        if (!url) missingParams.push({ field: "url", expectedType: "string" });
        if (!manifestUrl) missingParams.push({ field: "manifestUrl", expectedType: "string" });
        if (!req.file) missingParams.push({ field: "icon", expectedType: "file" });

        // Return detailed error if any parameter is missing
        if (missingParams.length > 0) {
            return res.status(400).json({
                error: "Missing or invalid parameters",
                details: missingParams
            });
        }

        const timestamp = Date.now();
        const urlHash = Buffer.from(url).toString('base64').replace(/[\/\+]/g, '_');
        const projectDir = path.join(__dirname, '..', `pwa_${timestamp}_${urlHash}`);

        await cleanupOldFiles(projectDir);

        const icons = await iconGenerator.generateIcons(req.file.path, projectDir);
        const manifest = await manifestProcessor.processManifest(manifestUrl, icons);
        
        const manifestPath = path.join(projectDir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        await execPromise(`bubblewrap init --manifest ${manifestPath} --directory ${projectDir}`);
        await execPromise(`cd ${projectDir} && bubblewrap build`);
        await execPromise(`cd ${projectDir} && bubblewrap build --android-app-bundle`);

        // Move and cleanup files
        const outputDir = path.join(__dirname, '..', config.outputDir);
        const apkPath = path.join(projectDir, 'app-release-signed.apk');
        const aabPath = path.join(projectDir, 'app-release-bundle.aab');
        const outputApkPath = path.join(outputDir, `${urlHash}_${timestamp}.apk`);
        const outputAabPath = path.join(outputDir, `${urlHash}_${timestamp}.aab`);

        fs.copyFileSync(apkPath, outputApkPath);
        fs.copyFileSync(aabPath, outputAabPath);

        await cleanupOldFiles(projectDir);
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            files: {
                apk: path.basename(outputApkPath),
                aab: path.basename(outputAabPath)
            }
        });

    } catch (error) {
        console.error('Error:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            error: 'Conversion failed',
            details: error.message
        });
    }
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
