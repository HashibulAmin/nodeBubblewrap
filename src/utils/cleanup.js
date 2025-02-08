const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const os = require('os');

const execPromise = util.promisify(exec);

async function cleanupOldFiles(projectDir) {
    if (!fs.existsSync(projectDir)) return;

    try {
        if (os.platform() !== 'win32') {
            // Use shell command on Unix-like systems
            await execPromise(`rm -rf ${projectDir}`);
        } else {
            // Use Node.js method for Windows
            await fs.promises.rm(projectDir, { recursive: true, force: true });
        }
        console.log(`Deleted: ${projectDir}`);
    } catch (error) {
        console.error(`Failed to delete ${projectDir}:`, error);
    }
}

module.exports = { cleanupOldFiles };
