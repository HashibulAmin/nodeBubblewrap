require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
    outputDir: process.env.OUTPUT_DIR || 'output',
    androidSdkPath: process.env.ANDROID_HOME,
    maxFileSize: process.env.MAX_FILE_SIZE || '10mb',
    jdkPath: process.env.JAVA_HOME || '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home'
};