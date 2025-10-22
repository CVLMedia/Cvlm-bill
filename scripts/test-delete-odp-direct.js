const path = require('path');
const sqlite3 = require('sqlite3').verbose();

console.log('🧪 Testing ODP Delete Function Directly...\n');

// Path ke database billing-system
const billingDbPath = '/root/billing-system/data/billing.db';

async function testDeleteODP() {
    let db;
    try {
        // Koneksi ke database
        db = new sqlite3.Database(billingDbPath);
        console.log('✅ Connected to database');

        // Enable foreign keys
        await new Promise((resolve, reject) => {
            db.run("PRAGMA foreign_keys = ON", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Foreign keys enabled');

        // Find an ODP that can be deleted (no active cable routes)
        const deletableODP = await new Promise((resolve, reject) => {
            db.get(`
                SELECT o.*, 
                       (SELECT COUNT(*) FROM cable_routes cr WHERE cr.odp_id = o.id AND cr.status = 'connected') as active_routes
                FROM odps o 
                WHERE o.id NOT IN (
                    SELECT DISTINCT odp_id FROM cable_routes WHERE status = 'connected'
                )
                LIMIT 1
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!deletableODP) {
            console.log('❌ No ODP found that can be safely deleted');
            return;
        }

        console.log(`🎯 Testing delete for ODP: ${deletableODP.name} (ID: ${deletableODP.id})`);
        console.log(`   Active routes: ${deletableODP.active_routes}`);

        // Test delete
        const result = await new Promise((resolve, reject) => {
            db.run('DELETE FROM odps WHERE id = ?', [deletableODP.id], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        console.log(`✅ Delete result: ${result} rows affected`);

        if (result > 0) {
            console.log(`🎉 ODP "${deletableODP.name}" successfully deleted!`);
            
            // Verify deletion
            const verifyDelete = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM odps WHERE id = ?', [deletableODP.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (!verifyDelete) {
                console.log('✅ Deletion verified - ODP no longer exists in database');
            } else {
                console.log('❌ Deletion verification failed - ODP still exists');
            }
        } else {
            console.log('❌ No rows were deleted');
        }

    } catch (error) {
        console.error('❌ Error during test:', error);
    } finally {
        if (db) {
            db.close();
            console.log('✅ Database connection closed');
        }
    }
}

// Run test
testDeleteODP();
