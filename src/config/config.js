require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    uploadDir: process.env.UPLOAD_DIR || 'uploads',
    outputDir: process.env.OUTPUT_DIR || 'output',
    androidSdkPath: process.env.ANDROID_HOME,
    maxFileSize: process.env.MAX_FILE_SIZE || '10mb',
    command_timeout: 600000, 
    maxProcess: process.env.maxProcess || 3,
    maxConvertProcess: process.env.maxConvertProcess || 3,
    jdkPath: process.env.JAVA_HOME || '/Library/Java/JavaVirtualMachines/zulu-17.jdk'
};