const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

class IconGenerator {
    constructor() {
        this.sizes = [48, 72, 96, 144, 192, 512];
    }

    async generateIcons(sourceIcon, projectDir) {
        try {
            const iconOutputDir = path.resolve(projectDir, 'icons');
            await fs.mkdir(iconOutputDir, { recursive: true });

            const icons = [];

            for (const size of this.sizes) {
                const outputPath = path.join(iconOutputDir, `icon-${size}.png`);

                await sharp(sourceIcon)
                    .resize(size, size)
                    .png()
                    .toFile(outputPath);

                icons.push({
                    src: `icons/icon-${size}.png`,
                    sizes: `${size}x${size}`,
                    type: "image/png",
                    purpose: "any maskable"
                });
            }

            return icons;
        } catch (error) {
            throw new Error(`Failed to generate icons: ${error.message}`);
        }
    }
}

module.exports = new IconGenerator();
