const crypto = require('crypto');

// MUST match the salt logic in license-manager.js
// Reconstruct secrets at runtime to avoid simple grep
const _s = ['w', 'e', 'l', 'l', 'o', '-', 's', 'e', 'c', 'u', 'r', 'e'];
const GLOBAL_SALT = _s.join('') + '-v2-' + (2026 * 2);

function generateKey(hours) {
    const id = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 chars

    // Support decimals: 10 -> "010", 0.5 -> "0.5", 1.5 -> "1.5"
    let hoursStr = hours.toString();

    if (Number.isInteger(hours)) {
        hoursStr = hours.toString().padStart(3, '0');
    }

    const data = `${id}-${hoursStr}`;
    const hmac = crypto.createHmac('sha256', GLOBAL_SALT);
    hmac.update(data);
    const checksum = hmac.digest('hex').substring(0, 6).toUpperCase();

    return `WELLO-${id}-${hoursStr}-${checksum}`;
}

const args = process.argv.slice(2);
if (args.length === 0) {
    console.log('Usage: node generate-license.js <hours>');
    console.log('Example: node generate-license.js 50');
    process.exit(1);
}

const hours = parseFloat(args[0]);
// Format to max 3 decimal places to avoid floating point weirdness in string
// e.g. 0.1 hours
if (isNaN(hours) || hours <= 0) {
    console.error('Invalid hours specified. Must be a number greater than 0.');
    process.exit(1);
}

const key = generateKey(hours);

console.log('\n==========================================');
console.log('   WELLO RECORDER - LICENSE GENERATOR');
console.log('==========================================');
console.log(`\nHours: ${hours}`);
console.log(`License Key: \x1b[32m${key}\x1b[0m`);
console.log('\nCopy this key to the application to activate it.');
console.log('==========================================\n');
