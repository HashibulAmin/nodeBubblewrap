# PWA to APK Converter

Convert Progressive Web Apps (PWAs) into APK/AAB files using a REST API with Bubblewrap.

## Installation
```bash
npm install
```

## Start Server
```bash
npm start
```

## API Endpoint
- `POST /convert` - Upload a manifest.json file for conversion.


# PWA to APK/AAB Converter

Convert Progressive Web Apps (PWAs) to Android APK and AAB files using Bubblewrap CLI. This service provides a REST API to convert your PWA into Android applications with automatic icon generation.

## Prerequisites

- Node.js >= 14
- npm >= 6
- Android SDK
- Java Development Kit (JDK)
- Bubblewrap CLI
- PM2 (for production deployment)

## Server Deployment Guide

### 1. Set up Server Prerequisites

First, update your package manager and install essential build tools:
```bash
sudo apt-get update
sudo apt-get install -y build-essential
```

Install Node.js and npm:
```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_14.x | sudo -E bash -

# Install Node.js
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 2. Install Java Development Kit (JDK):
```bash
# Install default JDK
sudo apt-get install -y default-jdk

# Verify installation
java -version
javac -version
```

### 3. Install Android SDK

```bash
# Install Android SDK
sudo apt-get install -y android-sdk

# Set up ANDROID_HOME environment variable
echo "export ANDROID_HOME=/usr/lib/android-sdk" >> ~/.bashrc
echo "export PATH=\$PATH:\$ANDROID_HOME/tools:\$ANDROID_HOME/platform-tools" >> ~/.bashrc
source ~/.bashrc
```

### 4. Install Bubblewrap CLI

```bash
# Install Bubblewrap globally
sudo npm install -g @bubblewrap/cli

# Verify installation
bubblewrap --version

# Initialize Bubblewrap (first-time setup)
bubblewrap doctor

# If prompted, install additional Android SDK components:
bubblewrap update
```

Common Bubblewrap requirements:
- Android SDK Build-Tools
- Android SDK Command-line Tools
- Android SDK Platform-Tools
- Android Platform API level 30

### 5. Install PM2

```bash
# Install PM2 globally
sudo npm install -g pm2

# Verify installation
pm2 --version
```

### 6. Clone and Set Up Project

```bash
# Clone repository
git clone https://github.com/yourusername/pwa-to-apk-converter.git
cd pwa-to-apk-converter

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit environment variables
nano .env
```

### 7. Configure Project

Edit your `.env` file with appropriate values:
```env
PORT=3000
NODE_ENV=production
UPLOAD_DIR=uploads
OUTPUT_DIR=output
ANDROID_HOME=/usr/lib/android-sdk
MAX_FILE_SIZE=10mb
```

### 8. Set Up Directory Structure

```bash
# Create required directories
mkdir -p uploads output logs
chmod 755 uploads output logs
```

### 9. Start Application with PM2

```bash
# Start the application
pm2 start ecosystem.config.js --env production

# Save PM2 process list
pm2 save

# Set up PM2 to start on system boot
pm2 startup

# Monitor the application
pm2 monit
```

### 10. Configure Nginx (Optional but recommended)

```bash
# Install Nginx
sudo apt-get install -y nginx

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/pwa-converter
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 10M;
    }
}
```

Enable the configuration:
```bash
sudo ln -s /etc/nginx/sites-available/pwa-converter /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Development

Start the development server:
```bash
npm run dev
```

## API Documentation

[Previous API documentation section remains the same...]

## Project Structure

[Previous project structure section remains the same...]

## Maintenance Commands

```bash
# View logs
pm2 logs pwa-converter

# Monitor application
pm2 monit

# Restart application
pm2 restart pwa-converter

# Stop application
pm2 stop pwa-converter

# View application status
pm2 status

# Update PM2 startup script
pm2 startup

# Save current PM2 process list
pm2 save
```

## Troubleshooting

1. If Bubblewrap fails to initialize:
```bash
# Check Android SDK installation
bubblewrap doctor

# Update Bubblewrap
npm install -g @bubblewrap/cli@latest
```

2. If PM2 fails to start:
```bash
# Check logs
pm2 logs

# Clear PM2 logs
pm2 flush
```

3. Permission issues:
```bash
# Fix directory permissions
sudo chown -R $USER:$USER uploads output logs
chmod 755 uploads output logs
```

## Contributing

[Previous contributing section remains the same...]

## License

MIT License