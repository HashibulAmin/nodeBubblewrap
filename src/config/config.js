require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
    outputDir: process.env.OUTPUT_DIR || 'output',
    androidSdkPath: process.env.ANDROID_HOME,
    maxFileSize: process.env.MAX_FILE_SIZE || '10mb'
};