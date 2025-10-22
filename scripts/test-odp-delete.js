const path = require('path');
const sqlite3 = require('sqlite3').verbose();

console.log('🔍 Testing ODP Delete Functionality...\n');

// Path ke database billing-system
const billingDbPath = '/root/billing-system/data/billing.db';

// Koneksi ke database billing-system
const billingDb = new sqlite3.Database(billingDbPath, (err) => {
    if (err) {
        console.error('❌ Error connecting to billing-system database:', err);
        process.exit(1);
    } else {
        console.log('✅ Connected to billing-system database');
    }
});

async function testODPDelete() {
    try {
        console.log('📊 Checking ODP data...\n');

        // Get all ODPs
        const odps = await new Promise((resolve, reject) => {
            billingDb.all('SELECT * FROM odps ORDER BY id', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        console.log(`Found ${odps.length} ODPs:`);
        odps.forEach(odp => {
            console.log(`  - ID: ${odp.id}, Name: ${odp.name}, Code: ${odp.code}, Used Ports: ${odp.used_ports || 0}`);
        });

        // Check cable routes for each ODP
        console.log('\n🔌 Checking cable routes for each ODP:');
        for (const odp of odps) {
            const cableRoutes = await new Promise((resolve, reject) => {
                billingDb.all('SELECT * FROM cable_routes WHERE odp_id = ?', [odp.id], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            const activeRoutes = cableRoutes.filter(route => route.status === 'connected');
            console.log(`  - ODP ${odp.name} (ID: ${odp.id}): ${cableRoutes.length} total routes, ${activeRoutes.length} active routes`);
            
            if (activeRoutes.length > 0) {
                console.log(`    ⚠️  Cannot delete - has ${activeRoutes.length} active cable routes`);
            } else {
                console.log(`    ✅ Can be deleted - no active cable routes`);
            }
        }

        // Check foreign key constraints
        console.log('\n🔗 Checking foreign key constraints...');
        const foreignKeysEnabled = await new Promise((resolve, reject) => {
            billingDb.get("PRAGMA foreign_keys", (err, row) => {
                if (err) reject(err);
                else resolve(row.foreign_keys);
            });
        });
        console.log(`Foreign keys enabled: ${foreignKeysEnabled ? 'Yes' : 'No'}`);

        // Test delete for ODP with no active routes
        const deletableODP = odps.find(odp => {
            // We'll check this in the loop above, but for now just find one with used_ports = 0
            return (odp.used_ports || 0) === 0;
        });

        if (deletableODP) {
            console.log(`\n🧪 Testing delete for ODP: ${deletableODP.name} (ID: ${deletableODP.id})`);
            
            // Double check no active routes
            const activeRoutes = await new Promise((resolve, reject) => {
                billingDb.get('SELECT COUNT(*) as count FROM cable_routes WHERE odp_id = ? AND status = "connected"', [deletableODP.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
            });

            if (activeRoutes === 0) {
                console.log('✅ ODP is safe to delete - no active cable routes');
                console.log('💡 You can test the delete functionality in the UI now');
            } else {
                console.log(`⚠️  ODP has ${activeRoutes} active cable routes - cannot delete`);
            }
        } else {
            console.log('\n⚠️  No ODP found that can be safely deleted');
            console.log('💡 All ODPs have active cable routes or used ports');
        }

        // Show sample data for testing
        console.log('\n📋 Sample ODP data for testing:');
        odps.slice(0, 3).forEach(odp => {
            console.log(`  - ${odp.name} (${odp.code}): ${odp.used_ports || 0} used ports, Status: ${odp.status}`);
        });

        console.log('\n✅ ODP delete functionality test completed!');

        // Close database connection
        billingDb.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('✅ Database connection closed');
            }
        });

    } catch (error) {
        console.error('❌ Error during test:', error);
        process.exit(1);
    }
}

// Run test
testODPDelete();
