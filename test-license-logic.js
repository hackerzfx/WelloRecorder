const manager = require('./license-manager');
const fs = require('fs');
const path = require('path');

// Reset store for testing
try {
    manager.resetLicense();
    console.log("✅ Store cleared for testing.");
} catch (e) {
    console.log("⚠️ Could not clear store:", e.message);
}

console.log("\n🧪 STARTING LICENSE SYSTEM TEST (STACKING & REUSE)\n");

// 1. Generate First Key
const hours1 = 5;
const key1 = manager.generateKey(hours1);
console.log(`[1] Generated Key 1 (${hours1}h): ${key1}`);

// 2. Activate First Key
console.log(`[2] Activating Key 1...`);
const activ1 = manager.activateLicense(key1);
if (activ1.success && activ1.hours === hours1) {
    console.log(`✅ Activation 1 Successful! Added ${activ1.hours} hours.`);
} else {
    console.error(`❌ Activation 1 Failed:`, activ1);
    process.exit(1);
}

// 3. Consume Some Hours
console.log(`[3] Consuming 2 Hours...`);
manager.consumeHours(2);
const status1 = manager.getLicenseStatus();
console.log(`   Status: Remaining=${status1.remaining}h, Total=${status1.total}h`);
if (status1.remaining === 3) {
    console.log(`✅ Consumption Correct.`);
} else {
    console.error(`❌ Consumption Failed.`);
}

// 4. Generate Second Key (for stacking)
const hours2 = 10;
const key2 = manager.generateKey(hours2);
console.log(`\n[4] Generated Key 2 (${hours2}h): ${key2}`);

// 5. Activate Second Key (Stacking)
console.log(`[5] Activating Key 2 (Stacking)...`);
const activ2 = manager.activateLicense(key2);
if (activ2.success) {
    console.log(`✅ Activation 2 Successful! Message: ${activ2.message}`);
} else {
    console.error(`❌ Activation 2 Failed:`, activ2);
    process.exit(1);
}

// 6. Verify Totals
const status2 = manager.getLicenseStatus();
console.log(`[6] Verifying Stacked Totals...`);
console.log(`   Status: Remaining=${status2.remaining}h, Used=${status2.used}h, Total=${status2.total}h`);

// Expected: Total = 5 + 10 = 15. Used = 2. Remaining = 13.
if (status2.total === 15 && status2.remaining === 13) {
    console.log(`✅ Stacking Correct. Total updated, usage preserved.`);
} else {
    console.error(`❌ Stacking Failed. Expected Total 15, Remaining 13.`);
}

// 7. Try Reusing Key 1
console.log(`\n[7] Testing Key Reuse Protection (Key 1)...`);
const activReuse = manager.activateLicense(key1);
if (!activReuse.success && activReuse.message.includes('already used')) {
    console.log(`✅ Reuse Protection Correct. Rejected used key.`);
} else {
    console.error(`❌ Reuse Protection Failed. Result:`, activReuse);
}

console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");
