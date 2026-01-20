const Store = require('electron-store');
const crypto = require('crypto');

// Initialize store with encryption
// We use a fixed key for simplicity in this local app, 
// but in production OBVIOUSLY you'd want something more robust 
// or cloud-based validation.
const schema = {
    license: {
        type: 'object',
        default: {},
        properties: {
            active: { type: 'boolean' },
            hoursTotal: { type: 'number' },
            hoursUsed: { type: 'number' },
            activationDate: { type: 'string' },
            usedKeys: {
                type: 'array',
                items: { type: 'string' },
                default: []
            }
        }
    }
};

const store = new Store({
    name: 'wello-config',
    encryptionKey: 'wello-recorder-secure-key-2026', // Encrypts the file on disk
    schema
});

const SALT = 'wello-modder-secret-salt-883';

/**
 * Validates a license key format and checksum
 * Format: WELLO-XXXX-HHH-CCCC (Prefix-ID-Hours-Checksum)
 * Example: WELLO-A1B2-010-F3E1 (10 hours)
 */
function validateChecksum(key) {
    try {
        const parts = key.split('-');
        if (parts.length !== 4) return false;
        if (parts[0] !== 'WELLO') return false;

        const id = parts[1];
        const hoursStr = parts[2];
        const checksum = parts[3];

        // Re-calculate checksum based on ID and Hours
        const data = `${id}-${hoursStr}-${SALT}`;
        const hash = crypto.createHash('md5').update(data).digest('hex').substring(0, 4).toUpperCase();

        return hash === checksum;
    } catch (e) {
        return false;
    }
}

function parseLicense(key) {
    if (!validateChecksum(key)) return null;

    const parts = key.split('-');
    const hoursStr = parts[2];
    const hours = parseFloat(hoursStr);

    return {
        key,
        hours
    };
}

const { execSync } = require('child_process');

const REG_KEY = 'HKCU\\Software\\WelloRecorder';
const REG_VAL = 'TrialUsed';

// Helper to check registry for trial usage (Persistence against uninstall)
function checkRegistryTrial() {
    try {
        // Try to read the key
        execSync(`reg query "${REG_KEY}" /v "${REG_VAL}"`, { stdio: 'pipe' });
        return true; // Command success means key exists
    } catch (e) {
        return false; // Key doesn't exist
    }
}

// Helper to mark trial as used in registry
function setRegistryTrial() {
    try {
        // Create key if not exists (silent)
        try { execSync(`reg add "${REG_KEY}" /f`, { stdio: 'pipe' }); } catch (e) { }

        // Set value
        execSync(`reg add "${REG_KEY}" /v "${REG_VAL}" /t REG_SZ /d "1" /f`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        console.error("Registry write failed:", e.message);
        return false;
    }
}

module.exports = {
    /**
     * Activate a new license key
     * @returns {Object} { success: boolean, message: string }
     */
    activateLicense: (key) => {
        // Basic format check
        const keyUpper = key.trim().toUpperCase();

        // Validate
        const licenseData = parseLicense(keyUpper);
        if (!licenseData) {
            return { success: false, message: 'Invalid license key' };
        }

        // Check if key already used
        const usedKeys = store.get('license.usedKeys', []);
        if (usedKeys.includes(keyUpper)) {
            return { success: false, message: 'License key already used' };
        }

        const currentTotal = store.get('license.hoursTotal', 0);
        const currentUsed = store.get('license.hoursUsed', 0);
        const isActive = store.get('license.active', false);

        const newTotal = isActive ? (currentTotal + licenseData.hours) : licenseData.hours;

        // Add key to used list
        usedKeys.push(keyUpper);

        store.set('license', {
            active: true,
            hoursTotal: newTotal,
            hoursUsed: currentUsed, // Preserve used hours
            activationDate: store.get('license.activationDate') || new Date().toISOString(),
            usedKeys: usedKeys
        });

        return {
            success: true,
            message: `License activated! ${licenseData.hours} hours added. New total: ${newTotal} hours.`,
            hours: licenseData.hours,
            total: newTotal
        };
    },

    /**
     * Check if current license is valid and has time remaining
     */
    getLicenseStatus: () => {
        const license = store.get('license');
        let trialUsed = store.get('trialUsed', false);

        // EXTRA SECURITY: Check Registry
        if (!trialUsed) {
            if (checkRegistryTrial()) {
                trialUsed = true;
                store.set('trialUsed', true); // Sync back to store
            }
        }

        // Auto-Activate Trial (20 Minutes = 0.34 Hours)
        if ((!license || !license.active) && !trialUsed) {
            const trialHours = 0.34;
            store.set('license', {
                active: true,
                hoursTotal: trialHours,
                hoursUsed: 0,
                activationDate: new Date().toISOString(),
                usedKeys: ['TRIAL-MODE']
            });
            store.set('trialUsed', true);
            setRegistryTrial(); // Mark in Registry

            return {
                valid: true,
                remaining: trialHours,
                used: 0,
                total: trialHours,
                isTrial: true
            };
        }

        if (!license || !license.active) {
            return { valid: false, reason: 'no_license', remaining: 0, total: 0 };
        }

        const remaining = Math.max(0, license.hoursTotal - license.hoursUsed);

        if (remaining <= 0) {
            return { valid: false, reason: 'expired', remaining: 0, total: license.hoursTotal };
        }

        return {
            valid: true,
            remaining: parseFloat(remaining.toFixed(2)),
            used: parseFloat(license.hoursUsed.toFixed(2)),
            total: license.hoursTotal
        };
    },

    /**
     * Consume hours from the license
     * @param {number} hoursToConsume - Hours to deduct (can be fractional)
     */
    consumeHours: (hoursToConsume) => {
        const license = store.get('license');
        if (!license || !license.active) return false;

        const newUsed = (license.hoursUsed || 0) + hoursToConsume;
        store.set('license.hoursUsed', newUsed);

        return newUsed < license.hoursTotal;
    },

    // For generating keys (server-side logic, but included here for the utility script)
    generateKey: (hours) => {
        const id = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 chars
        const hoursStr = hours.toString().padStart(3, '0'); // e.g. 050
        const data = `${id}-${hoursStr}-${SALT}`;
        const checksum = crypto.createHash('md5').update(data).digest('hex').substring(0, 4).toUpperCase();

        return `WELLO-${id}-${hoursStr}-${checksum}`;
    }
};
