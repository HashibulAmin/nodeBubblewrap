```markdown
# PWA to APK/AAB Converter

Convert Progressive Web Apps (PWAs) into Android APK and AAB files using Bubblewrap CLI and a REST API.

## Installation

Install dependencies:
```bash
npm install
```

## Environment Setup

### 1. Node.js and npm

Ensure you have Node.js (>= 14) and npm (>= 6) installed:

```bash
# Add NodeSource repository for Node.js 14.x
curl -fsSL https://deb.nodesource.com/setup_14.x | sudo -E bash -

# Install Node.js and npm
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 2. Java Development Kit (JDK)

Install a Java Development Kit (JDK). For example, on Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y default-jdk
```

Set the `JAVA_HOME` environment variable. Add the following lines to your shell configuration file (e.g., `~/.bashrc` or `~/.profile`):

```bash
export JAVA_HOME=$(readlink -f /usr/bin/java | sed "s:bin/java::")
export PATH=$PATH:$JAVA_HOME/bin
```

Reload your shell:

```bash
source ~/.bashrc
```

Verify the installation:

```bash
java -version
javac -version
```

### 3. Android SDK

Install the Android SDK (if not already installed):

```bash
sudo apt-get install -y android-sdk
```

Set the `ANDROID_HOME` environment variable and update your PATH. Add these lines to your shell configuration file:

```bash
export ANDROID_HOME=/usr/lib/android-sdk
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools
```

Reload your shell:

```bash
source ~/.bashrc
```

### 4. Android NDK

The Android NDK is required for native code support. You have two options:

#### Option 1: Install via Package Manager

```bash
sudo apt-get install -y android-ndk
```

#### Option 2: Download Manually

1. Visit the [Android NDK Downloads](https://developer.android.com/ndk/downloads) page.
2. Download the latest NDK archive for your system.
3. Extract the archive to a directory (e.g., `/opt/android-ndk`).

Then set the `ANDROID_NDK` environment variable and update your PATH by adding these lines to your shell configuration file:

```bash
export ANDROID_NDK=/opt/android-ndk
export PATH=$PATH:$ANDROID_NDK
```

Reload your shell:

```bash
source ~/.bashrc
```

### 5. Bubblewrap CLI

Install Bubblewrap CLI globally:

```bash
sudo npm install -g @bubblewrap/cli
```

Verify installation:

```bash
bubblewrap --version
```

Initialize Bubblewrap (if running for the first time):

```bash
bubblewrap doctor
bubblewrap update
```

### 6. PM2 (for Production Deployment)

Install PM2 globally to manage the application in production:

```bash
sudo npm install -g pm2
```

Verify installation:

```bash
pm2 --version
```

## Project Setup

### 1. Clone and Configure Project

Clone the repository from GitHub:

```bash
git clone https://github.com/HashibulAmin/nodeBubblewrap.git
cd nodeBubblewrap
```

Install the project dependencies:

```bash
npm install
```

### 2. Configure the Project

Copy the example environment file and update it with your settings:

```bash
cp .env.example .env
nano .env
```

Example `.env` file:

```env
PORT=3000
NODE_ENV=production
UPLOAD_DIR=uploads
OUTPUT_DIR=output
ANDROID_HOME=/usr/lib/android-sdk
ANDROID_NDK=/opt/android-ndk
JAVA_HOME=/path/to/your/jdk
MAX_FILE_SIZE=10mb
```

Set up required directories:

```bash
mkdir -p uploads output logs
chmod 755 uploads output logs
```

## Running the Application

### Start Development Server

For development, run:

```bash
npm run dev
```

### Start Production Server

To start the server normally:

```bash
npm start
```

### Start with PM2

To run in production using PM2:

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

## API Documentation

The REST API provides endpoints to convert a PWA into APK and AAB files using Bubblewrap.

### Endpoints

- **POST `/convert`**

  **Description:**  
  Converts a PWA to APK/AAB files. Accepts a JSON payload containing a `url` and a `manifestUrl` (and optionally an existing `projectDir`).

  **Request Payload:**
  ```json
  {
    "url": "https://example.com",
    "manifestUrl": "https://example.com/manifest.json"
  }
  ```

  **Response:**
  ```json
  {
    "success": true,
    "jobId": "a-unique-job-id"
  }
  ```

  **Notes:**  
  - If an existing project directory is provided (via `projectDir`), the service will reuse it and skip manifest download and project regeneration.
  - The service automatically generates or reuses a signing key (stored in a root-level keystores folder) based on the domain name. If a keystore for the domain already exists, its key options are retrieved from the database and reused.

- **GET `/job/:jobId`**

  **Description:**  
  Retrieves the status and details of a conversion job by job ID.

  **Response:**
  ```json
  {
    "jobId": "a-unique-job-id",
    "status": "completed",
    "created": 1623456789012,
    "updated": 1623456790123,
    "files": {
      "apk": "base64hash_timestamp.apk",
      "aab": "base64hash_timestamp.aab"
    }
  }
  ```

- **GET `/download/:filename`**

  **Description:**  
  Downloads the generated APK or AAB file using the filename from the job files list.

  **Response:**  
  Returns the file as a download.

## Example manifest.json

Below is an example of a `manifest.json` file that you can use for testing. Save this content as `manifest.json` in your PWA project:

```json
{
  "plugin": "PWA to TWA",
  "id": "https://bajhi.com?app_id=be064000fba6fcf4f4442c8ec90885ab",
  "name": "bajhi",
  "short_name": "bajhi",
  "description": "Build Websites in Minutes",
  "theme_color": "#1858d1",
  "background_color": "#1d2327",
  "orientation": "portrait",
  "display": "standalone",
  "scope": "/",
  "start_url": "/?utm_source=manifest.json&utm_medium=plugin&utm_campaign=iworks-pwa",
  "icons": [
    {
      "sizes": "512x512",
      "type": "image/png",
      "src": "https://bajhi.com/wp-content/uploads/2024/11/bajhi-logo-1-1-1.png",
      "purpose": "maskable"
    },
    {
      "sizes": "36x36",
      "type": "image/png",
      "density": "0.75",
      "src": "https://bajhi.com/wp-content/uploads/pwa/icon-pwa-36.png?v=233183"
    },
    {
      "sizes": "48x48",
      "type": "image/png",
      "density": "1.0",
      "src": "https://bajhi.com/wp-content/uploads/pwa/icon-pwa-48.png?v=233183"
    },
    {
      "sizes": "72x72",
      "type": "image/png",
      "density": "1.5",
      "src": "https://bajhi.com/wp-content/uploads/pwa/icon-pwa-72.png?v=233183"
    },
    {
      "sizes": "96x96",
      "type": "image/png",
      "density": "2.0",
      "src": "https://bajhi.com/wp-content/uploads/pwa/icon-pwa-96.png?v=233183"
    },
    {
      "sizes": "144x144",
      "type": "image/png",
      "density": "3.0",
      "src": "https://bajhi.com/wp-content/uploads/pwa/icon-pwa-144.png?v=233183"
    },
    {
      "sizes": "192x192",
      "type": "image/png",
      "density": "4.0",
      "src": "https://bajhi.com/wp-content/uploads/pwa/icon-pwa-192.png?v=233183",
      "purpose": "any"
    },
    {
      "sizes": "512x512",
      "type": "image/png",
      "src": "https://bajhi.com/wp-content/uploads/pwa/icon-pwa-512.png?v=233183",
      "purpose": "any maskable"
    }
  ],
  "categories": [
    "education",
    "productivity",
    "shopping"
  ],
  "shortcuts": [
    {
      "name": "Websites",
      "url": "/websites/?utm_source=manifest.json&utm_medium=application&utm_campaign=iworks-pwa"
    },
    {
      "name": "Apps",
      "url": "/apps/?utm_source=manifest.json&utm_medium=application&utm_campaign=iworks-pwa"
    },
    {
      "name": "Services",
      "url": "/services/?utm_source=manifest.json&utm_medium=application&utm_campaign=iworks-pwa"
    },
    {
      "name": "Freelancers & Agencies",
      "url": "/freelancers/?utm_source=manifest.json&utm_medium=application&utm_campaign=iworks-pwa"
    }
  ]
}
```

## (Optional) Configure Nginx as a Reverse Proxy

Install and configure Nginx:

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/pwa-converter
```

Insert the following configuration (adjust `your-domain.com` accordingly):

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

---

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

# Save current PM2 process list
pm2 save
```

---

## Troubleshooting

1. **Bubblewrap Initialization Issues:**
   ```bash
   bubblewrap doctor
   npm install -g @bubblewrap/cli@latest
   ```

2. **PM2 Issues:**
   ```bash
   pm2 logs
   pm2 flush
   ```

3. **Permission Issues:**
   ```bash
   sudo chown -R $USER:$USER uploads output logs
   chmod 755 uploads output logs
   ```

---

## Contributing

Feel free to submit pull requests or open issues on [GitHub](https://github.com/HashibulAmin/nodeBubblewrap).

---

## License

MIT License
```

---