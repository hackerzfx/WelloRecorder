const manager = require('./license-manager');

const args = process.argv.slice(2);
const action = args[0] || 'reset'; // default to reset

console.log('\n==========================================');
console.log('   WELLO LICENSE MANAGER TOOL');
console.log('==========================================');

try {
    if (action === 'expire') {
        // Force Expire
        if (manager.forceExpire()) {
            console.log(`✅ LICENSE FORCED EXPIRED!`);
        } else {
            console.log('⚠️ No active license found to expire.');
        }
    } else {
        // Reset (Delete)
        manager.resetLicense();
        console.log('✅ LICENSE RESET SUCCESSFUL!');
        console.log('   App will ask for a new key on next launch.');
    }
} catch (e) {
    console.error('❌ Error:', e.message);
}

console.log('==========================================\n');
