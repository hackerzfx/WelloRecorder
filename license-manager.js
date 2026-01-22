const Store = require('electron-store');
const crypto = require('crypto');
const { execSync } = require('child_process');

// --- 1. Machine Binding Helper ---
function getMachineId() {
    try {
        // Windows specific: Get Hardware UUID
        // Try WMIC first
        try {
            const stdout = execSync('wmic csproduct get uuid', { stdio: 'pipe' }).toString();
            const lines = stdout.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.length > 20 && !trimmed.includes('UUID')) {
                    return trimmed;
                }
            }
        } catch (e1) {
            // Fallback to PowerShell (more reliable on modern Win10/11)
            const psCommand = 'powershell -NoProfile -Command "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"';
            const stdout = execSync(psCommand, { stdio: 'pipe' }).toString().trim();
            if (stdout.length > 20) {
                return stdout;
            }
        }
    } catch (e) {
        console.warn('Machine ID fetch failed, using fallback.', e.message);
    }
    return 'FALLBACK-DEV-MACHINE-ID-0000';
}

const machineId = getMachineId();

// --- 2. Obfuscation ---
// Reconstruct secrets at runtime to avoid simple grep
const _s = ['w', 'e', 'l', 'l', 'o', '-', 's', 'e', 'c', 'u', 'r', 'e'];
const GLOBAL_SALT = _s.join('') + '-v2-' + (2026 * 2);

// Dynamic encryption key based on Machine ID + Static part
// This means config files copied to another PC won't decrypt correctly!
const derivedKey = crypto.createHash('sha256').update(machineId + 'WELLO_KEY').digest('hex');

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
    encryptionKey: derivedKey, // Hardware bound
    clearInvalidConfig: true, // Reset file if decryption fails (e.g. key changed)
    schema
});

/**
 * Validates a license key format and checksum
 * Format: WELLO-XXXX-HHH-CCCC (Prefix-ID-Hours-Checksum)
 */
function validateChecksum(key) {
    try {
        const parts = key.split('-');
        if (parts.length !== 4) return false;
        if (parts[0] !== 'WELLO') return false;

        const id = parts[1];
        const hoursStr = parts[2];
        const checksum = parts[3];

        // --- 3. Stronger Crypto (HMAC-SHA256) ---
        const data = `${id}-${hoursStr}`;
        const hmac = crypto.createHmac('sha256', GLOBAL_SALT);
        hmac.update(data);
        // Take first 8 chars for checksum (longer than before, but still readable)
        const hash = hmac.digest('hex').substring(0, 6).toUpperCase();

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

const REG_KEY = 'HKCU\\Software\\WelloRecorder';
const REG_VAL = 'TrialUsed';

// Helper to check registry for trial usage (Persistence against uninstall)
// Helper to check registry for trial usage (Persistence against uninstall)
let _registryTrialChecked = false;
let _registryTrialValue = false;

function checkRegistryTrial() {
    if (_registryTrialChecked) return _registryTrialValue;

    try {
        execSync(`reg query "${REG_KEY}" /v "${REG_VAL}"`, { stdio: 'pipe' });
        _registryTrialValue = true;
    } catch (e) {
        _registryTrialValue = false;
    }
    _registryTrialChecked = true;
    return _registryTrialValue;
}

// Helper to mark trial as used in registry
function setRegistryTrial() {
    try {
        try { execSync(`reg add "${REG_KEY}" /f`, { stdio: 'pipe' }); } catch (e) { }
        execSync(`reg add "${REG_KEY}" /v "${REG_VAL}" /t REG_SZ /d "1" /f`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        console.error("Registry write failed:", e.message);
        return false;
    }
}

module.exports = {
    activateLicense: (key) => {
        const keyUpper = key.trim().toUpperCase();
        const licenseData = parseLicense(keyUpper);
        if (!licenseData) {
            return { success: false, message: 'Invalid license key' };
        }

        const usedKeys = store.get('license.usedKeys', []);
        if (usedKeys.includes(keyUpper)) {
            return { success: false, message: 'License key already used' };
        }

        const currentTotal = store.get('license.hoursTotal', 0);
        const currentUsed = store.get('license.hoursUsed', 0);
        const isActive = store.get('license.active', false);
        const newTotal = isActive ? (currentTotal + licenseData.hours) : licenseData.hours;

        usedKeys.push(keyUpper);

        store.set('license', {
            active: true,
            hoursTotal: newTotal,
            hoursUsed: currentUsed,
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

    getLicenseStatus: () => {
        // Safe get with machine-bound key
        let license;
        try {
            license = store.get('license');
        } catch (e) {
            // Decryption failed = File moved from another PC or Corrupted
            console.error("License load failed (Machine ID mismatch?):", e.message);
            // Treat as no license / reset
            return { valid: false, reason: 'machine_mismatch', remaining: 0, total: 0 };
        }

        let trialUsed = store.get('trialUsed', false);

        if (!trialUsed) {
            if (checkRegistryTrial()) {
                trialUsed = true;
                store.set('trialUsed', true);
            }
        }

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
            setRegistryTrial();

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

    consumeHours: (hoursToConsume) => {
        try {
            const license = store.get('license');
            if (!license || !license.active) return false;

            const newUsed = (license.hoursUsed || 0) + hoursToConsume;
            store.set('license.hoursUsed', newUsed);

            return newUsed < license.hoursTotal;
        } catch (e) {
            return false;
        }
    },

    /**
     * Resets the license store (for cleaning/testing)
     */
    resetLicense: () => {
        store.clear();
    },

    /**
     * Force expires the current license (for testing)
     */
    forceExpire: () => {
        const license = store.get('license');
        if (license && license.active) {
            store.set('license.hoursUsed', license.hoursTotal);
            return true;
        }
        return false;
    },

    // Updated generator for new Checksum
    generateKey: (hours) => {
        const id = crypto.randomBytes(2).toString('hex').toUpperCase();
        const hoursStr = hours.toString().padStart(3, '0');

        const data = `${id}-${hoursStr}`;
        const hmac = crypto.createHmac('sha256', GLOBAL_SALT);
        hmac.update(data);
        const checksum = hmac.digest('hex').substring(0, 6).toUpperCase();

        return `WELLO-${id}-${hoursStr}-${checksum}`;
    },

    // Export machine ID for debugging
    _machineId: machineId
};
