const fs = require('fs').promises;

class ManifestProcessor {
    async processManifest(manifestUrl, icons) {
        try {
            let manifest;

            if (manifestUrl.startsWith('http')) {
                const response = await fetch(manifestUrl);

                if (!response.ok) {
                    throw new Error(`Failed to fetch manifest: HTTP ${response.status}`);
                }

                manifest = await response.json();
            } else {
                const fileData = await fs.readFile(manifestUrl, 'utf8');
                manifest = JSON.parse(fileData);
            }

            // Ensure essential properties exist
            manifest.icons = icons;
            manifest.display = manifest.display || 'standalone';
            manifest.start_url = manifest.start_url || '/';
            manifest.theme_color = manifest.theme_color || '#ffffff';
            manifest.background_color = manifest.background_color || '#ffffff';

            return manifest;
        } catch (error) {
            throw new Error(`Failed to process manifest: ${error.message}`);
        }
    }
}

module.exports = new ManifestProcessor();
